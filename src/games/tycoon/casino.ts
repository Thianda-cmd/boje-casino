import { useWallet } from '../../store/wallet'
import {
  ALL_STEPS,
  N_ATTR,
  VAULT_MIN,
  advance,
  allSteps,
  buy,
  cityIndex,
  cycleTime,
  emptyVault,
  hire,
  markMilestone,
  milestonesDue,
  newSave,
  offlineLimit,
  parseSave,
  sell,
  starsOnSale,
  tap,
  upgrade,
  vaultAt,
  vaultCap,
  whale,
  MILESTONES,
  type Save,
} from './engine'
import { stepsBetween } from './words'

/*
  Casino Tycoon's game, kept out of React (as Reef Raid's purse and Craps' keeper are), so every path that touches
  the save or the coins is plain to follow.

  The save lives in the wallet (wallet.tycoon), so an account carries it. Opening reads it (or starts a new casino)
  and brings it up to now with engine.advance, which is exact: whatever the managers earned while the player was away
  is worked out in one go, and the report of it is the "While you were away" card. From then on the save is kept
  here and advanced on the screen's ticker.

  Writing it back is a wallet change, and for a signed-in player every wallet change is a trip to the server, so the
  save is written only when it holds something the clock can't work out again: after every purchase, hire, upgrade,
  sale, tip and payment, and on the screen's few-second saver only while rounds are being played by hand (or once the
  stored copy is getting old, so a crash never costs more than a few minutes); always as the page goes out of view
  or closes. What the managers earn in between needs no writing: the save is a pure function of the clock, so the
  next opening earns it again, exactly. (sigOf says what counts.)

  Coins are paid only by the wallet's tycoonCollect, always with the save that follows from them (the vault emptied,
  the milestone marked, the chip counted), in one step: the coins and the save can never land apart, so each is paid
  exactly once. Each payment reads and replaces this.save at once, so a double click finds it already paid. Selling
  pays the milestones waiting first: several of them count what is on the floor, which the sale clears.

  A casino only ever touches the wallet it was opened from. When the player logs in or out the app swaps the wallet
  and then starts the page over; from the moment the wallet in use is another one, this casino writes nothing again.
  Should the wallet bring a newer save of its own (the account's copy, played on another device), it is taken up; and
  should the whole wallet be replaced (the account's conflict path), its save is taken up whatever its age, so the
  coins and the save that paid them agree again.
*/

/** the wallet in use, by the storage key it lives under (the guest's, or one account's) */
const walletName = () => useWallet.persist.getOptions().name ?? ''

/** an absence at least this long is greeted with what it brought (ms) */
export const AWAY_MS = 5 * 60_000
/** the stored save is written again once it is this old, changed or not (ms) */
const STALE_MS = 5 * 60_000

/**
 * What of a save the clock can't work out again: a change here is worth writing. That is everything bought and
 * paid, the boost, the manual rounds running (and how far), and the Cash to the nearest doubling: rounds played by
 * hand earn Cash the managers' clock knows nothing of, and a doubling is soon reached while they are being played
 * (and rarely by the managers alone, once the casino is grown).
 */
const sigOf = (s: Save) =>
  `${s.owned.join()}|${s.managers.map(Number).join('')}|${s.running.map((r, i) => (r ? s.progress[i].toFixed(2) : '')).join()}|${Math.floor(Math.log2(1 + s.cash))}|${s.upgrades.length}|${s.stars}|${s.sales}|${s.milestones.length}|${s.whales}|${s.chips}|${s.vault}|${s.vaultSince}|${s.boostUntil}`

/** a moment worth celebrating on the screen */
export type Moment =
  /** the first of an attraction bought */
  | { kind: 'open'; i: number }
  /** a count step reached (`at` the highest, `n` how many at once) */
  | { kind: 'step'; i: number; at: number; n: number }
  /** every attraction reached a count: all pay doubles */
  | { kind: 'all'; at: number }
  | { kind: 'hire'; i: number }
  | { kind: 'upgrade'; id: string }
  /** milestones newly reached (claimable) */
  | { kind: 'reached'; ids: string[] }

