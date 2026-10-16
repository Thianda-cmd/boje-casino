import { round2 } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'
import type { Tier } from '../cases/rules'
import { costOf } from './engine'
import { addStake, claim, keyOf, newKey, noteSeat, pending, refundAll, refundPart, writeLast } from './ledger'
import { srcOfServer } from './settle'
import { SEATS, type BattleServer, type BattleView, type CbError, type Mode } from './types'

/* The writes that move money: the stake leaves the wallet and is written to the ledger in the same task, before the
   request goes out; a definite refusal gives it straight back, and an unknown outcome is left for the ledger to sort
   out (settle.ts) once the server can be asked. */

export const ERROR_TEXT: Record<CbError, string> = {
  player: "Your player id wasn't accepted. Reload the page and try again.",
  invalid: "That battle can't be set up.",
  limit: "You're already in 3 open battles. Start or leave one first.",
  gone: 'That battle is gone.',
  started: 'That battle has already started.',
  full: 'That battle is full.',
  taken: 'Someone just took that seat.',
  already: "You're already in this battle.",
  'not-seated': "You're not in this battle.",
  network: "Couldn't reach the server. Your stake is safe and will be sorted out as soon as it answers.",
}

const toast = (title: string) => useWallet.getState().pushToast({ kind: 'info', title })

export const mySeat = (b: BattleView) => b.seats.findIndex((s) => s?.me) + 1

type Stake = (amount: number) => boolean

/** Takes a seat (or the first free one). Resolves with the battle as the server left it, or null. */
export async function joinBattle(server: BattleServer, who: string, b: BattleView, seat: number | null, name: string, stake: Stake): Promise<BattleView | null> {
  const key = keyOf(srcOfServer(server), b.id)
  // already paid into this one (a join whose answer was lost, or another tab): don't pay twice
  if (pending(who, key)) {
    toast(mySeat(b) ? ERROR_TEXT.already : "Your last try to join this battle is still being checked. If it didn't land, your stake comes back.")
    return null
  }
  if (!stake(b.cost)) return null
  // the seat asked for isn't ours until the server says so (someone may take it first): it's noted once confirmed
  addStake(who, key, { battle: b.id, seat: null, src: srcOfServer(server), mode: b.mode, players: SEATS[b.mode], cases: b.cases.length, crazy: b.crazy }, b.cost)
  const r = await server.join(b.id, seat, name)
  if (r.ok) {
    const s = mySeat(r.battle)
    if (s) noteSeat(who, key, s)
    sfx.battles.join()
    return r.battle
  }
  if (r.error !== 'network') await refundPart(who, key, b.cost)
  toast(r.error === 'started' ? 'Too late: that battle has started or been called off. Your stake is back.' : r.error === 'network' ? ERROR_TEXT.network : `${ERROR_TEXT[r.error]} Your stake is back.`)
  return null
}

export interface Setup {
  mode: Mode
  crazy: boolean
  unit: number
  cases: Tier[]
}

/** Opens a battle (and, with `bots`, fills it with the house bots straight away). Resolves with it, or null. */
export async function createBattle(server: BattleServer, who: string, a: Setup, name: string, bots: boolean, stake: Stake): Promise<BattleView | null> {
  const unit = round2(a.unit)
  const cost = costOf(unit, a.cases)
  if (!stake(cost)) return null
  const src = srcOfServer(server)
  const tmp = newKey(src)
  addStake(who, tmp, { battle: 0, seat: 1, src, mode: a.mode, players: SEATS[a.mode], cases: a.cases.length, crazy: a.crazy }, cost)
  writeLast({ mode: a.mode, crazy: a.crazy, unit, cases: a.cases })
  const r = await server.create({ mode: a.mode, crazy: a.crazy, unit, cases: a.cases, name })
  if (!r.ok) {
    if (r.error !== 'network') await refundAll(who, tmp)
    toast(r.error === 'network' ? "Couldn't reach the server. If the battle was made it shows up under Your battles; otherwise your stake comes back." : `${ERROR_TEXT[r.error]} Your stake is back.`)
    return null
  }
  await claim(who, tmp, r.battle.id, mySeat(r.battle) || 1)
  if (!bots) return r.battle
  const f = await server.bots(r.battle.id)
  if (f.ok) {
    sfx.battles.bots()
    return f.battle
  }
  return r.battle
}

/** Calls the house bots into every empty seat. */
export async function callBots(server: BattleServer, id: number): Promise<BattleView | null> {
  const r = await server.bots(id)
  if (r.ok) {
    sfx.battles.bots()
    return r.battle
  }
  toast(ERROR_TEXT[r.error])
  return null
}

/** Leaves before the battle fills (the creator leaving calls it off). Resolves true once the seat is given up. */
export async function leaveBattle(server: BattleServer, who: string, id: number): Promise<boolean> {
  const r = await server.leave(id)
  if (!r.ok) {
    toast(ERROR_TEXT[r.error])
    return false
  }
  await refundAll(who, keyOf(srcOfServer(server), id))
  sfx.battles.leave()
  toast(r.cancelled ? 'Battle called off. Your stake is back.' : 'You left the battle. Your stake is back.')
  return true
}

/** The link to a battle, for sharing. */
export function battleLink(id: number) {
  try {
    return `${location.origin}${location.pathname}${location.search}#/game/battles/${id}`
  } catch {
    return `#/game/battles/${id}`
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
