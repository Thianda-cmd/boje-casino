/*
  Casino Tycoon: an idle game that earns real (play-money) coins. The player builds a casino floor out of ten
  attractions, from a claw machine to penthouse suites. Each attraction runs in cycles and pays Cash (the game's own
  currency, which grows to astronomical sums) at the end of each one; buying more of it multiplies what it pays, and
  owning 25, 50 and 100 of one makes it run faster. Until a manager is hired, an attraction only runs a cycle when it
  is tapped; once one is, it runs on its own, also while the player is away (up to the offline limit). Cash upgrades
  multiply attractions' pay. Selling the casino (prestige) trades the floor for reputation Stars, each adding 2% to
  all pay for good, and enough Stars move the casino to a bigger city.

  Coins never come from Cash (Cash grows without limit; coins must not): they come from the Coin Vault, which fills at
  an hourly rate set by how far the player has come (attractions open, Stars, city) up to a few hours' worth, and from
  one-time Milestones. Both are worked out here; the wallet pays them (tycoonCollect).

  Everything is a pure function of the saved state and the clock, so the game can be saved rarely and caught up
  exactly (`advance`). (tools/tycoon-test.ts checks the maths; tools/tycoon-sim.ts plays it for pacing.)
*/

/* ---------------- the attractions ---------------- */

export interface Attraction {
  id: string
  name: string
  /** the price of the first one */
  cost: number
  /** each one bought costs this much more than the last */
  growth: number
  /** Cash per cycle, per one owned, before multipliers */
  pay: number
  /** seconds per cycle before speed-ups */
  time: number
  /** hiring its manager */
  manager: number
}

export const ATTRACTIONS: readonly Attraction[] = [
  { id: 'claw', name: 'Claw Machine', cost: 5, growth: 1.07, pay: 1.5, time: 1, manager: 1_000 },
  { id: 'slots', name: 'Slot Machine', cost: 75, growth: 1.15, pay: 75, time: 3, manager: 15_000 },
  { id: 'dice', name: 'Dice Table', cost: 900, growth: 1.14, pay: 650, time: 6, manager: 100_000 },
  { id: 'blackjack', name: 'Blackjack Table', cost: 11_000, growth: 1.13, pay: 5_000, time: 12, manager: 500_000 },
  { id: 'roulette', name: 'Roulette Wheel', cost: 130_000, growth: 1.12, pay: 60_000, time: 24, manager: 1_200_000 },
  { id: 'poker', name: 'Poker Room', cost: 1.6e6, growth: 1.11, pay: 7e5, time: 96, manager: 1e7 },
  { id: 'lounge', name: 'VIP Lounge', cost: 2e7, growth: 1.1, pay: 8.5e6, time: 384, manager: 1.1e8 },
  { id: 'bar', name: 'Sky Bar', cost: 2.4e8, growth: 1.09, pay: 1e8, time: 1536, manager: 5.5e8 },
  { id: 'stage', name: 'Grand Stage', cost: 3e9, growth: 1.08, pay: 1.3e9, time: 6144, manager: 1e10 },
  { id: 'suites', name: 'Penthouse Suites', cost: 3.6e10, growth: 1.07, pay: 3.5e10, time: 36864, manager: 1e11 },
]
export const N_ATTR = ATTRACTIONS.length

/** owning this many of an attraction halves its cycle time (each) */
export const SPEED_STEPS = [25, 50, 100] as const
/** and from 200, every 100 more doubles its pay */
export const PAY_STEP_FROM = 200
/** when every attraction reaches one of these counts, all pay doubles */
export const ALL_STEPS = [25, 50, 100, 200] as const

/* ---------------- upgrades ---------------- */

/** the first upgrade's price, each next one's factor, and a round's extra factor */
export const UPGRADE_START = 2.5e5
export const UPGRADE_STEP = 3
export const UPGRADE_ROUND = 1e3

export interface Upgrade {
  id: string
  name: string
  cost: number
  /** the attraction it multiplies (an index), or -1 for all of them */
  target: number
  mult: number
}

