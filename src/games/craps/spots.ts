import type { BetKey, Hard, Num } from './rules'

/*
  The betting board's geometry: where every spot is and where every bet's chips sit, in the board's own units, for
  the layouts the screen draws (Board.tsx paints them).

  - 'wide': the classic craps layout seen from the players' side of the table, for desktops and tablets. Across the
    top the Don't Come bar and the six number boxes; under them Come and the Field; the Don't Pass bar and the Pass
    Line run along the rail and turn up the left side, as on a real felt. To the right, the centre props in their
    own box (Any Seven, the hardways, the horn bets, Any Craps) and the Fire Bet with its six point squares.
  - 'main' and 'props': a phone's two pages of the same table, each the phone's width: the line bets, Come, the Field
    and the numbers on one, the centre props and the Fire Bet on the other.
  - Basic view (wide or main, `all` false): only the Pass Line, Don't Pass, the Field and the place numbers (odds go
    behind the line bets as ever). The Don't Come bar's corner holds the puck when it is OFF, printed POINT.

  A number box holds three bets, top to bottom as a dealer lays them out: don't come bets (a strip along its top),
  come bets that travelled there (side by side under the number, the odds a touch higher, on top), and the player's
  own place bet along its foot. Chips in a number box are drawn smaller (BOX_CHIP) so the number between them stays
  readable. Odds behind the Pass Line and Don't Pass sit just behind their bet, toward the rail.

  The props run in the felt's own order (layout.ts prints them for the 3D table): the hardways 4, 6, 8, 10, then
  Aces, Ace-Deuce, Yo and Boxcars.
*/

/** the size of chips in a number box, as a share of the layout's chip */
export const BOX_CHIP = 0.75

/** the spots on the board that take a chip directly (the rest of the bets are odds, or come bets that travelled) */
export type Spot = 'pass' | 'dontPass' | 'come' | 'dontCome' | 'field' | `place${Num}` | `hard${Hard}` | 'any7' | 'anyCraps' | 'aces' | 'aceDeuce' | 'yo' | 'boxcars' | 'fire'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Cell extends Box {
  key: Spot
  /** an outline that isn't the box (the Pass Line and the Don't Pass bar turn up the side) */
  path?: string
  /** the part along the side, for its turned print */
  side?: Box
}

export type LayoutId = 'wide' | 'main' | 'props'

export interface Layout {
  id: LayoutId
  /** with every bet (false: the Basic view) */
  all: boolean
  vw: number
  vh: number
  /** a phone's layout: smaller print and chips */
  compact: boolean
  /** the size chips are drawn at, in units */
  chip: number
  cells: Cell[]
  /** where each bet's chips sit */
  at: Partial<Record<BetKey, readonly [number, number]>>
  /** the puck: its radius, where it rests OFF (null when this page has no puck), and ON each number */
  puck: { r: number; off: readonly [number, number] | null; on: Partial<Record<Num, readonly [number, number]>> }
  /** the Fire Bet's six point squares, when this layout has the Fire Bet */
  fire: Partial<Record<Num, Box>> | null
  /** the box round the centre props (wide), and the Basic view's point corner */
  propsBox: Box | null
  pointBox: Box | null
  /** where the dealer sweeps lost chips to and pays winnings from */
  house: readonly [number, number]
}

const NUMS: readonly Num[] = [4, 5, 6, 8, 9, 10]

/** a closed outline through `pts` with its corners rounded by up to r */
function roundedPoly(pts: readonly (readonly [number, number])[], r: number) {
  const n = pts.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n]
    const [x, y] = pts[i]
    const [nx, ny] = pts[(i + 1) % n]
    const l1 = Math.hypot(px - x, py - y)
    const l2 = Math.hypot(nx - x, ny - y)
    const r1 = Math.min(r, l1 / 2)
    const r2 = Math.min(r, l2 / 2)
    const a = [x + ((px - x) / l1) * r1, y + ((py - y) / l1) * r1]
    const b = [x + ((nx - x) / l2) * r2, y + ((ny - y) / l2) * r2]
    d += `${i ? 'L' : 'M'}${a[0].toFixed(2)} ${a[1].toFixed(2)} Q${x} ${y} ${b[0].toFixed(2)} ${b[1].toFixed(2)} `
  }
  return d + 'Z'
}

