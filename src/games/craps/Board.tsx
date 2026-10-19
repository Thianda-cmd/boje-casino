import { memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Chip, chipLabel } from '../../art/Chip'
import { useUid } from '../../art/ids'
import { fmt } from '../../lib/format'
import { CREAM, FeltDie, Flame, FlameDefs, GOLD, PuckGlyph, RED } from './art'
import { BOX_CHIP, ODDS_OF, spotOfBet, type Box, type Cell, type Exit, type Layout, type Pile, type Spot } from './spots'
import { betName, maxStake, type BetKey, type Die, type Num, type Table } from './rules'
import { betTip } from './words'

/*
  The betting board: one SVG drawn from the layout's cells (spots.ts), printed in cream, gold and red on the green
  felt like the table's own print, with the chips on top as HTML so they can drop in, be swept off to the house,
  slide back to the player, or travel from Come onto a number, and over everything the puck, the odds spots and the
  tooltip.

  The board is drawn at whatever scale the stage allows, so the big print scales with it but the fine print (the
  payouts, the small labels) never draws smaller than a readable size on screen: it is sized from the rendered scale.

  Each spot is a button: a click or tap puts the chosen chip on it, a right-click or a long press takes one off (a
  long press on a spot with nothing on it explains the spot instead), Tab reaches it and Enter (or Space, once reached
  by keyboard) places. Once a point is set, a dashed ring appears just behind each line bet and beside each come bet
  that travelled to a number: that is where its odds go. While betting is open, a bet that is off for the come-out
  roll wears a little OFF button, as a dealer would mark it. At the result every spot that won glows, the box of the
  number rolled lights, and the Fire Bet's square for a point made catches fire.

  The board draws what the screen hands it: `piles` (the stakes and winnings on show, each with a stable id) and
  `exits` (where a pile goes when it leaves), so a roll's whole payout is the screen changing those two over time.
*/

const SERIF = 'Georgia, "Times New Roman", serif'
const SANS = 'Manrope, ui-sans-serif, system-ui, sans-serif'
const LINE = 'rgba(241,230,200,.78)'
/** the smallest fine print on screen (CSS px): on a desktop, and on a phone's compact layout */
const FINE_PX = { wide: 10.5, compact: 9.5 }
/** how long a tooltip opened by touch stays up (ms) */
const TOUCH_TIP_MS = 2800
/** the odds spots: on a line bet, behind it; on a come bet, beside it */
const ODDS_KEYS = Object.keys(ODDS_OF) as BetKey[]
const isLay = (k: BetKey) => k.startsWith('dont')
/** a bet whose chips sit in a number box (drawn smaller there) */
const inBox = (k: BetKey) => spotOfBet(k).startsWith('place')

/* ---------------- chips ---------------- */

const CHIP_VALUES = [5000, 1000, 500, 100, 25, 10, 5, 1]
/** chip values for a stack, bottom to top, largest first, at most five */
function stackOf(amount: number): number[] {
  const out: number[] = []
  let left = Math.round(amount * 100) / 100
  for (const v of CHIP_VALUES)
    while (left >= v - 1e-9 && out.length < 5) {
      out.push(v)
      left = Math.round((left - v) * 100) / 100
    }
  if (!out.length) out.push(1)
  return out
}
const amountLabel = (v: number) => (v >= 1000 || Number.isInteger(v) ? chipLabel(v) : v.toFixed(2))

function ChipPile({ amount, size }: { amount: number; size: number }) {
  const values = stackOf(amount)
  const step = size * 0.1
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {values.map((v, i) => {
        const top = i === values.length - 1
        return (
          <motion.span
            key={i}
            className="absolute left-0 top-0"
            initial={i ? { y: -i * step - 12, opacity: 0 } : false}
            animate={{ y: -i * step, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 700, damping: 30 }}
          >
            <Chip value={top ? amount : v} size={size} label={top ? amountLabel(amount) : undefined} />
          </motion.span>
        )
      })}
    </div>
  )
}

/* ---------------- the print ---------------- */

const text = (x: number, y: number, size: number, s: string, o: { fill?: string; font?: string; weight?: number; ls?: number; italic?: boolean; anchor?: 'start' | 'middle' | 'end'; opacity?: number; rotate?: number } = {}) => (
  <text
    x={x}
    y={y}
    fontSize={size}
    fontFamily={o.font ?? SERIF}
    fontWeight={o.weight ?? 700}
    fontStyle={o.italic ? 'italic' : undefined}
    fill={o.fill ?? CREAM}
    fillOpacity={o.opacity}
    textAnchor={o.anchor ?? 'middle'}
    dominantBaseline="central"
    letterSpacing={o.ls ? size * o.ls : undefined}
    transform={o.rotate ? `rotate(${o.rotate} ${x} ${y})` : undefined}
  >
    {s}
  </text>
)

