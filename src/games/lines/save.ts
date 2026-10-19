import { rand } from '../../lib/rng'
import { safeStorage } from '../../lib/storage'
import { LINES, W_FREE, W_JOKER, W_SUPER, colOf, parseGame, type Game } from './rules'

/*
  Keeping a Lucky Lines game: the game is plain data (rules.ts), saved under the player's key after every step, with
  the cells jokers marked (only so a resumed card still wears its jester hats). Saves go through safeStorage.setItem,
  which first writes the held wallet, so storage never shows a game step ahead of the money taken for it.

  Also the dev hook: window.__linesForce lands chosen symbols on the next spin by handing the rules a generator that
  returns, for each reel in turn, a value inside that symbol's slice of the reel (the rules draw one value a reel).
*/

export const gameKey = (uid: string | null) => `lumen.lines.game.${uid ?? 'guest'}`
/** the Web Lock one tab holds while it plays for a player */
export const lockName = (uid: string | null) => `lumen.lines.${uid ?? 'guest'}`
/** what a game collected as the page closed paid, for the next visit to say */
export const NOTICE_KEY = 'lumen.lines.notice'

export interface Saved {
  game: Game
  jokered: number[]
}

export function loadGame(key: string): Saved | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  try {
    const o = JSON.parse(raw) as { game?: unknown; jokered?: unknown }
    const game = parseGame(o.game)
    if (!game) return null
    const jokered = Array.isArray(o.jokered) ? o.jokered.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < 25 && game.marks[i]) : []
    return { game, jokered }
  } catch {
    return null
  }
}

export const saveGame = (key: string, game: Game, jokered: readonly number[]) => safeStorage.setItem(key, JSON.stringify({ game, jokered }))
export const clearGame = (key: string) => safeStorage.removeItem(key)

/* ---------------- dev: window.__linesForce ---------------- */

type ForceSym = number | 'joker' | 'super' | 'free' | 'hit' | 'miss' | null
export type Force = 'joker' | 'super' | 'free' | 'line' | ForceSym[]

const pick = <T,>(xs: T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)]

/**
 * A generator that lands `force` on the next spin of `g`: 'joker', 'super' or 'free' put one of those on a reel where
 * it counts; 'line' finishes a line (one a number away if there is one, else the nearest row or diagonal, whose
 * cells sit one per column); an array names each reel (a number, 'joker', 'super', 'free', 'hit' for an unmarked
 * number on the card, 'miss' for one not on it, null for a random draw).
 */
export function forcedRng(g: Game, force: unknown): () => number {
  const withFree = g.spins > 0
  const total = 15 + W_JOKER + W_SUPER + (withFree ? W_FREE : 0)
  const want: (number | null)[] = [null, null, null, null, null]
  const num = (c: number, n: number) => n - 15 * c - 0.5
  const JOKER = 15 + W_JOKER / 2
  const SUPER = 15 + W_JOKER + W_SUPER / 2
  const FREE = 15 + W_JOKER + W_SUPER + W_FREE / 2
  const openIn = (c: number) => [0, 1, 2, 3, 4].map((r) => c * 5 + r).filter((i) => !g.marks[i])

  const one = (c: number, s: ForceSym): number | null => {
    if (typeof s === 'number') return s > 15 * c && s <= 15 * c + 15 ? num(c, s) : null
    if (s === 'joker') return JOKER
    if (s === 'super') return SUPER
    if (s === 'free') return withFree ? FREE : null
    if (s === 'hit') {
      const i = pick(openIn(c))
      return i == null ? null : num(c, g.card[i])
    }
    if (s === 'miss') {
      const off = Array.from({ length: 15 }, (_, k) => 15 * c + 1 + k).filter((n) => !g.card.includes(n))
      return num(c, pick(off)!)
    }
    return null
  }

  if (Array.isArray(force)) force.slice(0, 5).forEach((s, c) => (want[c] = one(c, s as ForceSym)))
  else if (force === 'joker' || force === 'super' || force === 'free') {
    const cols = [0, 1, 2, 3, 4].filter((c) => openIn(c).length)
    const c = pick(cols.length ? cols : [0, 1, 2, 3, 4])!
    want[c] = one(c, force)
  } else if (force === 'line') {
    const open = LINES.map((l) => l.filter((i) => !g.marks[i]))
    const near = open.find((o) => o.length === 1)
    // rows and diagonals have a cell in every column, so one spin can finish any of them
    const across = open.filter((_, k) => k < 5 || k >= 10).filter((o) => o.length > 0)
    const target = near ?? across.sort((a, b) => a.length - b.length)[0]
    for (const i of target ?? []) want[colOf(i)] = num(colOf(i), g.card[i])
  }
  const queue = want.map((x) => (x == null ? rand() : x / total))
  let k = 0
  return () => (k < queue.length ? queue[k++] : rand())
}