/** the props column: Any Seven, the hardways and horn bets in pairs, Any Craps, the Fire Bet (down to `bottom`) */
function propsColumn(x0: number, y0: number, w: number, rows: { a7: number; pair: number; any: number }, bottom: number, G: number, cells: Cell[], at: Layout['at'], compact: boolean) {
  let y = y0
  const cw = (w - G) / 2
  cells.push({ key: 'any7', x: x0, y, w, h: rows.a7 })
  at.any7 = [x0 + w * 0.8, y + rows.a7 / 2]
  y += rows.a7 + G
  const pairs: [Spot, Spot][] = [
    ['hard4', 'hard6'],
    ['hard8', 'hard10'],
    ['aces', 'aceDeuce'],
    ['yo', 'boxcars'],
  ]
  for (const [a, b] of pairs) {
    cells.push({ key: a, x: x0, y, w: cw, h: rows.pair }, { key: b, x: x0 + cw + G, y, w: cw, h: rows.pair })
    at[a] = [x0 + cw * 0.78, y + rows.pair * 0.56]
    at[b] = [x0 + cw + G + cw * 0.78, y + rows.pair * 0.56]
    y += rows.pair + G
  }
  cells.push({ key: 'anyCraps', x: x0, y, w, h: rows.any })
  at.anyCraps = [x0 + w * 0.8, y + rows.any / 2]
  const propsBottom = y + rows.any
  y += rows.any + G * (compact ? 1 : 2.5)
  const fy = y
  const fh = bottom - fy
  cells.push({ key: 'fire', x: x0, y: fy, w, h: fh })
  at.fire = [x0 + (compact ? 24 : 30), fy + fh / 2 + (compact ? 4 : 5)]
  // the six point squares, right of the bet's own corner, under its name (and on a desktop its pays)
  const fire: Partial<Record<Num, Box>> = {}
  const sx0 = x0 + (compact ? 62 : 64)
  const sx1 = x0 + w - 8
  const gap = 5
  const sw = (sx1 - sx0 - gap * 5) / 6
  const sh = Math.min(sw, fh - (compact ? 22 : 48))
  NUMS.forEach((n, i) => (fire[n] = { x: sx0 + i * (sw + gap), y: fy + fh - sh - (compact ? 6 : 8), w: sw, h: sh }))
  return { propsBottom, fire }
}

