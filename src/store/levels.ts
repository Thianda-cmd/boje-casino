/*
  Levels and VIP tiers: XP is coins wagered, each level needs more than the last, and level bands make the VIP tiers.
  Pure functions with no imports, so the wallet, the cosmetics and the pages can all read them without loading each
  other (src/store/wallet.ts re-exports them).
*/

/** XP = coins wagered. Each level needs more than the last. */
export const xpForLevel = (lvl: number) => Math.round(2000 * Math.pow(lvl, 1.55))
export const levelReward = (lvl: number) => 75 * lvl
export function levelFromXp(xp: number) {
  let lvl = 0
  let acc = 0
  while (acc + xpForLevel(lvl + 1) <= xp) {
    acc += xpForLevel(lvl + 1)
    lvl++
  }
  return { level: lvl, into: xp - acc, need: xpForLevel(lvl + 1) }
}

/** VIP tier names for level bands; purely cosmetic. */
export const TIERS = [
  { min: 0, name: 'Bronze', color: '#d4925a' },
  { min: 5, name: 'Silver', color: '#c6d2de' },
  { min: 12, name: 'Gold', color: '#f7c548' },
  { min: 25, name: 'Platinum', color: '#7fe3ff' },
  { min: 40, name: 'Diamond', color: '#b892ff' },
] as const
export const tierOf = (level: number) => [...TIERS].reverse().find((t) => level >= t.min)!
/** the VIP tier's index in TIERS for a level (0 Bronze … 4 Diamond) */
export const tierIndexOf = (level: number) => TIERS.reduce((i, t, k) => (level >= t.min ? k : i), 0)
