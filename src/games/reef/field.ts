import { FIELD } from './rules'

/*
  The play field's shape. The reef is played on a rectangle of swim plane centred on 0 with the cannon at the middle
  of its bottom edge; creatures swim across it and torpedoes bounce off its left, right and top edges. rules.ts's
  FIELD (16 × 9) is the wide one, for a wide stage. Stages are seldom that wide (a desktop stage beside the panel is
  about square, a phone's is portrait), and a 16 × 9 field fitted into them leaves the creatures small and most of
  the stage showing reef beyond the far edge. So the scene picks, for each stage, the layout that shows the field
  biggest: wide, mid or tall, all about the same area so the reef is about as busy. Nothing about money depends on
  it (blast radius, chain range and hit shapes are all in reef units).
*/

export type LayoutId = 'wide' | 'mid' | 'tall'

export interface Layout {
  id: LayoutId
  /** width and height in reef units */
  w: number
  h: number
}

export const LAYOUTS: Record<LayoutId, Layout> = {
  wide: { id: 'wide', w: FIELD.w, h: FIELD.h },
  mid: { id: 'mid', w: 13, h: 10 },
  tall: { id: 'tall', w: 9, h: 12 },
}

export const LAYOUT_IDS: readonly LayoutId[] = ['wide', 'mid', 'tall']

/** how many creatures the scene keeps on a field: about one per five square units */
export const crowdFor = (l: Layout) => Math.round(l.w * l.h * 0.21)