/** what happened while the player was away, for the card that greets them */
export interface AwayReport {
  /** how long since the save was last brought up to date (ms) */
  ms: number
  /** the most of that the managers worked (the offline limit) */
  limit: number
  /** Cash earned meanwhile */
  cash: number
  /** the Cash before, so the counter can roll up from it */
  cashBefore: number
  /** coins in the vault when the player left, and now, and what it holds */
  vaultBefore: number
  vault: number
  cap: number
  /** managers working, and milestones waiting to be claimed (and their coins) */
  managers: number
  due: number
  dueCoins: number
}

/** where the casino stood when the player stepped away (the page went out of view) */
export interface Snapshot {
  at: number
  cash: number
  lifetime: number
  vault: number
}

/** a sale's outcome, for the celebration */
export interface Sold {
  stars: number
  added: number
  city: number
  wasCity: number
  /** milestones paid on the way out, and their coins */
  milestones: number
  coins: number
}

/** the greeting for an absence of `ms` that brought `cash` and filled the vault from `vaultBefore` to `vault`: only a
 *  real absence (AWAY_MS or more) that brought something */
function report(s: Save, ms: number, cash: number, cashBefore: number, vaultBefore: number, vault: number, limit: number): AwayReport | null {
  if (ms < AWAY_MS || (cash <= 0 && vault - vaultBefore < 1)) return null
  const due = milestonesDue(s)
  return {
    ms,
    limit,
    cash,
    cashBefore,
    vaultBefore,
    vault,
    cap: vaultCap(s),
    managers: s.managers.filter((m, i) => m && s.owned[i] > 0).length,
    due: due.length,
    dueCoins: due.reduce((a, m) => a + m.coins, 0),
  }
}

/** `s` as if `ms` more had passed since it was saved: its clocks moved back */
const aged = (s: Save, ms: number): Save => ({ ...s, at: s.at - ms, vaultSince: s.vaultSince - ms, boostUntil: s.boostUntil > 0 ? s.boostUntil - ms : 0 })

export class Casino {
  save: Save
  /** what opening found, if the player was away long enough to tell them */
  readonly away: AwayReport | null
  onMoment?: (m: Moment) => void
  /** the wallet this casino was opened from */
  private readonly wallet = walletName()
  /** the save as last written to the wallet (or read from it), what of it counts, and how old it was */
  private written: unknown
  private writtenSig = ''
  private writtenAt: number
  /** milestones already announced as reached */
  private readonly told = new Set<string>()
  private closed = false

  constructor(now = Date.now()) {
    const raw = useWallet.getState().tycoon
    const stored = parseSave(raw, now)
    const base = stored ?? newSave(now)
    const { save, earned } = advance(base, now)
    this.save = save
    this.written = raw
    this.writtenAt = stored?.at ?? 0
    this.writtenSig = stored ? sigOf(stored) : ''
    for (const m of milestonesDue(save)) this.told.add(m.id)
    const ms = stored ? now - stored.at : 0
    const vaultBefore = stored ? vaultAt(stored, stored.at) : 0
    const vault = vaultAt(save, now)
    this.away = stored ? report(save, ms, earned, stored.cash, vaultBefore, vault, offlineLimit(stored)) : null
    // a brand-new casino is saved at once, so the next visit finds it
    if (!stored) this.persist(true)
  }

  /** the wallet in use is still the one this casino came from */
  get mine() {
    return !this.closed && walletName() === this.wallet
  }

  /**
   * Brings the save up to now. Returns the attractions that paid since the last tick (the floor throws their coins),
   * and announces milestones newly reached.
   */
  tick(now = Date.now()): number[] {
    const before = this.save
    const { save } = advance(before, now)
    this.save = save
    const paid: number[] = []
    const dt = Math.min(Math.max(0, now - before.at), offlineLimit(before)) / 1000
    for (let i = 0; i < N_ATTR; i++) {
      if (!before.owned[i]) continue
      if (before.managers[i] ? before.progress[i] + dt / cycleTime(before, i) >= 1 : before.running[i] && !save.running[i]) paid.push(i)
    }
    this.announce()
    return paid
  }

