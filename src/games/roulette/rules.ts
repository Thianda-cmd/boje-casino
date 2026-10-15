/* European roulette: one zero, 37 pockets. */

export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
export const colorOf = (n: number) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black')
export const POCKET_COLORS = { red: '#e3263f', black: '#1b2633', green: '#13a85a' } as const

/** Every bet the board offers, keyed by a short id, with the numbers it covers and its payout (stake included). */
export type BetKey = string
export function betNumbers(key: BetKey): number[] {
  const all = Array.from({ length: 36 }, (_, i) => i + 1)
  if (key.startsWith('n')) return [Number(key.slice(1))]
  switch (key) {
    case 'red':
      return all.filter((n) => RED.has(n))
    case 'black':
      return all.filter((n) => !RED.has(n))
    case 'odd':
      return all.filter((n) => n % 2 === 1)
    case 'even':
      return all.filter((n) => n % 2 === 0)
    case 'low':
      return all.filter((n) => n <= 18)
    case 'high':
      return all.filter((n) => n >= 19)
    case 'd1':
      return all.filter((n) => n <= 12)
    case 'd2':
      return all.filter((n) => n >= 13 && n <= 24)
    case 'd3':
      return all.filter((n) => n >= 25)
    case 'c1':
      return all.filter((n) => n % 3 === 1)
    case 'c2':
      return all.filter((n) => n % 3 === 2)
    case 'c3':
      return all.filter((n) => n % 3 === 0)
  }
  return []
}
/** Total return per coin staked when the bet wins: 36 / numbers covered (35:1, 2:1, 1:1). */
export const betPayout = (key: BetKey) => 36 / betNumbers(key).length
