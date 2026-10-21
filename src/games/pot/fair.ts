/*
  Provably fair Pot Luck. Every round publishes sha256(seed) when it opens, before anyone pays in, and reveals the seed
  once the wheel has landed. Anyone can then check, here in the browser:
    the seed matches the published hash
    u = the first 52 bits of sha256(seed + ':pot') over 2^52
    the winning ticket = floor(u × tickets), with a ticket for every cent in the pot, numbered in the order paid
  (rules.ts winningTicket and winnerIndex). The database works the draw out the same way, in double precision like
  here (_pot_ticket in api/_lib/schema.js).

  The house bots follow from the published hash too: their plan is botPlan (rules.ts) fed by the numbers
  sha256(hash + ':bots:' + i), so who joins, with how much and when is fixed the moment the round opens, before anyone
  else pays in, and the database schedules exactly those deposits (_pot_bots). The check below compares them.

  The hashing is synchronous (Showtime's), so the stand-in and the page can work rounds out while they render.
*/

import { sha256 } from '../showtime/fair'
import { botPlan, ranges, ticketsOf, uFromHex, winnerIndex, winningTicket, type BotMove, type Deposit } from './rules'

export { newSeed } from '../crash/fair'
export { sha256 }

/** the draw a seed makes: u in [0, 1) */
export const drawOf = (seed: string) => uFromHex(sha256(`${seed}:pot`))

/** the house bots' numbers for a round, from its published hash: the i-th is the first 52 bits of sha256(hash:bots:i) over 2^52 */
export function botRng(hash: string): () => number {
  let i = 0
  return () => uFromHex(sha256(`${hash}:bots:${i++}`))
}

/** the house bots' plan for a round with this published hash */
export const botsOf = (hash: string): BotMove[] => botPlan(botRng(hash))

export interface Verdict {
  hashOk: boolean
  /** the ticket the seed draws, and the deposit holding it */
  ticket: number
  index: number
  /** the database's ticket agrees */
  ticketOk: boolean
  /** the bots' deposits are the plan the hash makes (null when the round's deposits don't say which were bots) */
  botsOk: boolean | null
}

/**
 * Checks a finished round: its seed against the published hash, the winning ticket it draws over the round's deposits
 * (in the order paid), and the bots' deposits against the plan from the hash. `opensAt` is when betting opened.
 */
export function verifyRound(seed: string, hash: string, deposits: readonly (Deposit & { at?: number })[], ticket: number | null, opensAt?: number): Verdict {
  const total = deposits.reduce((a, d) => a + ticketsOf(d.amount), 0)
  const u = drawOf(seed)
  const t = total ? winningTicket(total, u) : -1
  let botsOk: boolean | null = null
  if (opensAt != null && deposits.every((d) => d.at != null)) {
    const plan = botsOf(hash)
    const bots = deposits.filter((d) => d.bot)
    botsOk = plan.length === bots.length && plan.every((m, i) => bots[i].name === m.name && bots[i].amount === m.amount && bots[i].at! - opensAt === m.at)
  }
  return { hashOk: sha256(seed) === hash, ticket: t, index: winnerIndex(deposits, u), ticketOk: ticket == null ? total === 0 : ticket === t, botsOk }
}

/** the ticket range [from, to) of each deposit, for showing where the winning ticket fell */
export const ticketRanges = ranges