  /** starts a round of an attraction that has no manager (a tap on it, or its Run button) */
  tap(i: number, now = Date.now()) {
    if (!this.mine) return false
    this.tick(now)
    const next = tap(this.save, i)
    if (next === this.save) return false
    this.save = next
    return true
  }

  /** buys `k` of attraction i; false if the Cash doesn't cover it */
  buy(i: number, k: number, now = Date.now()) {
    if (!this.mine || k <= 0) return false
    this.tick(now)
    const before = this.save
    const next = buy(before, i, k, now)
    if (next === before) return false
    this.save = next
    const was = before.owned[i]
    const n = next.owned[i]
    if (was === 0) this.onMoment?.({ kind: 'open', i })
    // the count steps crossed (25, 50, 100: twice as fast; 200, 300 …: double pay)
    const crossed = stepsBetween(was, n)
    if (crossed.length) this.onMoment?.({ kind: 'step', i, at: crossed[crossed.length - 1], n: crossed.length })
    const all = allSteps(next)
    if (all > allSteps(before)) this.onMoment?.({ kind: 'all', at: ALL_STEPS[all - 1] })
    this.announce()
    this.persist()
    return true
  }

  hire(i: number, now = Date.now()) {
    if (!this.mine) return false
    this.tick(now)
    const next = hire(this.save, i)
    if (next === this.save) return false
    this.save = next
    this.onMoment?.({ kind: 'hire', i })
    this.announce()
    this.persist()
    return true
  }

  upgrade(id: string, now = Date.now()) {
    if (!this.mine) return false
    this.tick(now)
    const next = upgrade(this.save, id)
    if (next === this.save) return false
    this.save = next
    this.onMoment?.({ kind: 'upgrade', id })
    this.announce()
    this.persist()
    return true
  }

  /**
   * Sells the casino for Stars (only when it would bring some). The milestones waiting are paid first, each its own
   * payment: several count what stands on the floor (an attraction open, 100 of one, every manager), which the sale
   * clears, and a goal reached must not be lost for having been left unclaimed.
   */
  sell(now = Date.now()): Sold | null {
    if (!this.mine) return null
    this.tick(now)
    if (starsOnSale(this.save) <= 0) return null
    const due = milestonesDue(this.save)
    let coins = 0
    for (const m of due) coins += this.claim(m.id, now)
    const before = this.save
    const added = starsOnSale(before)
    this.save = sell(before, now)
    this.announce()
    this.persist()
    return { stars: this.save.stars, added, city: cityIndex(this.save.stars), wasCity: cityIndex(before.stars), milestones: due.length, coins }
  }

  /** the whale was tipped in time: all pay ×5 for a while */
  tipWhale(now = Date.now()) {
    if (!this.mine) return false
    this.tick(now)
    this.save = whale(this.save, now)
    this.announce()
    this.persist()
    return true
  }

  /** a golden chip caught: its coins paid, the chip counted (one step); returns the coins paid */
  catchChip(coins: number, now = Date.now()) {
    if (!this.mine) return 0
    this.tick(now)
    const paid = this.pay(coins, 'Golden chip', { ...this.save, chips: this.save.chips + 1 })
    this.announce()
    return paid
  }

  /** where the casino stands now: the page is going out of view */
  snapshot(now = Date.now()): Snapshot {
    this.tick(now)
    return { at: now, cash: this.save.cash, lifetime: this.save.lifetime, vault: vaultAt(this.save, now) }
  }

  /** what the time since `then` brought, the page back in view: a report worth greeting the player with, or null */
  since(then: Snapshot, now = Date.now()) {
    this.tick(now)
    return report(this.save, now - then.at, this.save.lifetime - then.lifetime, then.cash, then.vault, vaultAt(this.save, now), offlineLimit(this.save))
  }