const UPGRADE_NAMES = ['Gold trim', 'Neon signs', 'Velvet ropes']
/** 33 upgrades, each doubling: three rounds over the ten attractions, each round ending with one for the whole floor */
export const UPGRADES: readonly Upgrade[] = (() => {
  const out: Upgrade[] = []
  let cost = UPGRADE_START
  for (let round = 0; round < UPGRADE_NAMES.length; round++) {
    for (let i = 0; i < N_ATTR; i++) {
      out.push({ id: `u${round}-${i}`, name: `${UPGRADE_NAMES[round]}: ${ATTRACTIONS[i].name}`, cost, target: i, mult: 2 })
      cost *= UPGRADE_STEP
    }
    out.push({ id: `u${round}-all`, name: `${UPGRADE_NAMES[round]}: whole floor`, cost: cost * 3, target: -1, mult: 2 })
    cost *= UPGRADE_ROUND
  }
  return out
})()

/* ---------------- stars, perks, cities ---------------- */

/** each Star adds this much to all pay */
export const STAR_BONUS = 0.02
/** Stars earned for a lifetime's Cash: STAR_K × ∛(cash / STAR_SCALE) */
export const STAR_SCALE = 1e12
export const STAR_K = 25
export const starsFor = (lifetime: number) => Math.floor(STAR_K * Math.cbrt(Math.max(0, lifetime) / STAR_SCALE))

export const CITIES = [
  { name: 'Boje Town', stars: 0 },
  { name: 'Riverside', stars: 25 },
  { name: 'Desert Strip', stars: 150 },
  { name: 'Neon Bay', stars: 600 },
  { name: 'Monaco Heights', stars: 2000 },
] as const
export const cityIndex = (stars: number) => CITIES.reduce((i, c, k) => (stars >= c.stars ? k : i), 0)

/** reputation perks: unlocked for good by Stars held */
export const PERKS = [
  { stars: 10, name: 'Trusted name', text: 'Managers cost 25% less.' },
  { stars: 40, name: 'Night shift', text: 'Offline earnings last 4 hours longer.' },
  { stars: 100, name: 'Bigger vault', text: 'The Coin Vault holds 1 hour more.' },
  { stars: 250, name: 'Head start', text: 'A new casino opens with 10 Claw Machines and 5 Slot Machines.' },
  { stars: 1000, name: 'Legendary', text: 'Everything runs twice as fast.' },
] as const
export const hasPerk = (stars: number, k: number) => stars >= PERKS[k].stars

/* ---------------- the save ---------------- */

export interface Save {
  /** a format version, for reading old saves */
  v: 1
  cash: number
  /** Cash earned since the casino opened (for Stars on a sale) */
  earned: number
  /** Cash earned over all casinos */
  lifetime: number
  owned: number[]
  managers: boolean[]
  /** cycle progress per attraction, 0..1 */
  progress: number[]
  /** a manual (unmanaged) cycle is running */
  running: boolean[]
  upgrades: string[]
  /** Stars held (they stay through sales) */
  stars: number
  sales: number
  /** the vault: coins banked so far, and since when it has been filling at the current rate (ms) */
  vault: number
  vaultSince: number
  /** milestones already paid */
  milestones: string[]
  /** whales tipped, golden chips caught */
  whales: number
  chips: number
  /** when this save was last advanced (ms) */
  at: number
  /** a Cash boost (from a whale) runs until this time, × its factor */
  boostUntil: number
  boostMult: number
}

export function newSave(now: number, stars = 0, keep?: Partial<Save>): Save {
  const s: Save = {
    v: 1,
    cash: 5,
    earned: 0,
    lifetime: 0,
    owned: new Array(N_ATTR).fill(0),
    managers: new Array(N_ATTR).fill(false),
    progress: new Array(N_ATTR).fill(0),
    running: new Array(N_ATTR).fill(false),
    upgrades: [],
    stars,
    sales: 0,
    vault: 0,
    vaultSince: now,
    milestones: [],
    whales: 0,
    chips: 0,
    at: now,
    boostUntil: 0,
    boostMult: 1,
    ...keep,
  }
  if (hasPerk(s.stars, 3)) {
    s.owned[0] = Math.max(s.owned[0], 10)
    s.owned[1] = Math.max(s.owned[1], 5)
  }
  return s
}

/* ---------------- what things are worth ---------------- */

/** how many of the SPEED_STEPS an attraction has reached */
const speedSteps = (n: number) => SPEED_STEPS.filter((k) => n >= k).length

