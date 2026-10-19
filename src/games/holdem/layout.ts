import type { BetKey } from './rules'

/*
  Where everything sits on a stage of W × H, top to bottom: the dealer's two cards (the shoe in the top-right corner),
  the felt's printed line, the five board cards, the player's two cards (the biggest: they are the player's), the four
  betting circles, and below the lg breakpoint (where the side panel drops under the stage) a bar with the chips and
  Deal or the decisions, with the advice line just above it. Beside the dealer's cards hangs the dealer's hand tag;
  beside the player's, the player's tag on one side and the hand's verdict on the other; a phone has no room beside
  them, so each hand's line runs across the gap next to its cards instead. On a wide stage the felt prints the Blind
  and Trips paytables either side of the circles.

  The card sizes come from the height left once the fixed rows are placed, capped by the width the board needs; any
  height to spare goes into the gaps, so the table breathes instead of growing cards past a comfortable size. A short
  wide stage (under SHORT tall) drops the printed line and the paytables and closes the gaps, so the three rows of
  cards still clear each other and the circles.

  The boxes are worked out once per size, with the offsets a card flies in from (the shoe) and out to, so the cards
  get the same objects on every render and only re-render when something about them changes.
*/

export const CARD_RATIO = 1.4

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** an offset from a card's place: where it flies in from (turned) or out to */
export interface Offset {
  x: number
  y: number
  rotate: number
}

/** a wide stage shorter than this has no room for the printed line between the rows */
const SHORT = 520

