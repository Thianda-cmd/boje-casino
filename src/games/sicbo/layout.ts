import { FACES, SPOTS, type BetKey } from './rules'

/*
  Where every spot sits on the table, in layout units (the board is drawn as one SVG scaled to fit, so these are the
  only numbers that decide its shape). Two layouts:

  - wide: the classic Sic Bo table. A top band with Small and Big at the ends, Odd and Even beside them, the doubles
    in threes, and the six triples flanking Any triple in the middle; then the fourteen totals, the fifteen two-dice
    combinations and the six single numbers, each a full-width row.
  - compact (phones): the same groups stacked in short rows (totals in two rows of seven, combinations in three of
    five) so every spot stays a comfortable tap (38 units tall: 35 px or more on a 360 px phone).

  Each cell also says where its chips sit (`ax`, `ay`): the middle of the cell, except where the middle is the art.
  (Board.tsx prints each cell's content to fit these boxes, so a size changed here wants a look there too.)
*/

export interface Cell {
  key: BetKey
  x: number
  y: number
  w: number
  h: number
  /** where its chip stack sits */
  ax: number
  ay: number
}

export interface TableLayout {
  id: 'wide' | 'compact'
  vw: number
  vh: number
  cells: Cell[]
  byKey: ReadonlyMap<BetKey, Cell>
}

const cell = (key: BetKey, x: number, y: number, w: number, h: number, ax = x + w / 2, ay = y + h / 2): Cell => ({ key, x, y, w, h, ax, ay })

/** n cells of equal width across [x0, x0 + span] with gaps of `gap` */
const row = (keys: readonly BetKey[], x0: number, span: number, y: number, h: number, gap: number) => {
  const w = (span - gap * (keys.length - 1)) / keys.length
  return keys.map((k, i) => cell(k, x0 + i * (w + gap), y, w, h))
}

const TOTALS = Array.from({ length: 14 }, (_, i) => `total${i + 4}` as BetKey)
const COMBOS = SPOTS.filter((s) => s.kind === 'combo').map((s) => s.key)
const SINGLES = FACES.map((n) => `single${n}` as BetKey)
const DOUBLES = FACES.map((n) => `double${n}` as BetKey)
const TRIPLES = FACES.map((n) => `triple${n}` as BetKey)

const finish = (id: TableLayout['id'], vw: number, vh: number, cells: Cell[]): TableLayout => ({ id, vw, vh, cells, byKey: new Map(cells.map((c) => [c.key, c])) })

function wide(): TableLayout {
  const P = 10
  const G = 6
  const span = 1000 - P * 2
  const cells: Cell[] = []
  // the top band, left to right: Small, Odd, doubles 1-3, the triples block, doubles 4-6, Even, Big
  const bandY = P
  const bandH = 150
  let x = P
  const put = (key: BetKey, w: number, ax?: number, ay?: number) => {
    cells.push(cell(key, x, bandY, w, bandH, ax, ay))
    x += w + G
  }
  put('small', 110, undefined, bandY + bandH * 0.6)
  put('odd', 72, undefined, bandY + bandH * 0.62)
  for (const k of DOUBLES.slice(0, 3)) put(k, 54)
  // the triples block: specific triples in two columns of three, Any triple between them
  const tw = 60
  const th = (bandH - G * 2) / 3
  TRIPLES.slice(0, 3).forEach((k, i) => cells.push(cell(k, x, bandY + i * (th + G), tw, th)))
  cells.push(cell('anyTriple', x + tw + G, bandY, 100, bandH, undefined, bandY + bandH * 0.56))
  TRIPLES.slice(3).forEach((k, i) => cells.push(cell(k, x + tw + G + 100 + G, bandY + i * (th + G), tw, th)))
  x += tw * 2 + 100 + G * 3
  for (const k of DOUBLES.slice(3)) put(k, 54)
  put('even', 72, undefined, bandY + bandH * 0.62)
  put('big', 110, undefined, bandY + bandH * 0.6)

  const totY = bandY + bandH + G
  cells.push(...row(TOTALS, P, span, totY, 66, G))
  const comY = totY + 66 + G
  cells.push(...row(COMBOS, P, span, comY, 90, G))
  const sinY = comY + 90 + G
  // the singles are wide: the die on the left, the chips over the odds on the right
  cells.push(...row(SINGLES, P, span, sinY, 66, G).map((c) => ({ ...c, ax: c.x + c.w * 0.66 })))
  return finish('wide', 1000, sinY + 66 + P, cells)
}

function compact(): TableLayout {
  const P = 6
  const G = 4
  /** the extra breath between groups */
  const GG = 7
  const span = 360 - P * 2
  const cells: Cell[] = []
  let y = P
  cells.push(...row(['small', 'odd', 'even', 'big'], P, span, y, 42, G))
  y += 42 + GG
  cells.push(...row(TOTALS.slice(0, 7), P, span, y, 38, G))
  y += 38 + G
  cells.push(...row(TOTALS.slice(7), P, span, y, 38, G))
  y += 38 + GG
  cells.push(...row(DOUBLES, P, span, y, 42, G))
  y += 42 + G
  // triples 1-3, Any triple, triples 4-6
  const any = 70
  const tw = (span - any - G * 6) / 6
  let x = P
  for (const k of [...TRIPLES.slice(0, 3), 'anyTriple' as BetKey, ...TRIPLES.slice(3)]) {
    const w = k === 'anyTriple' ? any : tw
    cells.push(cell(k, x, y, w, 42))
    x += w + G
  }
  y += 42 + GG
  for (let r = 0; r < 3; r++) {
    cells.push(...row(COMBOS.slice(r * 5, r * 5 + 5), P, span, y, 38, G))
    y += 38 + G
  }
  y += GG - G
  cells.push(...row(SINGLES, P, span, y, 44, G))
  y += 44 + P
  return finish('compact', 360, y, cells)
}

export const WIDE = wide()
export const COMPACT = compact()