/** seconds per cycle for attraction i with n owned */
export function cycleTime(s: Save, i: number): number {
  let t = ATTRACTIONS[i].time / 2 ** speedSteps(s.owned[i])
  if (hasPerk(s.stars, 4)) t /= 2
  return t
}

/** how many ALL_STEPS every attraction has reached */
export const allSteps = (s: Save) => ALL_STEPS.filter((k) => s.owned.every((n) => n >= k)).length

/** the multiplier on attraction i's pay (upgrades, count steps, all-steps, Stars), not counting a whale boost */
export function payMult(s: Save, i: number): number {
  let m = 1
  for (const u of UPGRADES) if ((u.target === i || u.target === -1) && s.upgrades.includes(u.id)) m *= u.mult
  const n = s.owned[i]
  if (n >= PAY_STEP_FROM) m *= 2 ** (1 + Math.floor((n - PAY_STEP_FROM) / 100))
  m *= 2 ** allSteps(s)
  m *= 1 + STAR_BONUS * s.stars
  return m
}

/** Cash one cycle of attraction i pays */
export const cyclePay = (s: Save, i: number) => ATTRACTIONS[i].pay * s.owned[i] * payMult(s, i)

/** Cash per second attraction i makes while it runs non-stop */
export const rateOf = (s: Save, i: number) => (s.owned[i] ? cyclePay(s, i) / cycleTime(s, i) : 0)

/** Cash per second of the managed attractions (what the casino makes on its own) */
export const autoRate = (s: Save) => ATTRACTIONS.reduce((a, _x, i) => a + (s.managers[i] ? rateOf(s, i) : 0), 0)

/** the cost of buying `k` more of attraction i (a geometric series) */
export function costOf(s: Save, i: number, k: number): number {
  const a = ATTRACTIONS[i]
  const g = a.growth
  return (a.cost * g ** s.owned[i] * (g ** k - 1)) / (g - 1)
}

/** the most of attraction i the cash can buy */
export function maxAffordable(s: Save, i: number): number {
  const a = ATTRACTIONS[i]
  const g = a.growth
  const first = a.cost * g ** s.owned[i]
  if (s.cash < first) return 0
  return Math.floor(Math.log((s.cash * (g - 1)) / first + 1) / Math.log(g) + 1e-9)
}

export const managerCost = (s: Save, i: number) => ATTRACTIONS[i].manager * (hasPerk(s.stars, 0) ? 0.75 : 1)

/** what the next count step of attraction i is, for the UI */
export function nextStep(s: Save, i: number): { at: number; what: string } {
  const n = s.owned[i]
  for (const k of SPEED_STEPS) if (n < k) return { at: k, what: 'twice as fast' }
  const at = n < PAY_STEP_FROM ? PAY_STEP_FROM : PAY_STEP_FROM + 100 * (1 + Math.floor((n - PAY_STEP_FROM) / 100))
  return { at, what: 'double pay' }
}

/* ---------------- the clock ---------------- */

/** offline earnings stop after this long away (ms) */
export const offlineLimit = (s: Save) => (8 + (hasPerk(s.stars, 1) ? 4 : 0)) * 3_600_000

/**
 * The save brought up to `now`: every running attraction completes its cycles and pays (managed ones keep starting
 * new cycles; a manual one stops after the cycle it was on). Time beyond the offline limit is not counted. A clock
 * that went backwards counts as no time. Returns the Cash earned too.
 */
export function advance(s: Save, now: number): { save: Save; earned: number } {
  const dtMs = Math.min(Math.max(0, now - s.at), offlineLimit(s))
  if (dtMs <= 0) return { save: now < s.at ? { ...s, at: now } : s, earned: 0 }
  const dt = dtMs / 1000
  const progress = s.progress.slice()
  const running = s.running.slice()
  let earned = 0
  // the boost covers part of the time, at most
  const boostedMs = Math.max(0, Math.min(now, s.boostUntil) - s.at)
  const boostShare = s.boostMult > 1 ? Math.min(1, boostedMs / dtMs) : 0
  const boost = 1 + boostShare * (s.boostMult - 1)
  for (let i = 0; i < N_ATTR; i++) {
    if (!s.owned[i]) continue
    const t = cycleTime(s, i)
    if (s.managers[i]) {
      const total = progress[i] + dt / t
      const cycles = Math.floor(total)
      progress[i] = total - cycles
      earned += cycles * cyclePay(s, i) * boost
    } else if (running[i]) {
      const total = progress[i] + dt / t
      if (total >= 1) {
        earned += cyclePay(s, i) * boost
        progress[i] = 0
        running[i] = false
      } else progress[i] = total
    }
  }
  return {
    save: { ...s, progress, running, cash: s.cash + earned, earned: s.earned + earned, lifetime: s.lifetime + earned, at: now },
    earned,
  }
}