export interface Geo {
  phone: boolean
  bar: boolean
  W: number
  H: number
  pad: number
  barH: number
  /** card widths: the board's, the dealer's, the player's */
  cw: number
  dw: number
  pw: number
  /** card i of the deck as dealt (player 0-1, dealer 2-3, board 4-8): its box */
  slots: readonly Box[]
  /** card i's flight from the shoe, and where it goes when the table is cleared */
  fromShoe: readonly Offset[]
  out: readonly Offset[]
  /** the felt's printed line (dealer qualifies...), its centre; null where there is no room for it */
  print: { x: number; y: number } | null
  circles: { y: number; d: number; x: Record<BetKey, number>; labelY: number }
  /** the dealer's tag (right-aligned to x), the player's tag (from x) and the verdict (right-aligned to x); on a phone the
   *  two hands' lines, centred on x (the verdict joins the player's line) */
  tags: { dealer: { x: number; y: number; w: number }; player: { x: number; y: number; w: number }; verdict: { x: number; y: number; w: number } }
  /** the shoe's card size and the mouth cards leave from */
  shoe: { w: number; h: number; x: number; y: number }
  /** the advice line's foot, just above the bar (bar layouts only); it may wrap to two lines on a phone */
  advice: { bottom: number } | null
  /** where the felt prints the two paytables (wide stages with room) */
  pays: { left: Box; right: Box } | null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function geometry(W: number, H: number, bar: boolean): Geo {
  const phone = W < 560
  const short = !phone && H < SHORT
  const pad = phone ? 8 : 16
  const barH = bar ? 60 : 0
  const adviceH = bar ? (phone ? 50 : 38) : 0
  // the circles: a row along the bottom
  const d = phone ? clamp((W - pad * 2) / 5.4, 52, 66) : clamp(Math.min(W * 0.1, H * 0.11), 68, 90)
  const labelH = phone ? 17 : 22
  const bottom = H - pad - barH - adviceH
  const circY = bottom - labelH - d / 2 - (phone ? 2 : 6)
  const top = pad
  // (room under the player's cards for the rail line printed over the circles)
  const avail = circY - d / 2 - (phone ? 16 : short ? 14 : 28) - top

  // the cards: the dealer's a little smaller than the board's, the player's a little bigger
  const kD = phone ? 0.9 : 0.84
  const kP = phone ? 1.34 : 1.1
  const gapK = phone ? 0 : 0.1
  const boardGap = phone ? 5 : 0
  // on a phone the gaps hold the hand lines (the dealer's under its cards, the player's over theirs) and the print
  const minA = phone ? 62 : short ? 10 : 34
  const minB = phone ? 36 : short ? 12 : 22
  const fromH = (avail - minA - minB) / (CARD_RATIO * (kD + 1 + kP))
  const fromW = (W - pad * 2 - (phone ? 0 : 120) - 4 * boardGap) / (5 + 4 * gapK)
  const cw = Math.floor(clamp(Math.min(fromH, fromW), 36, phone ? 84 : 116))
  const gap = phone ? boardGap : Math.round(cw * gapK)
  const dw = Math.round(cw * kD)
  // the player's cards keep to the room beside them for the tags (on a wide stage)
  const pw = Math.round(Math.min(cw * kP, (W - pad * 2) * (phone ? 0.3 : 0.2)))
  const ch = cw * CARD_RATIO
  const dh = dw * CARD_RATIO
  const ph = pw * CARD_RATIO

  // what is left over opens the gaps (a little above the dealer, most between the rows)
  const spare = Math.max(0, avail - (dh + ch + ph + minA + minB))
  const dealerTop = top + spare * 0.16
  const boardTop = dealerTop + dh + minA + spare * 0.34
  const playerTop = boardTop + ch + minB + spare * 0.3
  const cx = W / 2

  const pairStep = (w: number) => w * 1.08
  const pairLeft = (w: number) => cx - (w + pairStep(w)) / 2
  const boardW = 5 * cw + 4 * gap
  const boardLeft = cx - boardW / 2
  const slots = Array.from({ length: 9 }, (_, i): Box => {
    if (i < 2) return { x: pairLeft(pw) + i * pairStep(pw), y: playerTop, w: pw, h: ph }
    if (i < 4) return { x: pairLeft(dw) + (i - 2) * pairStep(dw), y: dealerTop, w: dw, h: dh }
    return { x: boardLeft + (i - 4) * (cw + gap), y: boardTop, w: cw, h: ch }
  })

  // the circles: Trips, Ante, Blind, Play; evenly across a phone, a fixed spacing on a wide stage
  const keys: BetKey[] = ['trips', 'ante', 'blind', 'play']
  const spacing = phone ? (W - pad * 2) / 4 : d * 1.55
  const x0 = cx - spacing * 1.5
  const x = Object.fromEntries(keys.map((k, i) => [k, x0 + i * spacing])) as Record<BetKey, number>

  const dealerL = pairLeft(dw)
  const playerL = pairLeft(pw)
  const playerR = playerL + pw + pairStep(pw)
  const sideGap = phone ? 8 : 18
  const shoeW = Math.round(dw * (phone ? 0.72 : 0.8))
  const shoeH = Math.round(shoeW * CARD_RATIO)
  const shoe = { w: shoeW, h: shoeH, x: W - shoeW * 0.45, y: shoeH * 0.4 }
  const r1 = (v: number) => Math.round(v * 10) / 10
  // dealt from the shoe's mouth, turned as it leaves; swept off up and to the left
  const fromShoe = slots.map((b) => ({ x: r1(shoe.x - (b.x + b.w / 2)), y: r1(shoe.y - (b.y + b.h / 2)), rotate: -24 }))
  const out = slots.map((b) => ({ x: r1(-b.x * 0.3 - 30), y: r1(-b.y * 0.25 - 40), rotate: -14 }))

  // the paytables need a column either side of the circles
  const rowL = x.trips - d / 2 - 22
  const rowR = x.play + d / 2 + 22
  const payW = Math.min(190, rowL - pad)
  const pays =
    !phone && !short && payW >= 128
      ? {
          left: { x: rowL - payW, y: circY - d / 2 - 6, w: payW, h: d + labelH + 6 },
          right: { x: rowR, y: circY - d / 2 - 6, w: payW, h: d + labelH + 6 },
        }
      : null

  return {
    phone,
    bar,
    W,
    H,
    pad,
    barH,
    cw,
    dw,
    pw,
    slots,
    fromShoe,
    out,
    print: short ? null : { x: cx, y: phone ? boardTop - 20 : dealerTop + dh + (boardTop - dealerTop - dh) / 2 },
    circles: { y: circY, d, x, labelY: circY + d / 2 + (phone ? 2 : 5) },
    tags: phone
      ? {
          dealer: { x: cx, y: dealerTop + dh + 20, w: W - pad * 2 },
          player: { x: cx, y: playerTop - 19, w: W - pad * 2 },
          verdict: { x: cx, y: playerTop - 19, w: W - pad * 2 },
        }
      : {
          dealer: { x: dealerL - sideGap, y: dealerTop + dh / 2, w: Math.min(240, dealerL - sideGap - pad) },
          player: { x: playerR + sideGap, y: playerTop + ph / 2, w: Math.min(250, W - pad - playerR - sideGap) },
          verdict: { x: playerL - sideGap, y: playerTop + ph / 2, w: Math.min(260, playerL - sideGap - pad) },
        },
    shoe,
    advice: bar ? { bottom: H - pad - barH + 2 } : null,
    pays,
  }
}
