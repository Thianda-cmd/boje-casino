import { safeStorage } from '../../lib/storage'
import { cleanStakes } from './ledger'
import type { Stakes } from './types'

/*
  What Kaiju Clash keeps on this device besides its stake ledger (ledger.ts) and the stand-in's rounds (net.ts): the
  stakes of the last round the player bet on, which Rebet puts back, and the chip they had picked.
*/

const LAST = 'lumen.kaiju.last'
const CHIP = 'lumen.kaiju.chip'

export function loadLast(): Stakes | null {
  try {
    const s = cleanStakes(JSON.parse(safeStorage.getItem(LAST) ?? 'null'))
    return Object.keys(s).length ? s : null
  } catch {
    return null
  }
}
export const saveLast = (s: Stakes) => safeStorage.setItem(LAST, JSON.stringify(cleanStakes(s)))

/** the chip value picked last time, if it is still one of `values` */
export const loadChip = (values: readonly number[], fallback: number) => {
  const v = Number(safeStorage.getItem(CHIP))
  return values.includes(v) ? v : fallback
}
export const saveChip = (v: number) => safeStorage.setItem(CHIP, String(v))