/* ---------------- actions (each on a save already advanced to now) ---------------- */

/** tap an attraction without a manager: starts a cycle if one isn't running */
export function tap(s: Save, i: number): Save {
  if (!s.owned[i] || s.managers[i] || s.running[i]) return s
  const running = s.running.slice()
  running[i] = true
  const progress = s.progress.slice()
  progress[i] = 0
  return { ...s, running, progress }
}

/** buy `k` of attraction i if the Cash covers it */
export function buy(s: Save, i: number, k: number, now: number): Save {
  if (k <= 0) return s
  const c = costOf(s, i, k)
  if (c > s.cash) return s
  const owned = s.owned.slice()
  const opening = owned[i] === 0
  owned[i] += k
  const next = { ...s, cash: s.cash - c, owned }
  // opening a new attraction raises the vault's rate: bank what it held at the old rate first
  return opening ? rebank(s, next, now) : next
}

export function hire(s: Save, i: number): Save {
  const c = managerCost(s, i)
  if (s.managers[i] || !s.owned[i] || c > s.cash) return s
  const managers = s.managers.slice()
  managers[i] = true
  const running = s.running.slice()
  running[i] = false
  return { ...s, cash: s.cash - c, managers, running }
}

export function upgrade(s: Save, id: string): Save {
  const u = UPGRADES.find((x) => x.id === id)
  if (!u || s.upgrades.includes(id) || u.cost > s.cash) return s
  return { ...s, cash: s.cash - u.cost, upgrades: [...s.upgrades, id] }
}

/** the Stars a sale would add now */
export const starsOnSale = (s: Save) => Math.max(0, starsFor(s.lifetime) - s.stars)

/** sell the casino: a new floor in the city the Stars reach, the Stars, the vault and milestones kept */
export function sell(s: Save, now: number): Save {
  const add = starsOnSale(s)
  const stars = s.stars + add
  const next = newSave(now, stars, {
    lifetime: s.lifetime,
    sales: s.sales + 1,
    milestones: s.milestones,
    whales: s.whales,
    chips: s.chips,
    vault: s.vault,
    vaultSince: s.vaultSince,
  })
  return rebank(s, next, now)
}

/** a whale was tipped: all pay × `mult` for `ms` */
export function whale(s: Save, now: number, mult = 5, ms = 45_000): Save {
  return { ...s, whales: s.whales + 1, boostUntil: now + ms, boostMult: mult }
}

/* ---------------- the Coin Vault ---------------- */

/** coins per hour the vault fills at */
export function coinRate(s: Save): number {
  const open = s.owned.filter((n) => n > 0).length
  return 10 + 2 * open + 0.2 * Math.min(s.stars, 100) + 3 * cityIndex(s.stars)
}
/** the most the vault holds */
export const vaultCap = (s: Save) => Math.round(coinRate(s) * (4 + cityIndex(s.stars) + (hasPerk(s.stars, 2) ? 1 : 0)) * 100) / 100

/** the vault pays out from this many coins (so a collect is never a few cents in the reward history) */
export const VAULT_MIN = 5

/**
 * Coins in the vault at `now` (whole cents). It fills up to its cap and stops there; coins already banked are never
 * cut, though (a sale opens a casino whose cap is lower for a while): it simply doesn't fill until it is emptied.
 * Time before `vaultSince` counts for nothing (a clock that was set back).
 */
export function vaultAt(s: Save, now: number): number {
  const hours = Math.max(0, now - s.vaultSince) / 3_600_000
  const cap = Math.max(vaultCap(s), s.vault)
  // (the nudge keeps a full vault at exactly its cap: 139.2 × 100 is 13919.999… in floating point)
  return Math.floor(Math.min(cap, s.vault + coinRate(s) * hours) * 100 + 1e-6) / 100
}