/** the classic layout, seen from the players' side: desktops and tablets */
function wide(all: boolean): Layout {
  const G = 6
  const PW = 700
  const L = 104
  const numH = 150
  const comeH = 82
  const fieldH = 98
  const dpH = 46
  const passH = 70
  const cells: Cell[] = []
  const at: Layout['at'] = {}
  const on: Layout['puck']['on'] = {}

  let y = numH + G
  const sideTop = y
  const comeY = y
  if (all) y += comeH + G
  const fieldY = y
  y += fieldH + G
  const dpY = y
  y += dpH + G
  const passY = y
  const bottom = passY + passH

  // the Don't Come bar (or, in the Basic view, the puck's corner)
  let pointBox: Box | null = null
  let off: readonly [number, number] = [52, 126]
  if (all) {
    cells.push({ key: 'dontCome', x: 0, y: 0, w: L, h: numH })
    at.dontCome = [34, 112]
    off = [76, 128]
  } else {
    pointBox = { x: 0, y: 0, w: L, h: numH }
    off = [52, 98]
  }

  // the number boxes
  const nx0 = L + G
  const nw = (PW - nx0 - 5 * G) / 6
  NUMS.forEach((n, i) => {
    const x = nx0 + i * (nw + G)
    const cx = x + nw / 2
    cells.push({ key: `place${n}`, x, y: 0, w: nw, h: numH })
    at[`place${n}`] = [cx, numH - 17]
    at[`come${n}`] = [cx - 19, 106]
    at[`comeOdds${n}`] = [cx + 18, 101]
    at[`dontCome${n}`] = [cx - 19, 18]
    at[`dontComeOdds${n}`] = [cx + 18, 16]
    on[n] = [cx + 27, 18]
  })

  if (all) {
    cells.push({ key: 'come', x: nx0, y: comeY, w: PW - nx0, h: comeH })
    at.come = [nx0 + (PW - nx0) * 0.82, comeY + comeH / 2]
  }
  cells.push({ key: 'field', x: nx0, y: fieldY, w: PW - nx0, h: fieldH })
  at.field = [nx0 + (PW - nx0) * 0.52, fieldY + fieldH - 21]

  // the Don't Pass bar and the Pass Line, along the rail and up the side
  const dpx = 48 + G
  cells.push({
    key: 'dontPass',
    x: dpx,
    y: dpY,
    w: PW - dpx,
    h: dpH,
    path: roundedPoly([[dpx, sideTop], [L, sideTop], [L, dpY], [PW, dpY], [PW, dpY + dpH], [dpx, dpY + dpH]], 8),
    side: { x: dpx, y: sideTop, w: L - dpx, h: dpY - sideTop },
  })
  at.dontPass = [PW * 0.66, dpY + dpH / 2]
  at.dontPassOdds = [PW * 0.66 + 42, dpY + dpH / 2 + 3]
  cells.push({
    key: 'pass',
    x: 0,
    y: passY,
    w: PW,
    h: passH,
    path: roundedPoly([[0, sideTop], [48, sideTop], [48, passY], [PW, passY], [PW, bottom], [0, bottom]], 10),
    side: { x: 0, y: sideTop, w: 48, h: passY - sideTop },
  })
  at.pass = [PW * 0.66, passY + passH / 2 - 2]
  at.passOdds = [PW * 0.66 + 44, passY + passH / 2 + 9]

  let fire: Layout['fire'] = null
  let propsBox: Box | null = null
  let vw = PW
  if (all) {
    // inside a gold box of their own, as on the felt; the Fire Bet under it
    const px = PW + 26
    const pw = 1000 - px - 8
    const col = propsColumn(px, 8, pw, { a7: 48, pair: 58, any: 48 }, bottom, G, cells, at, false)
    fire = col.fire
    propsBox = { x: px - 8, y: 0, w: pw + 16, h: col.propsBottom + 8 }
    vw = 1000
  }
  return { id: 'wide', all, vw, vh: bottom, compact: false, chip: 46, cells, at, puck: { r: 15, off, on }, fire, propsBox, pointBox, house: [vw / 2, -46] }
}

