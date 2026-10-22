/*
  Provably fair Kaiju Clash, on Showtime's commit-reveal (../showtime/fair.ts). Every round publishes sha256(seed)
  before betting opens. When betting closes the round reveals its key, sha256(seed + ':key'), and the whole fight
  follows from the key: the result (rules.ts drawResult) and the blow-by-blow script the stage plays (fight.ts
  drawFight). The seed itself is revealed at the final bell, so anyone can check that it hashes to the published hash
  and gives the key that was revealed.

  The i-th number drawn for a purpose ('result', 'first', 'dmg', ...) is the first 52 bits of sha256(key:purpose:i);
  below() turns one into a whole number under n in exact integer arithmetic, so every browser gets the same one.
*/

export { sha256, keyOf, drawFrom, verifyRound, newSeed, type Verdict } from '../showtime/fair'

/** where a round's numbers come from: the i-th whole number in [0, 2^52) drawn for `what` */
export type Draw = (what: string, i: number) => number

/** a draw as a whole number below n: floor(u × n / 2^52), in integers (as showtime/rules.ts below) */
export const below = (d: Draw, what: string, i: number, n: number) => Number((BigInt(d(what, i)) * BigInt(n)) >> 52n)