const dicePair = (a: Die, b: Die, cx: number, y: number, s: number, gap: number) => (
  <>
    <FeltDie n={a} x={cx - s - gap / 2} y={y} s={s} />
    <FeltDie n={b} x={cx + gap / 2} y={y} s={s} />
  </>
)

const PLACE_PAYS: Record<Num, string> = { 4: '9 TO 5', 5: '7 TO 5', 6: '7 TO 6', 8: '7 TO 6', 9: '7 TO 5', 10: '9 TO 5' }
const PROP_ART: Partial<Record<Spot, [Die, Die, string, string]>> = {
  hard4: [2, 2, '7 TO 1', 'HARD 4'],
  hard6: [3, 3, '9 TO 1', 'HARD 6'],
  hard8: [4, 4, '9 TO 1', 'HARD 8'],
  hard10: [5, 5, '7 TO 1', 'HARD 10'],
  aces: [1, 1, '30 TO 1', 'ACES'],
  aceDeuce: [1, 2, '15 TO 1', 'ACE-DEUCE'],
  yo: [5, 6, '15 TO 1', 'YO'],
  boxcars: [6, 6, '30 TO 1', 'BOXCARS'],
}
const FIELD_NUMS = [2, 3, 4, 9, 10, 11, 12]
/** where a number box prints its number (a share of its height): over the come bets and the place bet below it */
const NUMBER_AT = { wide: 0.41, compact: 0.38 }
/** the line under a number box's don't come strip (units from its top) */
const STRIP = { wide: 36, compact: 24 }

/**
 * What one cell prints: its words, numbers and dice, as on the felt. `fine` sizes the fine print (units) so it never
 * draws smaller than FINE_PX on screen.
 */
