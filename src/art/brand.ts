/* The Boje mark as raw paths in a 32 × 32 box: a cut hexagonal gem with a B. Shared by the loaders, the card back and the slot art. */

export const BOJE_HEX = 'M16 2.6 27.6 9.3v13.4L16 29.4 4.4 22.7V9.3Z'
export const BOJE_B =
  'M10 8.5h6.4c3.1 0 5 1.55 5 4 0 1.5-.8 2.6-2.1 3.1 1.75.5 2.75 1.85 2.75 3.65 0 2.7-2.1 4.25-5.4 4.25H10Zm3.4 2.7v3.4H16c1.2 0 1.9-.62 1.9-1.7s-.7-1.7-1.9-1.7Zm0 6.1v3.6h2.9c1.35 0 2.15-.68 2.15-1.8s-.8-1.8-2.15-1.8Z'
/** the light top facet and the shaded left facet, drawn inside the hexagon */
export const BOJE_FACET_TOP = 'M16 1 30 9.3 16 16 2 9.3Z'
export const BOJE_FACET_LEFT = 'M2 9.3 16 16v15L2 22.7Z'

const GEM: [number, number][] = [
  [16, 2.6],
  [27.6, 9.3],
  [27.6, 22.7],
  [16, 29.4],
  [4.4, 22.7],
  [4.4, 9.3],
]

/** The hexagon cut into six facets that meet in the middle, clockwise from the top right. `inset` pulls each facet
 *  towards its own centre, which opens a hairline gap between neighbours. */
export function bojeFacets(inset = 0.07): string[] {
  return GEM.map((a, i) => {
    const b = GEM[(i + 1) % GEM.length]
    const gx = (16 + a[0] + b[0]) / 3
    const gy = (16 + a[1] + b[1]) / 3
    const pt = ([x, y]: [number, number]) => `${(gx + (x - gx) * (1 - inset)).toFixed(2)} ${(gy + (y - gy) * (1 - inset)).toFixed(2)}`
    return `M${pt([16, 16])}L${pt(a)}L${pt(b)}Z`
  })
}