/** `next` with the vault's filling so far (at `before`'s rate) banked, and filling from now at its own rate (from
 *  its old start, if that is still ahead of the clock) */
function rebank(before: Save, next: Save, now: number): Save {
  return { ...next, vault: vaultAt(before, now), vaultSince: Math.max(now, before.vaultSince) }
}

/** empties the vault: the coins to pay, and the save after */
export function emptyVault(s: Save, now: number): { coins: number; save: Save } {
  const coins = vaultAt(s, now)
  return { coins, save: { ...s, vault: 0, vaultSince: Math.max(now, s.vaultSince) } }
}

/* ---------------- milestones ---------------- */

export interface Milestone {
  id: string
  name: string
  text: string
  /** coins paid once */
  coins: number
  done: (s: Save) => boolean
}

export const MILESTONES: readonly Milestone[] = [
  ...ATTRACTIONS.map((a, i) => ({ id: `open-${a.id}`, name: `Open: ${a.name}`, text: `Buy your first ${a.name}.`, coins: [20, 25, 35, 50, 70, 90, 120, 150, 200, 250][i], done: (s: Save) => s.owned[i] > 0 })),
  { id: 'any-100', name: 'Packed floor', text: 'Own 100 of one attraction.', coins: 80, done: (s) => s.owned.some((n) => n >= 100) },
  { id: 'all-25', name: 'Full house', text: 'Own 25 of every attraction.', coins: 300, done: (s) => s.owned.every((n) => n >= 25) },
  { id: 'all-100', name: 'Mega resort', text: 'Own 100 of every attraction.', coins: 800, done: (s) => s.owned.every((n) => n >= 100) },
  { id: 'manager-1', name: 'First hire', text: 'Hire a manager.', coins: 25, done: (s) => s.managers.some(Boolean) },
  { id: 'manager-all', name: 'Dream team', text: 'Hire all ten managers.', coins: 300, done: (s) => s.managers.every(Boolean) },
  { id: 'upgrades-10', name: 'Makeover', text: 'Buy 10 upgrades.', coins: 120, done: (s) => s.upgrades.length >= 10 },
  { id: 'upgrades-all', name: 'Spared no expense', text: 'Buy every upgrade.', coins: 1000, done: (s) => s.upgrades.length >= UPGRADES.length },
  { id: 'cash-1e6', name: 'Millionaire', text: 'Earn 1 million Cash in all.', coins: 50, done: (s) => s.lifetime >= 1e6 },
  { id: 'cash-1e9', name: 'Billionaire', text: 'Earn 1 billion Cash in all.', coins: 150, done: (s) => s.lifetime >= 1e9 },
  { id: 'cash-1e12', name: 'Trillionaire', text: 'Earn 1 trillion Cash in all.', coins: 400, done: (s) => s.lifetime >= 1e12 },
  { id: 'cash-1e15', name: 'Quadrillionaire', text: 'Earn 1 quadrillion Cash in all.', coins: 800, done: (s) => s.lifetime >= 1e15 },
  { id: 'cash-1e18', name: 'Off the charts', text: 'Earn 1 quintillion Cash in all.', coins: 1500, done: (s) => s.lifetime >= 1e18 },
  { id: 'sale-1', name: 'Fresh start', text: 'Sell your casino for Stars.', coins: 200, done: (s) => s.sales >= 1 },
  { id: 'stars-100', name: 'Rising star', text: 'Hold 100 Stars.', coins: 400, done: (s) => s.stars >= 100 },
  { id: 'stars-1000', name: 'Superstar', text: 'Hold 1,000 Stars.', coins: 1200, done: (s) => s.stars >= 1000 },
  ...CITIES.slice(1).map((c, k) => ({ id: `city-${k + 1}`, name: `Welcome to ${c.name}`, text: `Reach ${c.stars.toLocaleString('en-US')} Stars and move to ${c.name}.`, coins: [300, 600, 1000, 2000][k], done: (s: Save) => s.stars >= c.stars })),
  { id: 'whales-10', name: 'Whale watcher', text: 'Tip 10 whales.', coins: 150, done: (s) => s.whales >= 10 },
  { id: 'whales-100', name: 'Whale whisperer', text: 'Tip 100 whales.', coins: 500, done: (s) => s.whales >= 100 },
  { id: 'chips-25', name: 'Chip hunter', text: 'Catch 25 golden chips.', coins: 150, done: (s) => s.chips >= 25 },
]
/** milestones reached and not yet paid */
export const milestonesDue = (s: Save) => MILESTONES.filter((m) => !s.milestones.includes(m.id) && m.done(s))
/** marks a milestone paid (the wallet pays its coins) */
export const markMilestone = (s: Save, id: string): Save => (s.milestones.includes(id) ? s : { ...s, milestones: [...s.milestones, id] })