const CellPrint = memo(function CellPrint({ c, layout, flameId, fine }: { c: Cell; layout: Layout; flameId: string; fine: number }) {
  const cp = layout.compact
  const f = (u: number) => Math.max(u, fine)
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const k = c.key
  if (k.startsWith('place')) {
    const n = Number(k.slice(5)) as Num
    const word = n === 6 ? 'SIX' : n === 9 ? 'NINE' : String(n)
    const gold = n === 6 || n === 8
    const strip = c.y + (cp ? STRIP.compact : STRIP.wide)
    return (
      <>
        {layout.all && <line x1={c.x + 4} x2={c.x + c.w - 4} y1={strip} y2={strip} stroke={CREAM} strokeOpacity=".28" strokeDasharray="3 3" strokeWidth={cp ? 0.8 : 1} />}
        {text(cx, c.y + c.h * (cp ? NUMBER_AT.compact : NUMBER_AT.wide), word.length > 2 ? (cp ? 13.5 : 25) : cp ? 29 : 54, word, { fill: gold ? GOLD : CREAM, weight: 700 })}
        {text(cx, c.y + c.h - (cp ? 6 : 9), f(cp ? 7 : 10.5), PLACE_PAYS[n], { font: SANS, weight: 800, opacity: 0.66, ls: 0.04 })}
      </>
    )
  }
  switch (k) {
    case 'dontCome':
      return cp ? (
        <>
          {text(cx, c.y + 14, f(8.6), "DON'T", { font: SANS, weight: 800 })}
          {text(cx, c.y + 25, f(8.6), 'COME', { font: SANS, weight: 800 })}
          {dicePair(6, 6, cx, c.y + 33, 8, 2)}
        </>
      ) : (
        <>
          {text(cx, c.y + 26, 15, "DON'T", { font: SANS, weight: 800, ls: 0.04 })}
          {text(cx, c.y + 45, 15, 'COME', { font: SANS, weight: 800, ls: 0.04 })}
          {text(c.x + 30, c.y + 68, f(12.5), 'BAR', { font: SANS, weight: 800 })}
          {dicePair(6, 6, c.x + 70, c.y + 60, 15, 3)}
        </>
      )
    case 'come':
      return text(c.x + c.w * (cp ? 0.4 : 0.42), cy + 1, cp ? 32 : 50, 'COME', { fill: RED, ls: 0.2 })
    case 'field': {
      const x0 = c.x + (cp ? 98 : 150)
      const x1 = c.x + c.w - (cp ? 22 : 40)
      const ny = c.y + (cp ? 26 : 40)
      const ring = cp ? 13.5 : 20
      return (
        <>
          {text(c.x + (cp ? 42 : 66), cp ? ny : cy, cp ? 18 : 32, 'FIELD', { fill: GOLD, italic: true })}
          {FIELD_NUMS.map((n, i) => {
            const x = x0 + ((x1 - x0) * i) / (FIELD_NUMS.length - 1)
            const ringed = n === 2 || n === 12
            return (
              <g key={n}>
                {text(x, ny, cp ? 19 : 29, String(n), { fill: ringed ? GOLD : CREAM })}
                {ringed && <circle cx={x} cy={ny} r={ring} fill="none" stroke={GOLD} strokeWidth={cp ? 1.2 : 1.6} />}
                {/* (the 12's words end at its ring, so they stay inside the Field) */}
                {ringed && text(n === 12 ? x + ring : x, ny + ring + f(cp ? 6.8 : 9.5) * 0.5 + (cp ? 3 : 5), f(cp ? 6.8 : 9.5), n === 2 ? 'PAYS DOUBLE' : 'PAYS TRIPLE', { font: SANS, weight: 800, fill: GOLD, anchor: n === 12 ? 'end' : 'middle' })}
                {i < FIELD_NUMS.length - 1 && !ringed && n !== 11 && text(x + (x1 - x0) / (FIELD_NUMS.length - 1) / 2, ny, cp ? 10 : 14, '•', { opacity: 0.45 })}
              </g>
            )
          })}
        </>
      )
    }
    case 'dontPass':
      return cp ? (
        <>
          {text(c.x + 122, cy + 1, 15.5, "DON'T PASS BAR", { ls: 0.05 })}
          {dicePair(6, 6, c.x + 246, cy - 7, 13, 3)}
        </>
      ) : (
        <>
          {text(c.x + c.w * 0.36, cy + 1, 21, "DON'T PASS BAR", { ls: 0.06 })}
          {dicePair(6, 6, c.x + c.w * 0.36 + 140, cy - 9, 18, 4)}
          {c.side && text(c.side.x + c.side.w / 2, c.side.y + c.side.h / 2, 13, "DON'T PASS", { ls: 0.08, rotate: -90 })}
        </>
      )
    case 'pass':
      return cp ? (
        text(c.x + 128, cy + 1, 27, 'PASS LINE', { ls: 0.14 })
      ) : (
        <>
          {text(c.x + c.w * 0.36, cy + 1, 36, 'PASS LINE', { ls: 0.16 })}
          {c.side && text(c.side.x + c.side.w / 2, c.side.y + c.side.h / 2, 21, 'PASS LINE', { ls: 0.16, rotate: -90 })}
        </>
      )
    case 'any7':
    case 'anyCraps': {
      const name = k === 'any7' ? 'SEVEN' : 'ANY CRAPS'
      const pay = k === 'any7' ? '4 TO 1' : '7 TO 1'
      // on a phone's full-width row, the name and its pays side by side; in the desktop's column, the pays under it
      return cp ? (
        <>
          {text(c.x + c.w * 0.3, cy + 1, k === 'any7' ? 21 : 17, name, { fill: RED, ls: 0.08 })}
          {text(c.x + c.w * 0.58, cy + 1, f(10), pay, { font: SANS, weight: 800, fill: GOLD })}
        </>
      ) : (
        <>
          {text(c.x + c.w * 0.38, cy - f(11) * 0.5 + 1, k === 'any7' ? 22 : 18, name, { fill: RED, ls: 0.08 })}
          {text(c.x + c.w * 0.38, cy + 12 + Math.max(0, f(11) - 11) * 0.4, f(11), pay, { font: SANS, weight: 800, fill: GOLD })}
        </>
      )
    }
    case 'fire':
      return cp ? (
        <>
          <Flame x={c.x + 24 - 13} y={c.y + c.h / 2 + 4 - 15} s={26} lit={false} id={flameId} />
          {text(c.x + 62, c.y + 11, f(9.5), 'FIRE BET', { font: SANS, weight: 900, anchor: 'start', fill: '#ffb36b', ls: 0.12 })}
          {text(c.x + c.w - 8, c.y + 11, f(7.5), '24 · 249 · 999 TO 1', { font: SANS, weight: 800, anchor: 'end', opacity: 0.7 })}
        </>
      ) : (
        <>
          <Flame x={c.x + 30 - 19} y={c.y + c.h / 2 + 5 - 22} s={38} lit={false} id={flameId} />
          {text(c.x + 64, c.y + 14, f(11), 'FIRE BET', { font: SANS, weight: 900, anchor: 'start', fill: '#ffb36b', ls: 0.12 })}
          {text(c.x + 64, c.y + 15 + Math.max(f(11), 11) * 0.55 + f(9) * 0.6, f(9), '24-249-999 TO 1', { font: SANS, weight: 800, anchor: 'start', opacity: 0.72 })}
        </>
      )
    default: {
      const art = PROP_ART[k]
      if (!art) return null
      if (cp) {
        // on a phone the props page has room to name each bet: the dice, then its name over its pays
        const s = 15
        const tx = c.x + 8 + s * 2 + 3 + 8
        return (
          <>
            {dicePair(art[0], art[1], c.x + 8 + s + 1.5, cy - s / 2, s, 3)}
            {text(tx, cy - f(9) * 0.62, f(9), art[3], { font: SANS, weight: 900, anchor: 'start', ls: 0.04 })}
            {text(tx, cy + f(9) * 0.62, f(9), art[2], { font: SANS, weight: 800, anchor: 'start', fill: GOLD })}
          </>
        )
      }
      const dx = c.x + c.w * 0.36
      return (
        <>
          {dicePair(art[0], art[1], dx, c.y + 9, 20, 4)}
          {text(dx, c.y + c.h - Math.max(11, f(10.5) * 0.62 + 4), f(10.5), art[2], { font: SANS, weight: 800, fill: GOLD })}
        </>
      )
    }
  }
})

