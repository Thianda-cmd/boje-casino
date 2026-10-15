// Cryptographically strong uniform float in [0, 1).
export function rand(): number {
  const buf = new Uint32Array(2)
  crypto.getRandomValues(buf)
  // 53 bits of randomness
  return (buf[0] * 2 ** 21 + (buf[1] >>> 11)) / 2 ** 53
}

export const randInt = (n: number) => Math.floor(rand() * n)

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
