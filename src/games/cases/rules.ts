import { rand } from '../../lib/rng'

/*
  Cases: pick a crate, open it, and one item is drawn from its table. Every table holds whole weights out of
  100,000 and multipliers in whole hundredths, so the return is an exact sum: Σ weight × mult = 0.98 × 100,000 for
  each crate (tools/cases-test.ts checks it, and samples the picker).

  Rarity and item art follow the multiplier, the same in every crate, so a colour always means the same money:
  slate pays back less than the bet, green 1× to 2×, blue 2× to 10×, violet 10× to 100× and gold 100× or more.
*/

export type Tier = 'low' | 'medium' | 'high' | 'extreme'
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export type ItemKind = 'copper' | 'silver' | 'coins' | 'cash' | 'bag' | 'bar' | 'watch' | 'ring' | 'trophy' | 'crown' | 'diamond' | 'chest'

export interface Item {
  mult: number
  /** out of WEIGHT_TOTAL */
  weight: number
  kind: ItemKind
  rarity: Rarity
}

export interface Crate {
  tier: Tier
  name: string
  risk: string
  items: Item[]
}

export const RTP = 0.98
export const WEIGHT_TOTAL = 100_000

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

export const RARITY: Record<Rarity, { name: string; color: string; glow: string }> = {
  common: { name: 'Common', color: '#8d9fb4', glow: 'rgba(141,159,180,.32)' },
  uncommon: { name: 'Uncommon', color: '#38d98a', glow: 'rgba(56,217,138,.38)' },
  rare: { name: 'Rare', color: '#4f9dff', glow: 'rgba(79,157,255,.42)' },
  epic: { name: 'Epic', color: '#ad72ff', glow: 'rgba(173,114,255,.46)' },
  legendary: { name: 'Legendary', color: '#ffc23d', glow: 'rgba(255,194,61,.5)' },
}

export function rarityOf(mult: number): Rarity {
  if (mult >= 100) return 'legendary'
  if (mult >= 10) return 'epic'
  if (mult >= 2) return 'rare'
  if (mult >= 1) return 'uncommon'
  return 'common'
}

/** the item drawn for a multiplier band */
export function kindOf(mult: number): ItemKind {
  if (mult >= 500) return 'chest'
  if (mult >= 100) return 'diamond'
  if (mult >= 50) return 'crown'
  if (mult >= 25) return 'trophy'
  if (mult >= 10) return 'ring'
  if (mult >= 4) return 'watch'
  if (mult >= 2) return 'bar'
  if (mult >= 1.5) return 'bag'
  if (mult >= 1) return 'cash'
  if (mult >= 0.6) return 'coins'
  if (mult >= 0.35) return 'silver'
  return 'copper'
}

export const ITEM_NAME: Record<ItemKind, string> = {
  copper: 'Copper Coin',
  silver: 'Silver Coins',
  coins: 'Gold Coins',
  cash: 'Cash Bundle',
  bag: 'Money Bag',
  bar: 'Gold Bar',
  watch: 'Gold Watch',
  ring: 'Diamond Ring',
  trophy: 'Golden Trophy',
  crown: 'Royal Crown',
  diamond: 'Grand Diamond',
  chest: 'Treasure Chest',
}

const table = (rows: [mult: number, weight: number][]): Item[] => rows.map(([mult, weight]) => ({ mult, weight, kind: kindOf(mult), rarity: rarityOf(mult) }))

export const TIERS: Tier[] = ['low', 'medium', 'high', 'extreme']

export const CRATES: Record<Tier, Crate> = {
  // mostly 0.5× to 2×: steady, small swings
  low: {
    tier: 'low',
    name: 'Wooden Crate',
    risk: 'Low risk',
    items: table([[0.3, 6000], [0.5, 27500], [0.8, 29750], [1.2, 22000], [1.6, 10000], [2.5, 3500], [5, 1000], [10, 250]]),
  },
  medium: {
    tier: 'medium',
    name: 'Steel Crate',
    risk: 'Medium risk',
    items: table([[0.2, 33440], [0.5, 25800], [0.8, 14000], [1.2, 12010], [1.8, 8000], [3, 4500], [6, 1600], [15, 500], [40, 120], [100, 30]]),
  },
  high: {
    tier: 'high',
    name: 'Gold Crate',
    risk: 'High risk',
    items: table([[0.1, 46320], [0.4, 30170], [0.7, 10000], [1.5, 7000], [3, 3800], [7, 1500], [15, 700], [30, 300], [60, 140], [150, 60], [500, 10]]),
  },
  // nine opens in ten pay back under half; the rest reach for 100× and 1,000×
  extreme: {
    tier: 'extreme',
    name: 'Obsidian Crate',
    risk: 'Extreme risk',
    items: table([[0.1, 53660], [0.4, 39135], [2, 3490], [4, 2000], [10, 900], [25, 400], [50, 240], [100, 160], [1000, 15]]),
  },
}

/** Draws an item index; `r` is a uniform number in [0, 1). */
export function pickIndex(crate: Crate, r = rand()): number {
  let x = Math.floor(r * WEIGHT_TOTAL)
  const items = crate.items
  for (let i = 0; i < items.length; i++) {
    x -= items[i].weight
    if (x < 0) return i
  }
  return items.length - 1
}

export const chanceOf = (item: Item) => item.weight / WEIGHT_TOTAL
export const topMult = (crate: Crate) => crate.items[crate.items.length - 1].mult
/** chance an open pays back the bet or more */
export const hitChance = (crate: Crate) => crate.items.filter((it) => it.mult >= 1).reduce((a, it) => a + it.weight, 0) / WEIGHT_TOTAL

/** 0.30×, 2.50×, 15×, 1,000× */
export function multLabel(m: number) {
  return m >= 10 ? `${m.toLocaleString('en-US', { maximumFractionDigits: 0 })}×` : `${m.toFixed(2)}×`
}

/** 53.66%, 3.49%, 0.250%, 0.015% */
export function chanceLabel(p: number) {
  const pct = p * 100
  return `${pct >= 1 ? pct.toFixed(2) : pct >= 0.1 ? pct.toFixed(3).replace(/0$/, '') : pct.toFixed(3)}%`
}

/** "1 in 6,667" */
export function oddsLabel(p: number) {
  const n = 1 / p
  return `1 in ${n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US')}`
}

/* ---------------- the reel strip ---------------- */

export interface Tile {
  id: number
  /** index into the crate's items */
  item: number
  tier: Tier
}

let nextTileId = 1
export const makeTile = (tier: Tier, item: number): Tile => ({ id: nextTileId++, item, tier })

/** A row of `n` honest fillers: every one drawn from the crate's own table. */
export function fillers(crate: Crate, n: number, r: () => number = rand): Tile[] {
  return Array.from({ length: n }, () => makeTile(crate.tier, pickIndex(crate, r())))
}

/**
 * The strip for one open: the tiles on screen now (`keep`, with the one under the marker at `at`, so nothing jumps
 * when the reel starts), then fillers, the winner `travel` tiles on from `at`, and `after` more fillers past it so the
 * reel stays full when it stops. `travel` must reach past the kept tiles.
 */
export function buildStrip(crate: Crate, keep: Tile[], at: number, travel: number, winner: number, after: number, r: () => number = rand) {
  const win = at + travel
  if (win < keep.length) throw new Error('the winner would replace a tile on screen')
  const tiles = [...keep, ...fillers(crate, win - keep.length, r), makeTile(crate.tier, winner), ...fillers(crate, after, r)]
  return { tiles, win }
}