/** the shape of a cell, as an SVG element (its outline, or its box) */
function Shape({ c, r, ...rest }: { c: Cell; r: number } & React.SVGProps<SVGPathElement> & React.SVGProps<SVGRectElement>) {
  if (c.path) return <path d={c.path} {...(rest as React.SVGProps<SVGPathElement>)} />
  return <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} {...(rest as React.SVGProps<SVGRectElement>)} />
}

/**
 * One spot on the print: its shape, the hover and focus marks, the flash of a chip landing and its print. A refused
 * chip shakes it in place (driven, not remounted, so the keyboard keeps its focus on it).
 */
function SpotCell({ c, layout, r, fine, flameId, interactive, covered, label, shakeN, flashN, pulse, events }: {
  c: Cell
  layout: Layout
  r: number
  fine: number
  flameId: string
  interactive: boolean
  covered: boolean
  label: string
  shakeN: number
  flashN: number
  pulse: boolean
  events: ReturnType<SpotEvents>
}) {
  const cp = layout.compact
  const shake = useAnimationControls()
  useEffect(() => {
    if (shakeN) void shake.start({ x: [0, -6, 5, -3, 2, 0], transition: { duration: 0.36 } })
  }, [shakeN, shake])
  return (
    <motion.g animate={shake} className={`group outline-none ${interactive ? 'cursor-pointer' : ''}`} role="button" tabIndex={interactive ? 0 : -1} aria-label={label} {...events}>
      <Shape c={c} r={r} fill={c.key === 'fire' ? 'rgba(255,120,40,.06)' : 'rgba(0,0,0,.1)'} stroke={c.key === 'fire' ? 'rgba(255,170,90,.7)' : LINE} strokeWidth={cp ? 1.1 : 1.5} />
      <Shape c={c} r={r} fill="#fff" pointerEvents="none" className={`opacity-0 transition-opacity duration-150 ${interactive ? 'group-hover:opacity-[.07] group-focus-visible:opacity-[.09]' : ''}`} />
      {flashN > 0 && (
        <motion.g key={flashN} initial={{ opacity: 0.3 }} animate={{ opacity: 0 }} transition={{ duration: 0.4 }} pointerEvents="none">
          <Shape c={c} r={r} fill="#ffe7a0" />
        </motion.g>
      )}
      {/* a newcomer's hint points here: the spot breathes */}
      {pulse && (
        <motion.g pointerEvents="none" initial={{ opacity: 0 }} animate={{ opacity: [0.25, 0.95, 0.25] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
          <Shape c={c} r={r} fill="rgba(255,224,138,.06)" stroke="#ffe08a" strokeWidth={cp ? 2 : 2.6} />
        </motion.g>
      )}
      <g pointerEvents="none" style={{ opacity: covered && !c.key.startsWith('place') ? 0.5 : 1, transition: 'opacity .25s' }}>
        <CellPrint c={c} layout={layout} flameId={flameId} fine={fine} />
      </g>
      <Shape c={c} r={r} fill="none" stroke={GOLD} strokeWidth={cp ? 2.2 : 3} pointerEvents="none" className="opacity-0 group-focus-visible:opacity-100" />
    </motion.g>
  )
}

/* ---------------- the board ---------------- */

type SpotEvents = (key: BetKey, box: Box) => {
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onPointerDown: (e: ReactPointerEvent) => void
  onFocus: () => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerEnter: (e: ReactPointerEvent) => void
  onPointerLeave: () => void
  onKeyDown: (e: ReactKeyboardEvent) => void
}

export interface BoardProps {
  layout: Layout
  /** the board's box on the stage (px); the layout is fitted inside it, centred */
  left: number
  top: number
  width: number
  height: number
  stageH: number
  piles: readonly Pile[]
  exits: Readonly<Record<string, Exit>>
  /** the table as it stands (the odds spots, the tooltips) */
  table: Table
  /** the point the puck shows */
  puck: Num | null
  /** the Fire Bet's squares alight: the shooter's points made */
  firePoints: readonly Num[]
  /** the spots that won this roll, and the total just rolled, while the result shows */
  lit: ReadonlySet<Spot> | null
  rolled: number | null
  interactive: boolean
  /** whether bets that are off for the come-out wear their OFF button (only while betting: never over a payout) */
  marks: boolean
  /** a spot (or odds spot) a newcomer's hint points at: it breathes */
  pulse: BetKey | null
  /** a spot to explain for a moment (a touch player's first chip on a kind of bet): its tooltip opens */
  tell: { key: BetKey; n: number } | null
  onPlace: (k: BetKey) => void
  onRemove: (k: BetKey) => void
  /** whether a tooltip is open (the screen keeps its own hint out of the way meanwhile) */
  onTip?: (open: boolean) => void
  shake: { key: BetKey; n: number } | null
}

export function Board({ layout, left, top, width, height, stageH, piles, exits, table, puck, firePoints, lit, rolled, interactive, marks, pulse, tell, onPlace, onRemove, onTip, shake }: BoardProps) {
  const u = useUid()
  const k = Math.min(width / layout.vw, height / layout.vh)
  const bw = layout.vw * k
  const bh = layout.vh * k
  const ox = left + (width - bw) / 2
  const oy = top + (height - bh) / 2
  const cp = layout.compact
  const chip = Math.round(Math.max(cp ? 21 : 22, Math.min(cp ? 30 : 40, layout.chip * k)))
  const boxChip = Math.round(chip * BOX_CHIP)
  // the fine print's size in units (rounded, so the print is only redrawn when the scale really changes)
  const fine = Math.round(((cp ? FINE_PX.compact : FINE_PX.wide) / k) * 4) / 4
  const r = cp ? 6 : 9
  const [tip, setTip] = useState<{ key: BetKey; box: Box; touch?: boolean } | null>(null)
  const [flash, setFlash] = useState<{ key: BetKey; n: number } | null>(null)
  const pressTimer = useRef(0)
  const tipTimer = useRef(0)
  const longPress = useRef(false)
  const lastPointer = useRef('mouse')
  const downAt = useRef(0)
  const keyFocus = useRef(false)
  useEffect(
    () => () => {
      clearTimeout(pressTimer.current)
      clearTimeout(tipTimer.current)
    },
    [],
  )
  useEffect(() => {
    if (!interactive) setTip(null)
  }, [interactive])
  const open = !!tip
  useEffect(() => onTip?.(open), [open, onTip])

  const stakeAt = new Map<BetKey, number>()
  for (const p of piles) if (!p.win) stakeAt.set(p.key, p.amount)
  const ringR = (layout.chip / 2) * 1.08
  /** where a spot or odds ring sits, for its tooltip */
  const boxOf = (key: BetKey): Box | null => {
    const c = layout.cells.find((x) => x.key === key)
    if (c) return c
    const a = layout.at[key]
    if (!a) return null
    const rr = ringR * (inBox(key) ? BOX_CHIP : 1)
    return { x: a[0] - rr, y: a[1] - rr, w: rr * 2, h: rr * 2 }
  }
  /** a tooltip opened by touch (a long press, or the screen explaining a spot): it closes itself */
  const touchTip = (key: BetKey) => {
    const box = boxOf(key)
    if (!box) return
    setTip({ key, box, touch: true })
    clearTimeout(tipTimer.current)
    tipTimer.current = window.setTimeout(() => setTip((t) => (t?.key === key && t.touch ? null : t)), TOUCH_TIP_MS)
  }
  const tellN = tell?.n ?? 0
  useEffect(() => {
    if (tell && interactive) touchTip(tell.key)
    // (only a new request opens it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tellN])

  const press = (key: BetKey) => {
    if (longPress.current) {
      longPress.current = false
      return
    }
    if (!interactive) return
    setFlash((f) => ({ key, n: (f?.n ?? 0) + 1 }))
    onPlace(key)
  }
  const onDown = (e: ReactPointerEvent, key: BetKey) => {
    lastPointer.current = e.pointerType
    downAt.current = performance.now()
    longPress.current = false
    clearTimeout(pressTimer.current)
    if (e.pointerType !== 'touch' || !interactive) return
    // a long press takes a chip off, or, on a spot with nothing on it, explains the spot (the click that follows is
    // swallowed)
    pressTimer.current = window.setTimeout(() => {
      longPress.current = true
      if (stakeAt.has(key)) onRemove(key)
      else touchTip(key)
      navigator.vibrate?.(12)
    }, 450)
  }
  const cancelPress = () => clearTimeout(pressTimer.current)
  const onKey = (e: ReactKeyboardEvent, key: BetKey) => {
    if (e.key === 'Enter' || (e.key === ' ' && keyFocus.current)) {
      e.preventDefault()
      e.stopPropagation()
      press(key)
    }
  }
  /** the handlers every spot (a cell or an odds ring) shares */
  const spotEvents: SpotEvents = (key, box) => ({
    onClick: () => press(key),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      if (lastPointer.current !== 'touch' && interactive) onRemove(key)
    },
    onPointerDown: (e: ReactPointerEvent) => onDown(e, key),
    onFocus: () => (keyFocus.current = performance.now() - downAt.current > 500),
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerEnter: (e: ReactPointerEvent) => e.pointerType === 'mouse' && setTip({ key, box }),
    onPointerLeave: () => {
      cancelPress()
      setTip((t) => (t?.key === key && !t.touch ? null : t))
    },
    onKeyDown: (e: ReactKeyboardEvent) => onKey(e, key),
  })

  // the odds spots on offer now: behind each line bet and beside each come bet once it can take odds
  const rings = interactive ? ODDS_KEYS.filter((o) => layout.at[o] && table.bets[ODDS_OF[o]!] && maxStake(table, o) > 0) : []
  // OFF goes by the puck the player sees (it moves a moment after the dice land), and only while betting is open
  const offOnComeOut = marks && puck === null
  const isOff = (key: BetKey) => offOnComeOut && (((key.startsWith('place') || key.startsWith('hard')) && !table.working) || key.startsWith('comeOdds'))
  const winsFor = new Set(piles.filter((p) => p.win).map((p) => p.key))
  const house = { x: layout.house[0] * k, y: layout.house[1] * k }
  const tagPx = cp ? 10.5 : Math.round(Math.min(13, Math.max(11, 14 * k)))
  const puckAt = puck === null ? layout.puck.off : (layout.puck.on[puck] ?? null)

  return (
    <div className="absolute" style={{ left: ox, top: oy, width: bw, height: bh }}>
      <svg viewBox={`0 0 ${layout.vw} ${layout.vh}`} className="absolute inset-0 h-full w-full overflow-visible [-webkit-touch-callout:none]" aria-label="Craps table" onPointerLeave={() => setTip((t) => (t?.touch ? t : null))}>
        <defs>
          <FlameDefs id={`${u}fl`} />
          <radialGradient id={`${u}win`} cx=".5" cy=".5" r=".75">
            <stop offset="0" stopColor="#fff8dc" stopOpacity=".34" />
            <stop offset="1" stopColor="#ffd45c" stopOpacity=".1" />
          </radialGradient>
          <filter id={`${u}glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={cp ? 2.4 : 3.4} />
          </filter>
        </defs>

        {layout.propsBox && <rect {...layout.propsBox} rx={14} fill="rgba(0,0,0,.12)" stroke={GOLD} strokeOpacity=".7" strokeWidth={1.6} />}
        {layout.pointBox && (
          <g pointerEvents="none">
            <rect {...layout.pointBox} rx={r} fill="rgba(0,0,0,.14)" stroke={LINE} strokeOpacity=".5" strokeWidth={cp ? 1 : 1.3} strokeDasharray="4 4" />
            {text(layout.pointBox.x + layout.pointBox.w / 2, layout.pointBox.y + (cp ? 22 : 40), Math.max(cp ? 8.5 : 13, fine), 'POINT', { font: SANS, weight: 900, ls: 0.16, opacity: 0.7 })}
          </g>
        )}

        {layout.cells.map((c) => {
          const stake = stakeAt.get(c.key)
          return (
            <SpotCell
              key={c.key}
              c={c}
              layout={layout}
              r={r}
              fine={fine}
              flameId={`${u}fl`}
              interactive={interactive}
              covered={stake !== undefined}
              label={`${betName(c.key)}${stake !== undefined ? `, ${fmt(stake)} on it` : ''}`}
              shakeN={shake?.key === c.key ? shake.n : 0}
              flashN={flash?.key === c.key ? flash.n : 0}
              pulse={pulse === c.key && interactive}
              events={spotEvents(c.key, c)}
            />
          )
        })}

        {/* the number just rolled: its box lights, and its number on the Field */}
        <g pointerEvents="none">
          <AnimatePresence>
            {rolled !== null &&
              layout.cells
                .filter((c) => c.key === `place${rolled}`)
                .map((c) => (
                  <motion.rect key={`r-${rolled}`} x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill="#fff4d6" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.2, 0.1] }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} />
                ))}
          </AnimatePresence>
          <AnimatePresence>
            {rolled !== null &&
              FIELD_NUMS.includes(rolled) &&
              layout.cells
                .filter((c) => c.key === 'field')
                .map((c) => {
                  const x0 = c.x + (cp ? 98 : 150)
                  const x1 = c.x + c.w - (cp ? 22 : 40)
                  const x = x0 + ((x1 - x0) * FIELD_NUMS.indexOf(rolled)) / (FIELD_NUMS.length - 1)
                  return (
                    <motion.circle
                      key={`f-${rolled}`}
                      cx={x}
                      cy={c.y + (cp ? 26 : 40)}
                      r={cp ? 15 : 22}
                      fill="#fff4c4"
                      fillOpacity=".18"
                      stroke="#fff4c4"
                      strokeWidth={cp ? 1.6 : 2.2}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    />
                  )
                })}
          </AnimatePresence>
        </g>

        {/* the spots that won */}
        <g pointerEvents="none">
          <AnimatePresence>
            {lit &&
              layout.cells
                .filter((c) => lit.has(c.key))
                .map((c) => (
                  <motion.g key={`w-${c.key}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.45 } }} transition={{ duration: 0.3 }}>
                    <Shape c={c} r={r} fill={`url(#${u}win)`} />
                    <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.55, 0.9] }} transition={{ duration: 1.4, times: [0, 0.25, 0.6, 1] }}>
                      <Shape c={c} r={r} fill="none" stroke="#ffe9a0" strokeWidth={cp ? 4.5 : 7} filter={`url(#${u}glow)`} />
                    </motion.g>
                    <Shape c={c} r={r} fill="none" stroke="#fff4c4" strokeWidth={cp ? 1.6 : 2.2} />
                  </motion.g>
                ))}
          </AnimatePresence>
        </g>

        {/* the Fire Bet's point squares */}
        {layout.fire &&
          (Object.entries(layout.fire) as [string, Box][]).map(([n, b]) => {
            const made = firePoints.includes(Number(n) as Num)
            return (
              <g key={n} pointerEvents="none">
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={cp ? 5 : 4} fill="rgba(0,0,0,.2)" stroke={CREAM} strokeOpacity=".35" strokeWidth={cp ? 1 : 1.2} />
                <AnimatePresence>
                  {made && (
                    <motion.g key="lit" initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 16 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={cp ? 5 : 4} fill={`url(#${u}fl)`} stroke="#7a2a00" strokeOpacity=".6" />
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={cp ? 5 : 4} fill="none" stroke="#ffb02e" strokeWidth={cp ? 3 : 4} filter={`url(#${u}glow)`} opacity=".7" />
                    </motion.g>
                  )}
                </AnimatePresence>
                {text(b.x + b.w / 2, b.y + b.h / 2 + 0.5, Math.min(b.h * 0.58, Math.max(cp ? 15 : 13, fine)), n, { font: SANS, weight: 900, fill: made ? '#3a1200' : CREAM, opacity: made ? 1 : 0.6 })}
              </g>
            )
          })}
      </svg>

      {/* the odds spots: dashed rings just behind a line bet, beside a come bet */}
      {rings.map((o) => {
        const [ax, ay] = layout.at[o]!
        const rr = ringR * (inBox(o) ? BOX_CHIP : 1)
        const hit = Math.max(36, rr * 2 * k + 6)
        const box = { x: ax - rr, y: ay - rr, w: rr * 2, h: rr * 2 }
        return (
          <button
            key={o}
            className="absolute z-[1] flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-gold"
            style={{ left: ax * k - hit / 2, top: ay * k - hit / 2, width: hit, height: hit }}
            aria-label={`${betName(o)}${table.bets[o] ? `, ${fmt(table.bets[o]!)} on it` : ''}`}
            {...spotEvents(o, box)}
          >
            <motion.span
              className="flex items-center justify-center rounded-full border-[1.5px] border-dashed font-black uppercase leading-none"
              style={{ width: rr * 2 * k, height: rr * 2 * k, fontSize: Math.max(8.5, rr * k * 0.42), borderColor: isLay(o) ? '#ffd0c4' : '#ffe08a', color: isLay(o) ? '#ffd0c4' : '#ffe08a', background: 'rgba(10,40,26,.6)' }}
              initial={{ scale: 0.4, opacity: 0 }}
              // (hidden under its chips once odds are on it: the ring stays the spot to tap)
              animate={pulse === o ? { scale: [1, 1.14, 1], opacity: 1 } : { scale: 1, opacity: stakeAt.has(o) ? 0 : 1 }}
              transition={pulse === o ? { duration: 1.3, repeat: Infinity } : { type: 'spring', stiffness: 500, damping: 24 }}
            >
              {isLay(o) ? 'Lay' : 'Odds'}
            </motion.span>
          </button>
        )
      })}

      {/* the puck */}
      {puckAt && (
        <motion.div
          className="pointer-events-none absolute z-[3]"
          initial={false}
          animate={{ left: puckAt[0] * k - layout.puck.r * k, top: puckAt[1] * k - layout.puck.r * k, scale: [1, 1.18, 1] }}
          transition={{ type: 'spring', stiffness: 260, damping: 24, scale: { duration: 0.5 } }}
          key={puck === null ? 'off' : 'on'}
          style={{ width: layout.puck.r * 2 * k, height: layout.puck.r * 2 * k }}
        >
          <PuckGlyph on={puck !== null} size={layout.puck.r * 2 * k} />
        </motion.div>
      )}

      {/* the chips */}
      <div className="pointer-events-none absolute inset-0 z-[2]">
        <AnimatePresence custom={exits}>
          {piles.map((p) => {
            const a = layout.at[p.key]
            if (!a) return null
            const size = inBox(p.key) ? boxChip : chip
            const ax = a[0] * k
            const ay = a[1] * k
            const side = p.win ? size * 0.34 : winsFor.has(p.key) ? -size * 0.34 : 0
            const from = p.from ? layout.at[p.from] : null
            const out = (m: Readonly<Record<string, Exit>>) => {
              const e = m[p.id] ?? 'player'
              if (e === 'moved') return { opacity: 0, transition: { duration: 0 } }
              if (e === 'house') return { x: house.x - ax, y: house.y - ay, opacity: 0, scale: 0.6, transition: { duration: 0.44, ease: [0.5, 0, 0.75, 0] as const, opacity: { duration: 0.44, ease: [0.7, 0, 1, 0.4] as const } } }
              return { x: side, y: stageH - oy - ay + size, opacity: 0, transition: { duration: 0.5, ease: [0.5, 0, 0.75, 0] as const } }
            }
            return (
              <motion.div
                key={p.id}
                className="absolute"
                style={{ left: ax - size / 2, top: ay - size / 2 }}
                custom={exits}
                initial={p.win ? { x: house.x - ax, y: house.y - ay, opacity: 0, scale: 0.7 } : from ? { x: (from[0] - a[0]) * k, y: (from[1] - a[1]) * k, opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6, y: -12 }}
                animate={{ x: side, y: 0, opacity: 1, scale: 1 }}
                exit="out"
                variants={{ out }}
                transition={p.win ? { duration: 0.55, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.18 } } : from ? { duration: 0.7, ease: [0.3, 0.7, 0.2, 1] } : { type: 'spring', stiffness: 520, damping: 28 }}
              >
                <ChipPile amount={p.amount} size={size} />
                {!p.win && isOff(p.key) && (
                  <span className="absolute -right-1.5 -top-2 rounded-full bg-[#141214] px-1 py-[1px] font-black leading-none tracking-wide text-[#f4f1ea] ring-1 ring-white/40" style={{ fontSize: Math.max(8, size * 0.26) }}>
                    OFF
                  </span>
                )}
                {p.win && (
                  <motion.span
                    className="tnum absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-[linear-gradient(180deg,#fff3c4,#ffd45c_60%,#f0a52a)] font-black leading-none text-[#2a1600] shadow-[0_2px_8px_rgba(0,0,0,.55)] ring-1 ring-[#5a2c00]/70"
                    style={{ fontSize: tagPx, padding: `${tagPx * 0.22}px ${tagPx * 0.42}px` }}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.35, type: 'spring', stiffness: 480, damping: 20 }}
                  >
                    +{fmt(p.amount, p.amount % 1 ? 2 : 0)}
                  </motion.span>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* the tooltip */}
      <AnimatePresence>
        {tip && (
          <motion.div
            key={tip.key}
            className="pointer-events-none absolute z-30 w-[268px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-full rounded-xl border border-gold/25 bg-[linear-gradient(180deg,#112b1f,#0b1f16)] px-3 py-2 shadow-[0_14px_34px_-10px_rgba(0,0,0,.85)]"
            style={{ left: Math.min(bw - 134, Math.max(134, (tip.box.x + tip.box.w / 2) * k)), top: tip.box.y * k - 10 }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.14, delay: tip.touch ? 0 : 0.15 }}
          >
            {(() => {
              const t = betTip(tip.key, table)
              const on = table.bets[tip.key]
              return (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-extrabold text-ink">{t.title}</span>
                    {on ? <span className="tnum text-[12px] font-extrabold text-gold">{fmt(on)} on it</span> : null}
                  </div>
                  {t.lines.map((l, i) => (
                    <div key={i} className={`text-[11.5px] font-semibold leading-snug ${i === 1 ? 'mt-1 text-[#ffe08a]' : 'text-muted'}`}>
                      {l}
                    </div>
                  ))}
                </>
              )
            })()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