/** a phone's first page: the line bets, Come, the Field and the numbers, in bands the phone's width */
function main(all: boolean): Layout {
  const G = 4
  const W = 360
  const L = 50
  const numH = 104
  const comeH = 56
  const fieldH = 66
  const dpH = 40
  const passH = 58
  const cells: Cell[] = []
  const at: Layout['at'] = {}
  const on: Layout['puck']['on'] = {}

  let pointBox: Box | null = null
  let off: readonly [number, number]
  if (all) {
    cells.push({ key: 'dontCome', x: 0, y: 0, w: L, h: numH })
    at.dontCome = [25, 62]
    off = [25, 89]
  } else {
    pointBox = { x: 0, y: 0, w: L, h: numH }
    off = [25, 66]
  }
  const nx0 = L + G
  const nw = (W - nx0 - 5 * G) / 6
  NUMS.forEach((n, i) => {
    const x = nx0 + i * (nw + G)
    const cx = x + nw / 2
    cells.push({ key: `place${n}`, x, y: 0, w: nw, h: numH })
    at[`place${n}`] = [cx, numH - 13]
    at[`come${n}`] = [cx - 11, 69]
    at[`comeOdds${n}`] = [cx + 11, 65]
    at[`dontCome${n}`] = [cx - 11, 12.5]
    at[`dontComeOdds${n}`] = [cx + 11, 11.5]
    on[n] = [cx + 12.5, 12.5]
  })
  let y = numH + G
  if (all) {
    cells.push({ key: 'come', x: 0, y, w: W, h: comeH })
    at.come = [W * 0.82, y + comeH / 2]
    y += comeH + G
  }
  cells.push({ key: 'field', x: 0, y, w: W, h: fieldH })
  at.field = [W * 0.58, y + fieldH - 17]
  y += fieldH + G
  cells.push({ key: 'dontPass', x: 0, y, w: W, h: dpH })
  at.dontPass = [W * 0.79, y + dpH / 2]
  at.dontPassOdds = [W * 0.79 + 30, y + dpH / 2 + 3]
  y += dpH + G
  cells.push({ key: 'pass', x: 0, y, w: W, h: passH })
  at.pass = [W * 0.79, y + passH / 2 - 2]
  at.passOdds = [W * 0.79 + 31, y + passH / 2 + 8]
  y += passH
  return { id: 'main', all, vw: W, vh: y, compact: true, chip: 28, cells, at, puck: { r: 10.5, off, on }, fire: null, propsBox: null, pointBox, house: [W / 2, -40] }
}

/** a phone's second page: the centre props and the Fire Bet */
function props(): Layout {
  const cells: Cell[] = []
  const at: Layout['at'] = {}
  // (Any Seven and Any Craps tall enough for a comfortable tap when the page is fitted into a short box)
  const vh = 46 + 4 + 4 * (48 + 4) + 46 + 4 + 58
  const col = propsColumn(0, 0, 360, { a7: 46, pair: 48, any: 46 }, vh, 4, cells, at, true)
  return { id: 'props', all: true, vw: 360, vh, compact: true, chip: 28, cells, at, puck: { r: 10.5, off: null, on: {} }, fire: col.fire, propsBox: null, pointBox: null, house: [180, -40] }
}

const cache = new Map<string, Layout>()
/** the layout `id` (with every bet, or the Basic view's), made once */
export function layoutOf(id: LayoutId, all: boolean): Layout {
  const k = `${id}${all ? '' : '-basic'}`
  let l = cache.get(k)
  if (!l) {
    l = id === 'wide' ? wide(all) : id === 'main' ? main(all) : props()
    cache.set(k, l)
  }
  return l
}

/** the spot a bet's chips sit in (come bets on a number sit in its box; odds in the spot of the bet they back) */
export function spotOfBet(key: BetKey): Spot {
  if (key === 'passOdds') return 'pass'
  if (key === 'dontPassOdds') return 'dontPass'
  const n = key.replace(/\D/g, '')
  if (/^(come|dontCome)(Odds)?\d/.test(key)) return `place${n}` as Spot
  return key as Spot
}

/** the odds bets, each with the bet it rests on (behind a line bet; on a come bet that travelled to a number) */
export const ODDS_OF: Partial<Record<BetKey, BetKey>> = { passOdds: 'pass', dontPassOdds: 'dontPass' }
for (const n of NUMS) {
  ODDS_OF[`comeOdds${n}`] = `come${n}`
  ODDS_OF[`dontComeOdds${n}`] = `dontCome${n}`
}
/** the bet an odds bet rests on (undefined for any other bet) */
export const backs = (key: BetKey) => ODDS_OF[key]

/** a chip pile on the board: a bet's stake, or the winnings paid beside it; `from`: the bet it travelled from */
export interface Pile {
  id: string
  key: BetKey
  amount: number
  win?: boolean
  from?: BetKey
}

/** where a pile goes as it leaves the board: to the house (lost), back to the player, or on to another spot */
export type Exit = 'house' | 'player' | 'moved'
