/*
  Pot Luck's rules: a live pot that players and house bots pay into; one of them takes it all.

  A round has a betting window (BET_MS), then the draw (SPIN_MS, the wheel turning) and a moment to show the winner
  (SHOW_MS). During the window anyone may pay coins into the pot, a few times (MAX_DEPOSITS, at most MAX_PER_PLAYER
  in all). Every cent paid in is one ticket, numbered in the order the coins went in. The draw picks one ticket
  uniformly; its owner wins the pot less the RAKE, to the cent (rounded down).

  So a player's chance of winning is exactly their share of the pot, and on average every coin paid in comes back as
  1 - RAKE coins, however big or small the pot, however many players, and whoever else paid in: the return is
  1 - RAKE for every player and every way of playing. A player alone in a round (no bots joined) wins their own coins
  back less the rake.

  The draw is provably fair, like Double's: the round publishes sha256(seed) when it opens, before anyone pays in,
  and reveals the seed after the draw; u is the first 52 bits of sha256(seed + ':pot') over 2^52, and the winning
  ticket is floor(u × tickets). (2^52 is not a multiple of the ticket count; the pull toward the low tickets is
  under tickets / 2^52, a few parts in a trillion.)

  House bots keep a round going when few people are about. They pay in like anyone (BOT_* below set how many, how
  much and when), with house coins: a bot's win is the house's, so the house's edge is the rake on the players'
  coins and nothing else. (tools/pot-test.ts checks the tickets, the draw, the exact return and the bots' plan.)
*/

export const RAKE = 0.04
export const BET_MS = 20_000
export const SPIN_MS = 7_000
export const SHOW_MS = 4_000
export const CYCLE_MS = BET_MS + SPIN_MS + SHOW_MS
/** betting closes this long before the window ends, so a late payment can't race the draw */
export const CLOSE_MS = 600

export const MIN_DEPOSIT = 1
export const MAX_DEPOSIT = 10_000
export const MAX_PER_PLAYER = 25_000
export const MAX_DEPOSITS = 5

export interface Deposit {
  /** who paid: a player's id (or a bot's, 'bot_<name>') */
  who: string
  name: string
  avatar: number
  /** coins, to the cent */
  amount: number
  bot?: boolean
}

/** a cent is a ticket */
export const ticketsOf = (amount: number) => Math.round(amount * 100)
export const potOf = (ds: readonly Deposit[]) => ds.reduce((a, d) => a + ticketsOf(d.amount), 0) / 100

/** each deposit's tickets, in the order they went in: [from, to) */
export function ranges(ds: readonly Deposit[]): { who: string; from: number; to: number }[] {
  let at = 0
  return ds.map((d) => {
    const from = at
    at += ticketsOf(d.amount)
    return { who: d.who, from, to: at }
  })
}

/** the winning ticket for a draw u in [0, 1) */
export const winningTicket = (tickets: number, u: number) => Math.min(tickets - 1, Math.floor(u * tickets))

/** the deposit holding the winning ticket (its index), or -1 for an empty pot */
export function winnerIndex(ds: readonly Deposit[], u: number): number {
  const total = ds.reduce((a, d) => a + ticketsOf(d.amount), 0)
  if (!total) return -1
  const t = winningTicket(total, u)
  const rs = ranges(ds)
  return rs.findIndex((r) => t >= r.from && t < r.to)
}

/** what the winner is paid for a pot: all of it less the rake, rounded down to the cent */
export const winnings = (pot: number) => Math.floor(Math.round(pot * 100) * (1 - RAKE) + 1e-6) / 100

/** each player's coins in the pot and share of it, biggest first */
export function shares(ds: readonly Deposit[]): { who: string; name: string; avatar: number; bot: boolean; amount: number; share: number }[] {
  const total = potOf(ds)
  const by = new Map<string, { who: string; name: string; avatar: number; bot: boolean; cents: number }>()
  for (const d of ds) {
    const s = by.get(d.who) ?? { who: d.who, name: d.name, avatar: d.avatar, bot: !!d.bot, cents: 0 }
    s.cents += ticketsOf(d.amount)
    by.set(d.who, s)
  }
  return [...by.values()].map((s) => ({ who: s.who, name: s.name, avatar: s.avatar, bot: s.bot, amount: s.cents / 100, share: total ? s.cents / 100 / total : 0 })).sort((a, b) => b.amount - a.amount)
}

