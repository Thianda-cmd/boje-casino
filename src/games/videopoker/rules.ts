/* Jacks or Better video poker, 9/6 full pay. Pays are "for one", so Jacks or Better returns the stake. */

import type { Suit } from '../../art/suits'

export interface PCard {
  /** 2 to 14, ace high */
  r: number
  s: Suit
}

export type HandId = 'royal' | 'sflush' | 'quads' | 'full' | 'flush' | 'straight' | 'trips' | 'twopair' | 'jacks'

export const HANDS: { id: HandId; name: string; pay: number }[] = [
  { id: 'royal', name: 'Royal Flush', pay: 800 },
  { id: 'sflush', name: 'Straight Flush', pay: 50 },
  { id: 'quads', name: 'Four of a Kind', pay: 25 },
  { id: 'full', name: 'Full House', pay: 9 },
  { id: 'flush', name: 'Flush', pay: 6 },
  { id: 'straight', name: 'Straight', pay: 4 },
  { id: 'trips', name: 'Three of a Kind', pay: 3 },
  { id: 'twopair', name: 'Two Pair', pay: 2 },
  { id: 'jacks', name: 'Jacks or Better', pay: 1 },
]
export const PAY: Record<HandId, number> = Object.fromEntries(HANDS.map((h) => [h.id, h.pay])) as Record<HandId, number>

const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
export const RANK_LABEL = (r: number) => (r <= 10 ? String(r) : ['J', 'Q', 'K', 'A'][r - 11])

export function newDeck(): PCard[] {
  const d: PCard[] = []
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s })
  return d
}

/** Ranks a five-card hand. `used` marks the cards that make it (for highlighting). */
export function evaluate(cards: PCard[]): { hand: HandId | null; used: boolean[] } {
  const counts = new Map<number, number>()
  for (const c of cards) counts.set(c.r, (counts.get(c.r) ?? 0) + 1)
  const flush = cards.every((c) => c.s === cards[0].s)
  const ranks = [...counts.keys()].sort((a, b) => a - b)
  const straight = ranks.length === 5 && (ranks[4] - ranks[0] === 4 || (ranks[4] === 14 && ranks[3] === 5))
  const all = cards.map(() => true)
  if (straight && flush) return { hand: ranks[0] === 10 ? 'royal' : 'sflush', used: all }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const mark = (rs: number[]) => cards.map((c) => rs.includes(c.r))
  if (groups[0][1] === 4) return { hand: 'quads', used: mark([groups[0][0]]) }
  if (groups[0][1] === 3 && groups[1][1] === 2) return { hand: 'full', used: all }
  if (flush) return { hand: 'flush', used: all }
  if (straight) return { hand: 'straight', used: all }
  if (groups[0][1] === 3) return { hand: 'trips', used: mark([groups[0][0]]) }
  if (groups[0][1] === 2 && groups[1][1] === 2) return { hand: 'twopair', used: mark([groups[0][0], groups[1][0]]) }
  if (groups[0][1] === 2 && groups[0][0] >= 11) return { hand: 'jacks', used: mark([groups[0][0]]) }
  return { hand: null, used: cards.map(() => false) }
}

const cnt = new Uint8Array(15)
const WHEEL = (1 << 14) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)

/** Payout for a hand without building any highlighting: the hint search calls this a few hundred thousand times. */
function payOf(c: PCard[]): number {
  cnt.fill(0)
  let flush = true
  let bits = 0
  for (let i = 0; i < 5; i++) {
    cnt[c[i].r]++
    bits |= 1 << c[i].r
    if (c[i].s !== c[0].s) flush = false
  }
  let pairs = 0
  let trips = 0
  let quads = 0
  let high = false
  for (let r = 2; r <= 14; r++) {
    const n = cnt[r]
    if (n === 2) {
      pairs++
      if (r >= 11) high = true
    } else if (n === 3) trips++
    else if (n === 4) quads++
  }
  if (quads) return PAY.quads
  if (trips && pairs) return PAY.full
  if (!pairs && !trips) {
    let straight = bits === WHEEL
    for (let r = 2; r <= 10 && !straight; r++) if (((bits >> r) & 0x1f) === 0x1f) straight = true
    if (straight && flush) return bits === 0x7c00 ? PAY.royal : PAY.sflush
    if (flush) return PAY.flush
    if (straight) return PAY.straight
    return 0
  }
  if (trips) return PAY.trips
  if (pairs === 2) return PAY.twopair
  return high ? PAY.jacks : 0
}

/**
 * The hold with the best expected return. Draws of up to three cards are enumerated exactly;
 * four- and five-card draws are sampled, which is plenty to rank them.
 */
export function bestHold(hand: PCard[], deckLeft: PCard[], rng: () => number): { hold: boolean[]; ev: number } {
  let best = { hold: hand.map(() => false), ev: -1 }
  for (let mask = 0; mask < 32; mask++) {
    const held = hand.filter((_, i) => mask & (1 << i))
    const k = 5 - held.length
    let total = 0
    let n = 0
    if (k === 0) {
      total = payOf(held)
      n = 1
    } else if (k <= 3) {
      const idx = Array.from({ length: k }, (_, i) => i)
      const L = deckLeft.length
      for (;;) {
        total += payOf([...held, ...idx.map((i) => deckLeft[i])])
        n++
        let j = k - 1
        while (j >= 0 && idx[j] === L - k + j) j--
        if (j < 0) break
        idx[j]++
        for (let t = j + 1; t < k; t++) idx[t] = idx[t - 1] + 1
      }
    } else {
      const samples = 6000
      const pool = deckLeft.slice()
      for (let s = 0; s < samples; s++) {
        for (let i = 0; i < k; i++) {
          const j = i + Math.floor(rng() * (pool.length - i))
          ;[pool[i], pool[j]] = [pool[j], pool[i]]
        }
        total += payOf([...held, ...pool.slice(0, k)])
        n++
      }
    }
    const ev = total / n
    if (ev > best.ev + 1e-9) best = { hold: hand.map((_, i) => !!(mask & (1 << i))), ev }
  }
  return best
}