  /** coins in the vault now */
  vault(now = Date.now()) {
    return vaultAt(this.save, now)
  }

  /** empties the vault into the wallet (from VAULT_MIN coins); returns the coins paid */
  collectVault(now = Date.now()) {
    if (!this.mine) return 0
    this.tick(now)
    const { coins, save } = emptyVault(this.save, now)
    if (coins < VAULT_MIN) return 0
    return this.pay(coins, 'Coin Vault', save)
  }

  /** pays a milestone that is reached and not yet paid; returns its coins (0 if it isn't due) */
  claim(id: string, now = Date.now()) {
    if (!this.mine) return 0
    this.tick(now)
    const m = MILESTONES.find((x) => x.id === id)
    if (!m || this.save.milestones.includes(id) || !m.done(this.save)) return 0
    return this.pay(m.coins, `Milestone: ${m.name}`, markMilestone(this.save, id))
  }

  /** pays every milestone waiting, one by one (each its own entry in the history); returns the coins together */
  claimAll(now = Date.now()) {
    let total = 0
    for (const m of milestonesDue(this.save)) total += this.claim(m.id, now)
    return total
  }

  /**
   * Writes the save to the wallet if it is still this casino's wallet and the save holds something the clock can't
   * work out again, or the stored copy is getting old; `always`, whenever it changed at all (the page going).
   */
  persist(always = false) {
    if (!this.mine || this.save === this.written) return
    const sig = sigOf(this.save)
    if (!always && sig === this.writtenSig && this.save.at - this.writtenAt < STALE_MS) return
    useWallet.getState().saveTycoon(this.save)
    this.wrote(this.save, sig)
  }

  /**
   * The wallet holds a save this casino didn't write: the account's copy brought in from the server (played on
   * another device since). Taken up if it is newer than what this casino last wrote, or whatever its age when
   * `replaced` (the whole wallet was swapped for another copy, its coins with it); true if it was.
   */
  adopt(raw: unknown, replaced = false, now = Date.now()) {
    if (!this.mine || raw === this.written) return false
    const s = parseSave(raw, now)
    if (!s || (!replaced && s.at <= this.writtenAt)) return false
    this.save = advance(s, now).save
    this.wrote(raw, sigOf(s), s.at)
    this.told.clear()
    for (const m of milestonesDue(this.save)) this.told.add(m.id)
    return true
  }

  /** the save this casino last wrote (or read): a wallet change bringing anything else came from elsewhere */
  isOwn(raw: unknown) {
    return raw === this.written
  }

  /** writes nothing more (the page is going) */
  close() {
    this.persist(true)
    this.closed = true
  }

  /** dev: as if `ms` passed (the managers earn it, the vault fills, a boost runs out), up to the offline limit */
  skip(ms: number, now = Date.now()) {
    this.save = aged(this.save, ms)
    return this.tick(now)
  }

  /** dev: the save as if the player left `ms` ago, written, so the next opening greets them */
  leave(ms: number) {
    this.save = aged(this.save, ms)
    this.persist(true)
  }

  /**
   * Pays coins with the save they come from, in one step (tycoonCollect), and takes that save as this casino's.
   * It is marked written before the wallet changes, so the wallet's news of it is known as this casino's own.
   */
  private pay(coins: number, label: string, next: Save) {
    this.save = next
    this.wrote(next, sigOf(next))
    return useWallet.getState().tycoonCollect(coins, label, next)
  }

  private wrote(raw: unknown, sig: string, at = this.save.at) {
    this.written = raw
    this.writtenSig = sig
    this.writtenAt = at
  }

  /** milestones newly reached */
  private announce() {
    const fresh = milestonesDue(this.save).filter((m) => !this.told.has(m.id))
    if (!fresh.length) return
    for (const m of fresh) this.told.add(m.id)
    this.onMoment?.({ kind: 'reached', ids: fresh.map((m) => m.id) })
  }
}
