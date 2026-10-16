/* Provably fair Double. Every round publishes sha256(seed) when it is created, before anyone bets, and reveals the
   seed once the strip has landed. Anyone can then check that the seed matches the published hash and that the roll
   follows from the seed:
     h = first 52 bits of sha256(seed + ':double')
     roll = h mod 33        (0 green, 1 to 16 red, 17 to 32 black)
   2^52 is not a multiple of 33, but the pull towards the low rolls is under 33 / 2^52, about one part in 10^14.
   The database runs the same formula (_dbl_roll in api/_lib/schema.js). */

import { sha256Hex } from '../crash/fair'

export { newSeed, sha256Hex } from '../crash/fair'

export async function rollFromSeed(seed: string) {
  const h = BigInt('0x' + (await sha256Hex(`${seed}:double`)).slice(0, 13))
  return Number(h % 33n)
}

export interface Verdict {
  hashOk: boolean
  rollOk: boolean
  computed: number
}

export async function verifyRound(seed: string, hash: string, roll: number): Promise<Verdict> {
  const [h, r] = await Promise.all([sha256Hex(seed), rollFromSeed(seed)])
  return { hashOk: h === hash, rollOk: r === roll, computed: r }
}