/** what a player is paid by a drawn round: the winnings if their ticket won, else nothing */
export function payoutFor(who: string, ds: readonly Deposit[], u: number): number {
  const i = winnerIndex(ds, u)
  return i >= 0 && ds[i].who === who ? winnings(potOf(ds)) : 0
}

/** why a deposit can't go in, or null if it can */
export function refuse(ds: readonly Deposit[], who: string, amount: number): string | null {
  if (!(amount >= MIN_DEPOSIT)) return `At least ${MIN_DEPOSIT} coin`
  if (amount > MAX_DEPOSIT) return `At most ${MAX_DEPOSIT.toLocaleString('en-US')} at a time`
  if (Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return 'Whole cents only'
  const mine = ds.filter((d) => d.who === who)
  if (mine.length >= MAX_DEPOSITS) return `At most ${MAX_DEPOSITS} payments a round`
  if (mine.reduce((a, d) => a + d.amount, 0) + amount > MAX_PER_PLAYER + 1e-9) return `At most ${MAX_PER_PLAYER.toLocaleString('en-US')} a round`
  return null
}

/* ---------------- the draw ---------------- */

/** u from the first 13 hex digits (52 bits) of a hash, as the database and the browser both work it out */
export const uFromHex = (hex: string) => parseInt(hex.slice(0, 13), 16) / 2 ** 52

/* ---------------- house bots ---------------- */

/** the house bots' names and avatars (Avatar indexes 0-15) */
export const BOTS: readonly { name: string; avatar: number }[] = [
  { name: 'Ziggy', avatar: 2 },
  { name: 'Marlo', avatar: 5 },
  { name: 'Pip', avatar: 7 },
  { name: 'Juno', avatar: 11 },
  { name: 'Rocco', avatar: 13 },
  { name: 'Tilly', avatar: 1 },
  { name: 'Bram', avatar: 6 },
  { name: 'Nova', avatar: 15 },
  { name: 'Kit', avatar: 8 },
  { name: 'Ozzy', avatar: 12 },
]
/** how many bots join a round: at least, at most */
export const BOT_COUNT = [2, 5] as const
/** the amounts a bot pays in, and how often each is chosen */
export const BOT_AMOUNTS: readonly (readonly [amount: number, weight: number])[] = [
  [5, 10],
  [10, 16],
  [25, 18],
  [50, 16],
  [100, 14],
  [250, 10],
  [500, 7],
  [1000, 5],
  [2500, 3],
  [5000, 1],
]

export interface BotMove {
  /** ms into the betting window */
  at: number
  name: string
  avatar: number
  amount: number
}

/**
 * The bots' plan for a round: how many, who, how much and when (spread over the window, the last a little before it
 * closes). The live server follows the same plan from its own random numbers; the offline stand-in uses this one.
 */
export function botPlan(rng: () => number): BotMove[] {
  const n = BOT_COUNT[0] + Math.floor(rng() * (BOT_COUNT[1] - BOT_COUNT[0] + 1))
  const pool = [...BOTS]
  const total = BOT_AMOUNTS.reduce((a, [, w]) => a + w, 0)
  const moves: BotMove[] = []
  for (let i = 0; i < n; i++) {
    const b = pool.splice(Math.floor(rng() * pool.length), 1)[0]
    let x = rng() * total
    let amount = BOT_AMOUNTS[0][0]
    for (const [a, w] of BOT_AMOUNTS) {
      if ((x -= w) < 0) {
        amount = a
        break
      }
    }
    const at = Math.round(1500 + rng() * (BET_MS - CLOSE_MS - 3000))
    moves.push({ at, name: b.name, avatar: b.avatar, amount })
  }
  return moves.sort((a, b) => a.at - b.at)
}
