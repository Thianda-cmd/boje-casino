import { round2 } from '../../lib/format'
import { safeStorage } from '../../lib/storage'
import { isBetKey, isNum, newTable, type Bets, type Die, type Num, type Roll, type RollResult, type Table } from './rules'

/*
  What Craps keeps on this device.

  Per player (`<uid>` or `guest`): the table, as one record under `lumen.craps.table.<player>`: the bets on it (their
  coins already left the wallet), the point, the working switch and the shooter, the bets of the last come-out (for
  Rebet), and a roll in play. A roll is saved the moment it is drawn, inside the same record, as the table before it
  plus the dice; paying it writes the table after it with no roll in play, in one write. So the record never holds a
  table that already counts a roll alongside that same roll still to pay: a roll is paid exactly once, whatever
  moment the page dies at. The record is written with safeStorage.setItem, which writes the wallet's held changes
  first, so the money always lands before the table that follows from it. Also per player: the last rolls, and the
  notice of a roll paid as the page was left (that player's next visit says what it came to).

  Per device: the chip, turbo and the Basic / All view, the newcomer hints seen, and the kinds of bet a touch player
  has had explained.
*/

export const tableKey = (owner: string) => `lumen.craps.table.${owner}`
const histKey = (owner: string) => `lumen.craps.hist.${owner}`
const CHIP = 'lumen.craps.chip'
const TURBO = 'lumen.craps.turbo'
const VIEW = 'lumen.craps.view'
const COACH = 'lumen.craps.coach'
const noticeKey = (owner: string) => `lumen.craps.notice.${owner}`
const TOLD = 'lumen.craps.told'
export const MAX_HIST = 40

/** a roll drawn and not yet paid: the dice (the table it was thrown against is the record's table) */
export interface InPlay {
  dice: Roll
  t: number
}

export interface Saved {
  table: Table
  pending: InPlay | null
  rebet: Bets | null
  /** when it was written (ms): tells a guest table carried into a new account from a later guest's */
  at: number
}

const isDie = (n: unknown): n is Die => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6
export const isRoll = (d: unknown): d is Roll => Array.isArray(d) && d.length === 2 && d.every(isDie)

/** bets as stored, if they make sense: known keys, positive amounts in whole cents */
export function parseBets(raw: unknown): Bets {
  const out: Bets = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isBetKey(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = round2(v)
  return out
}

export function parseTable(raw: unknown): Table {
  const t = (raw ?? {}) as Partial<Table>
  const fresh = newTable()
  const points = Array.isArray(t.shooter?.points) ? [...new Set(t.shooter.points.filter((p): p is Num => isNum(p as number)))] : []
  const rolls = Number(t.shooter?.rolls)
  return {
    point: isNum(t.point as number) ? (t.point as Num) : null,
    bets: parseBets(t.bets),
    working: typeof t.working === 'boolean' ? t.working : fresh.working,
    shooter: { points, rolls: Number.isInteger(rolls) && rolls >= 0 ? rolls : 0 },
  }
}

/** the player's saved record, or null if none (a damaged one reads as an empty table) */
export function loadSaved(key: string): Saved | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  try {
    const o = JSON.parse(raw) as Partial<Saved> & { pending?: Partial<InPlay> | null }
    const p = o.pending
    const rebet = parseBets(o.rebet)
    return {
      table: parseTable(o.table),
      pending: p && isRoll(p.dice) ? { dice: [p.dice[0], p.dice[1]], t: Number(p.t) || Date.now() } : null,
      rebet: Object.keys(rebet).length ? rebet : null,
      at: Number(o.at) || 0,
    }
  } catch {
    return { table: newTable(), pending: null, rebet: null, at: 0 }
  }
}

export const writeSaved = (key: string, s: Omit<Saved, 'at'>) => safeStorage.setItem(key, JSON.stringify({ ...s, at: Date.now() }))
export const dropSaved = (key: string) => safeStorage.removeItem(key)

/* ---------------- the rolls gone by ---------------- */

/** a roll gone by: when, the dice, what it did to the hand and the point it was rolled against */
export interface PastRoll {
  t: number
  dice: Roll
  event: RollResult['event']
  point: Num | null
}
const EVENTS: readonly RollResult['event'][] = ['natural', 'craps', 'point-set', 'point-made', 'seven-out', 'roll']

export function loadHistory(owner: string): PastRoll[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(histKey(owner)) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r): r is PastRoll => !!r && Number.isFinite(r.t) && isRoll(r.dice) && EVENTS.includes(r.event) && (r.point === null || isNum(r.point)))
      .slice(-MAX_HIST)
  } catch {
    return []
  }
}
export const saveHistory = (owner: string, h: readonly PastRoll[]) => safeStorage.setItem(histKey(owner), JSON.stringify(h.slice(-MAX_HIST)))

/* ---------------- the player's choices ---------------- */

export const loadChip = (values: readonly number[], fallback: number) => {
  const v = Number(safeStorage.getItem(CHIP))
  return values.includes(v) ? v : fallback
}
export const saveChip = (v: number) => safeStorage.setItem(CHIP, String(v))
export const loadTurbo = () => safeStorage.getItem(TURBO) === '1'
export const saveTurbo = (on: boolean) => safeStorage.setItem(TURBO, on ? '1' : '0')
export type View = 'basic' | 'all'
export const loadView = (): View => (safeStorage.getItem(VIEW) === 'basic' ? 'basic' : 'all')
export const saveView = (v: View) => safeStorage.setItem(VIEW, v)

/** newcomer hints: how many times each has been shown, and whether they were put away for good */
export type CoachKind = 'pass' | 'odds'
export type Coach = Record<CoachKind, number> & { off: boolean }
export function loadCoach(): Coach {
  try {
    const o = JSON.parse(safeStorage.getItem(COACH) ?? '{}') as Partial<Coach>
    const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0)
    return { pass: n(o.pass), odds: n(o.odds), off: o.off === true }
  } catch {
    return { pass: 0, odds: 0, off: false }
  }
}
export const saveCoach = (c: Coach) => safeStorage.setItem(COACH, JSON.stringify(c))

/** the kinds of bet (rules.kindOf) a touch player has had explained as their first chip went on one */
export function loadTold(): Set<string> {
  try {
    const raw = JSON.parse(safeStorage.getItem(TOLD) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
export const saveTold = (s: ReadonlySet<string>) => safeStorage.setItem(TOLD, JSON.stringify([...s]))

/* ---------------- a roll paid as the page was left ---------------- */

export interface Notice {
  dice: Roll
  event: RollResult['event']
  point: Num | null
  /** what came back, and the stakes it decided */
  returned: number
  wagered: number
}
export const saveNotice = (owner: string, n: Notice) => safeStorage.setItem(noticeKey(owner), JSON.stringify(n))
export const clearNotice = (owner: string) => safeStorage.removeItem(noticeKey(owner))
export function takeNotice(owner: string): Notice | null {
  const raw = safeStorage.getItem(noticeKey(owner))
  if (raw == null) return null
  safeStorage.removeItem(noticeKey(owner))
  try {
    const n = JSON.parse(raw) as Notice
    return isRoll(n?.dice) && EVENTS.includes(n.event) && Number.isFinite(n.returned) && Number.isFinite(n.wagered) ? { ...n, point: isNum(n.point as number) ? n.point : null } : null
  } catch {
    return null
  }
}
