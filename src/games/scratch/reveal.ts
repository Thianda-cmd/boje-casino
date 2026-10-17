import { CELLS, isHot, type CardDef } from './rules'

/*
  The order the coin works through a card in Reveal all and autoplay. Presentation only: the card's prize was drawn when
  it was bought and nothing here can change it.

  By default the coin goes along the rows like a reader (left to right, then back along the middle row). Once two of a
  top-three prize are showing and their third is still under the foil, the coin keeps one cell back for last and
  scratches it slowly: the cell that holds the third, if there is one, or else the last cell it would have reached.
*/

/** reading order, back and forth along the rows */
export const SERPENTINE = [0, 1, 2, 5, 4, 3, 6, 7, 8]

/** the top-three prizes showing twice whose third is not out yet (a win already out ends the tease) */
export function hotPairs(c: CardDef, board: number[], out: boolean[]): number[] {
  const n = new Map<number, number>()
  for (let i = 0; i < CELLS; i++) if (out[i]) n.set(board[i], (n.get(board[i]) ?? 0) + 1)
  if ([...n.values()].some((k) => k >= 3)) return []
  return [...n.entries()].filter(([s, k]) => k === 2 && isHot(c, s)).map(([s]) => s)
}

/** the next cell for the coin and whether it is the deciding one (scratched slowly), or null when the grid is out */
export function nextCell(c: CardDef, board: number[], out: boolean[]): { cell: number; deciding: boolean } | null {
  const left = SERPENTINE.filter((i) => !out[i])
  if (!left.length) return null
  const hot = hotPairs(c, board, out)
  if (!hot.length) return { cell: left[0], deciding: false }
  if (left.length === 1) return { cell: left[0], deciding: true }
  // keep the deciding cell back: the third of a hot pair if it is still covered, else the last cell in order
  const third = left.find((i) => hot.includes(board[i]))
  const last = third ?? left[left.length - 1]
  return { cell: left.find((i) => i !== last)!, deciding: false }
}
