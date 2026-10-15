/* Provably fair Crash. Before betting opens the server publishes sha256(seed); once the round is
   over it reveals the seed. Anyone can then check that the seed matches the published hash and
   that the crash point follows from the seed:
     h = first 52 bits of sha256(seed + ':lumen')
     crash = floor(97 * 2^52 / (2^52 - h)) / 100, between 1.00 and 1000
   which gives P(crash >= x) = 0.97 / x. The database runs the same formula. */

const enc = new TextEncoder()

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function crashFromSeed(seed: string) {
  const h = BigInt('0x' + (await sha256Hex(`${seed}:lumen`)).slice(0, 13))
  const e = 2n ** 52n
  const cents = Number((97n * e) / (e - h))
  return Math.min(1000, Math.max(1, cents / 100))
}

export function newSeed() {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export interface Verdict {
  hashOk: boolean
  crashOk: boolean
  computed: number
}

export async function verifyRound(seed: string, hash: string, crash: number): Promise<Verdict> {
  const [h, c] = await Promise.all([sha256Hex(seed), crashFromSeed(seed)])
  return { hashOk: h === hash, crashOk: Math.abs(c - crash) < 0.005, computed: c }
}
