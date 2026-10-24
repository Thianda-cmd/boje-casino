import { fmt } from '../../lib/format'
import { ITEM_KINDS, PRIZE_KINDS, type DropResult, type Feature, type ItemKind } from './types'

/* Coin Cascade's words: what things are called, how a multiplier reads, and what a drop's result is called. */

export const NAME: Record<ItemKind, string> = { silver: 'Silver coin', gold: 'Gold coin', gem: 'Gem', bar: 'Gold bar', idol: 'Golden Idol', crown: 'Crown' }
export const PLURAL: Record<ItemKind, string> = { silver: 'silver coins', gold: 'gold coins', gem: 'gems', bar: 'gold bars', idol: 'Golden Idols', crown: 'Crowns' }
const ONE: Record<ItemKind, string> = { silver: 'a silver coin', gold: 'a gold coin', gem: 'a gem', bar: 'a gold bar', idol: 'the Golden Idol', crown: 'the Crown' }
/** each thing's colour on the page (as the machine's models have them) */
export const TONE: Record<ItemKind, string> = { silver: '#cfdcf5', gold: '#ffd24a', gem: '#ff4fb8', bar: '#ffc94a', idol: '#ffb030', crown: '#ffe39a' }
export const FEATURE_NAME: Record<Exclude<Feature, 'none'>, string> = { shower: 'Coin Shower', quake: 'Quake' }

export const isPrize = (k: ItemKind) => PRIZE_KINDS.includes(k)

/** 0.25×, 1×, 612.5×, 1,000× */
export function multText(m: number): string {
  if (m >= 1000) return `${fmt(m, 0)}×`
  return `${Number(m.toFixed(2))}×`
}

/** the best thing in a result (the one it is named after), or null for nothing */
export function bestOf(wins: Record<ItemKind, number>): ItemKind | null {
  for (let i = ITEM_KINDS.length - 1; i >= 0; i--) if (wins[ITEM_KINDS[i]] > 0) return ITEM_KINDS[i]
  return null
}

/**
 * How big a moment a result is: 0 a few silver coins (less than the stake back), 1 a win of the stake or more, 2 a
 * gem, a Coin Shower or a Quake, 3 a gold bar, 4 the Golden Idol or the Crown (the full celebration).
 */
export function tierOf(r: Pick<DropResult, 'wins' | 'mult' | 'feature'>): 0 | 1 | 2 | 3 | 4 {
  if (r.wins.crown || r.wins.idol) return 4
  if (r.wins.bar) return 3
  if (r.wins.gem || (r.feature !== 'none' && r.mult > 0)) return 2
  return r.mult >= 1 ? 1 : 0
}

/** what the drop's banner calls it */
export function headline(r: Pick<DropResult, 'wins' | 'mult' | 'feature'>): string {
  const w = r.wins
  if (w.crown && w.idol) return 'CROWN AND IDOL!'
  if (w.crown) return 'THE CROWN!'
  if (w.idol) return 'GOLDEN IDOL!'
  if (w.bar) return 'GOLD BAR!'
  if (w.gem) return w.gem > 1 ? 'TWO GEMS!' : 'GEM!'
  if (r.feature === 'shower') return 'COIN SHOWER!'
  if (r.feature === 'quake') return 'QUAKE!'
  if (w.gold >= 3) return 'GOLD RUSH!'
  if (w.gold === 2) return 'DOUBLE GOLD!'
  if (w.gold === 1) return 'GOLD COIN!'
  return r.mult >= 1 ? 'NICE PUSH!' : 'A FEW COINS'
}

/** what fell, in words: "2 silver coins, a gold coin and a gem" */
export function fellText(wins: Record<ItemKind, number>): string {
  const parts: string[] = []
  for (let i = ITEM_KINDS.length - 1; i >= 0; i--) {
    const k = ITEM_KINDS[i]
    const n = wins[k]
    if (!n) continue
    parts.push(n === 1 ? ONE[k] : `${n} ${PLURAL[k]}`)
  }
  if (!parts.length) return 'nothing'
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
