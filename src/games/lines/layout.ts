/*
  Lucky Lines' stage is drawn in a fixed design space (CSS px at scale 1) and scaled to fit the stage, so the card,
  the reels and every flight between them share one set of numbers. The "machine" is the card with the reels under
  it, each reel straight under its card column. On a wide stage the prize ladder stands beside the machine; on a
  narrow one (phones) it is a strip above it. `fit` picks whichever arrangement shows the machine bigger.
*/

/** a card cell (and a reel) is this wide, with this gap between them and this padding inside the card */
export const CELL = 88
export const GAP = 8
export const PAD = 14
export const CARD_W = 5 * CELL + 4 * GAP + 2 * PAD
/** the band with the L-U-C-K-Y letters */
export const HEAD = 64
export const GRID_TOP = HEAD + 12
export const CARD_H = GRID_TOP + 5 * CELL + 4 * GAP + PAD

/** the reels: a plate with the spins counter, then the window the symbols turn in */
export const REELS_TOP = CARD_H + 12
export const PLATE = 36
export const WINDOW = 128
/** one symbol's slot on a reel (the window shows one whole and a part of its neighbours) */
export const SLOT = 84
export const REELS_H = PLATE + WINDOW + 12
export const MACHINE_W = CARD_W
export const MACHINE_H = REELS_TOP + REELS_H

/** the ladder beside the machine (wide) or above it (narrow) */
export const LADDER_W = 196
export const SIDE_GAP = 22
/** tall enough for each step's lines, multiple and coins at a readable size on a phone */
export const STRIP_H = 86
export const STRIP_GAP = 10

const WIDE = { w: MACHINE_W + SIDE_GAP + LADDER_W, h: MACHINE_H }
const NARROW = { w: MACHINE_W, h: STRIP_H + STRIP_GAP + MACHINE_H }

/** a column's centre, from the machine's left edge */
export const colX = (c: number) => PAD + c * (CELL + GAP) + CELL / 2
/** a card cell's centre (cell = column * 5 + row), in machine space */
export const cellXY = (cell: number) => ({ x: colX(Math.floor(cell / 5)), y: GRID_TOP + (cell % 5) * (CELL + GAP) + CELL / 2 })
/** the middle of a reel's window, in machine space */
export const reelXY = (c: number) => ({ x: colX(c), y: REELS_TOP + PLATE + WINDOW / 2 })

export interface Fit {
  mode: 'wide' | 'narrow'
  /** the scale from design px to stage px */
  k: number
  /** where the design space's top left sits on the stage (stage px) */
  ox: number
  oy: number
  /** the design space's size */
  w: number
  h: number
  /** the machine's top left in design space */
  mx: number
  my: number
}

/** fits the design onto a stage of w × h CSS px, leaving `pad` round it, never past `max` scale */
export function fit(w: number, h: number, pad: number, max = 1.25): Fit {
  const room = (d: { w: number; h: number }) => Math.min((w - pad * 2) / d.w, (h - pad * 2) / d.h, max)
  const kw = room(WIDE)
  const kn = room(NARROW)
  const mode = kw >= kn * 0.98 ? 'wide' : 'narrow'
  const d = mode === 'wide' ? WIDE : NARROW
  const k = Math.max(0.2, mode === 'wide' ? kw : kn)
  return { mode, k, w: d.w, h: d.h, ox: (w - d.w * k) / 2, oy: (h - d.h * k) / 2, mx: 0, my: mode === 'wide' ? 0 : STRIP_H + STRIP_GAP }
}
