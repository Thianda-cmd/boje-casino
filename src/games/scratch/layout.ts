import type { CardId } from './rules'

/*
  Card geometry in design units. Every card is drawn at 360 × 560 and scaled to fit the stage with a CSS transform, so
  the printed art (SVG), the symbols under the foil (DOM) and the foil itself (canvas, sized to the real pixels) all
  share these numbers.
*/

export const CARD_W = 360
export const CARD_H = 560
export const CARD_R = 22

/** the 3 × 3 play area */
export const GRID_X = 25
export const GRID_Y = 156
export const CELL = 98
export const GAP = 8
export const GRID_SIZE = CELL * 3 + GAP * 2

/** the foil panel over the play area */
export const PANEL = { x: GRID_X - 8, y: GRID_Y - 8, w: GRID_SIZE + 16, h: GRID_SIZE + 16, r: 16 }

/** Fruit Frenzy's bonus spot, in the header */
export const BONUS = { cx: 296, cy: 80, r: 34 }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function cellRect(i: number): Rect {
  const c = i % 3
  const r = Math.floor(i / 3)
  return { x: GRID_X + c * (CELL + GAP), y: GRID_Y + r * (CELL + GAP), w: CELL, h: CELL }
}

export const cellCenter = (i: number) => {
  const r = cellRect(i)
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export const hasBonus = (id: CardId) => id === 'fruit'

/** the prize table under the play area */
export const TABLE_Y = GRID_Y + GRID_SIZE + 14