/* ---------------- golden chips ---------------- */

/** a golden chip pays a few coins; they turn up while the player is around (the screen schedules them) */
export const CHIP_COINS = [5, 8, 10, 12, 15, 20] as const
export const chipCoins = (rng: () => number) => CHIP_COINS[Math.min(CHIP_COINS.length - 1, Math.floor(rng() * CHIP_COINS.length))]
/** the screen offers a golden chip about this often (ms), only to someone who has played in the last few minutes */
export const CHIP_EVERY = [8 * 60_000, 14 * 60_000] as const
/** and a whale about this often */
export const WHALE_EVERY = [3 * 60_000, 6 * 60_000] as const

/* ---------------- numbers ---------------- */

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
/** decimals that keep a mantissa (1 to 999) at three figures */
const figures = (v: number) => (v >= 100 ? 0 : v >= 10 ? 1 : 2)
/** Cash in short form: 999, 1.23K, 45.6M, 7.89B … then aa, ab … */
export function fmtCash(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (n < 1000) {
    if (n >= 10 || !(n % 1)) return Math.floor(n).toString()
    const t = n.toFixed(1)
    return t === '10.0' ? '10' : t
  }
  let k = Math.floor(Math.log10(n) / 3)
  let r = Number((n / 10 ** (k * 3)).toFixed(figures(n / 10 ** (k * 3))))
  // rounding can carry into the next size: 999.96K is 1.00M (not 1000K), and 99.96K is 100K (not 100.0K)
  if (r >= 1000) {
    k++
    r /= 1000
  }
  const s = k < SUFFIX.length ? SUFFIX[k] : String.fromCharCode(97 + Math.floor((k - SUFFIX.length) / 26)) + String.fromCharCode(97 + ((k - SUFFIX.length) % 26))
  return `${r.toFixed(figures(r))}${s}`
}

/** a saved game read back (anything odd falls back to a new casino) */
export function parseSave(raw: unknown, now: number): Save | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<Save>
  const arr = (x: unknown, ok: (v: unknown) => boolean) => Array.isArray(x) && x.length === N_ATTR && x.every(ok)
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0
  if (o.v !== 1 || !num(o.cash) || !num(o.earned) || !num(o.lifetime) || !num(o.stars) || !num(o.vault) || !num(o.vaultSince) || !num(o.at)) return null
  if (!arr(o.owned, (v) => Number.isInteger(v) && (v as number) >= 0) || !arr(o.managers, (v) => typeof v === 'boolean') || !arr(o.progress, (v) => num(v) && (v as number) < 1.0001) || !arr(o.running, (v) => typeof v === 'boolean')) return null
  if (!Array.isArray(o.upgrades) || !Array.isArray(o.milestones)) return null
  return {
    v: 1,
    cash: o.cash!,
    earned: o.earned!,
    lifetime: o.lifetime!,
    owned: o.owned!,
    managers: o.managers!,
    progress: o.progress!,
    running: o.running!,
    upgrades: o.upgrades.filter((id) => UPGRADES.some((u) => u.id === id)),
    stars: Math.floor(o.stars!),
    sales: num(o.sales) ? o.sales! : 0,
    vault: o.vault!,
    // (not brought back to now: a vault emptied on a clock that was ahead stays empty until the real time catches up)
    vaultSince: o.vaultSince!,
    milestones: o.milestones.filter((id) => MILESTONES.some((m) => m.id === id)),
    whales: num(o.whales) ? o.whales! : 0,
    chips: num(o.chips) ? o.chips! : 0,
    at: Math.min(o.at!, now),
    boostUntil: num(o.boostUntil) ? o.boostUntil! : 0,
    boostMult: num(o.boostMult) ? o.boostMult! : 1,
  }
}
