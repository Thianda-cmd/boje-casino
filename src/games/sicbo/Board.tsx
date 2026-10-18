import { memo, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { Chip, chipLabel } from '../../art/Chip'
import { useUid } from '../../art/ids'
import { fmt } from '../../lib/format'
import { DieGlyph, IvoryDefs } from './art'
import type { Cell, TableLayout } from './layout'
import { FACES, SINGLE_ODDS, spotOf, type BetKey, type BetKind, type Bets, type Die, type Lucky } from './rules'
import { oddsText, spotTip, spotTitle } from './words'

/*
  The betting table: one SVG drawn from the layout's cells (so it scales as a whole and stays crisp), printed in
  ivory and gold on the felt, with the chip stacks on top as HTML so they can drop in, be swept off to the house or
  slide back to the player, and over the chips a last layer for what must never be covered: the ×N badges, a struck
  cell's odds this roll and, at the result, what each winning bet paid.

  A cell shows its dice or label and its odds; however small the table is drawn, the odds never print smaller than a
  readable floor. When lightning strikes a cell it turns gold, its badge lands, and its printed odds float off as the
  new odds count up on a pill (a cell holding the player's chips makes them jump). At the result every winning cell
  lights up and the rest dim; the dealer sweeps the losing chips to the top of the table, pays the winners from
  there, beside their stakes, and a tag under the chips says what each paid (on a struck cell the odds pill turns
  into it).

  Click or tap places the chosen chip, right-click or a long press takes one off; a hover (mouse only) shows the
  spot's tooltip; Tab reaches every cell, and Enter or Space places a chip.
*/

export type Leaving = 'house' | 'player'

const GOLD = '#f7c548'
const IVORY = '#f7efdd'
const TONE: Partial<Record<BetKind, string>> = {
  small: 'rgba(76,150,255,.2)',
  big: 'rgba(240,64,86,.22)',
  triple: 'rgba(247,197,72,.09)',
  anyTriple: 'rgba(247,197,72,.15)',
  odd: 'rgba(255,255,255,.05)',
  even: 'rgba(255,255,255,.05)',
  single: 'rgba(255,255,255,.04)',
}
const TITLE_INK: Partial<Record<BetKind, string>> = { small: '#cfe3ff', big: '#ffd2d8' }
/** the smallest the odds may print, in screen px */
const ODDS_FLOOR = 10
/** at the result, a losing cell's opacity */
const DIM = 0.4

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

/* ---------------- a cell's print ---------------- */

const EASE_IN = [0.5, 0, 0.75, 0] as const

/**
 * Where a cell prints its odds: the line's centre and baseline, and its size, in layout units (never below the
 * readable floor at scale k, screen px per unit).
 */
function oddsAt(c: Cell, compact: boolean, k: number): { x: number; y: number; size: number } {
  const kind = spotOf(c.key).kind
  const x = c.x + c.w / 2
  const floor = ODDS_FLOOR / k
  if (compact) {
    const y = { total: 33, double: 36, triple: 35, anyTriple: 34, combo: 33 }[kind as string] ?? 34
    return { x, y: c.y + y, size: Math.max(floor, kind === 'triple' || kind === 'total' || kind === 'combo' ? 9.5 : 10) }
  }
  const at = (dy: number, size: number) => ({ x, y: c.y + dy, size: Math.max(floor, size) })
  switch (kind) {
    case 'total':
      return at(58, 14.5)
    case 'double':
      return at(129, 16)
    case 'triple':
      return at(40.5, 12.5)
    case 'anyTriple':
      return at(135, 18)
    case 'combo':
      return at(84, 14.5)
    default:
      return at(c.h * 0.7, 15)
  }
}

/** the odds line as printed (a struck cell's odds this roll sit on a pill above the chips instead) */
function Odds({ x, y, size, base }: { x: number; y: number; size: number; base: number }) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={800} fill={GOLD} textAnchor="middle" letterSpacing={size * 0.04}>
      {oddsText(base)}
    </text>
  )
}

const label = (x: number, y: number, size: number, text: string, fill = IVORY, ls = 0.06) => (
  <text x={x} y={y} fontSize={size} fontWeight={900} fill={fill} textAnchor="middle" letterSpacing={size * ls}>
    {text}
  </text>
)

/**
 * The print inside one cell: dice or words, and the odds (left off while the cell is struck). `k` is the table's
 * scale (screen px per unit, to two places), which sets the odds' floor.
 */
const CellArt = memo(function CellArt({ c, compact, k, ivory, struck }: { c: Cell; compact: boolean; k: number; ivory: string; struck: boolean }) {
  const s = spotOf(c.key)
  const cx = c.x + c.w / 2
  const floor = ODDS_FLOOR / k
  const odds = struck ? null : <Odds {...oddsAt(c, compact, k)} base={s.odds} />
  const die = (n: Die, x: number, y: number, size: number) => <DieGlyph key={`${x}-${y}`} n={n} x={x} y={y} s={size} fill={ivory} />
  /** dice in a column (or a row) centred on the cell, starting at y */
  const dice = (faces: readonly Die[], size: number, y: number, vertical: boolean, gap: number) =>
    faces.map((n, i) => (vertical ? die(n, cx - size / 2, y + i * (size + gap), size) : die(n, cx - (faces.length * size + (faces.length - 1) * gap) / 2 + i * (size + gap), y, size)))

  switch (s.kind) {
    case 'small':
    case 'big': {
      const ink = TITLE_INK[s.kind]
      const range = s.kind === 'small' ? '4 – 10' : '11 – 17'
      if (compact)
        return (
          <>
            {label(cx, c.y + 19, 15, s.label.toUpperCase(), ink, 0.1)}
            <text x={cx} y={c.y + 34} fontSize={Math.max(floor, 9.5)} fontWeight={800} textAnchor="middle" fill={IVORY} fillOpacity={0.75}>
              {range} · <tspan fill={GOLD}>1:1</tspan>
            </text>
          </>
        )
      return (
        <>
          {label(cx, c.y + 52, 26, s.label.toUpperCase(), ink, 0.1)}
          {label(cx, c.y + 78, 16, range, IVORY)}
          <Odds x={cx} y={c.y + 107} size={17} base={1} />
          {/* a footnote, printed only where it can be read (the tooltip and the paytable say it too) */}
          {k >= 0.7 && (
            <text x={cx} y={c.y + 137} fontSize={10.5} fontWeight={800} textAnchor="middle" fill={IVORY} fillOpacity={0.5} letterSpacing={0.6}>
              TRIPLES LOSE
            </text>
          )}
        </>
      )
    }
    case 'odd':
    case 'even':
      if (compact)
        return (
          <>
            {label(cx, c.y + 20, 15, s.label.toUpperCase(), IVORY, 0.1)}
            <Odds x={cx} y={c.y + 34} size={Math.max(floor, 10)} base={1} />
          </>
        )
      return (
        <>
          {label(cx, c.y + 70, 22, s.label.toUpperCase(), IVORY, 0.1)}
          <Odds x={cx} y={c.y + 98} size={16} base={1} />
        </>
      )
    case 'total':
      return compact ? (
        <>
          {label(cx, c.y + 21, 17, String(s.total), IVORY, 0)}
          {odds}
        </>
      ) : (
        <>
          {label(cx, c.y + 37, 32, String(s.total), IVORY, 0)}
          {odds}
        </>
      )
    case 'double':
      return compact ? (
        <>
          {dice([s.faces[0], s.faces[0]], 16.5, c.y + 5, false, 3)}
          {odds}
        </>
      ) : (
        <>
          {dice([s.faces[0], s.faces[0]], 31, c.y + 18, true, 7)}
          {odds}
        </>
      )
    case 'triple':
      return compact ? (
        <>
          {dice([s.faces[0], s.faces[0], s.faces[0]], 11, c.y + 7, false, 1.5)}
          {odds}
        </>
      ) : (
        <>
          {dice([s.faces[0], s.faces[0], s.faces[0]], 16.5, c.y + 5, false, 2)}
          {odds}
        </>
      )
    case 'anyTriple':
      if (compact)
        return (
          <>
            {label(cx, c.y + 18, 10.5, 'ANY TRIPLE', IVORY, 0.05)}
            {odds}
          </>
        )
      return (
        <>
          {label(cx, c.y + 29, 17, 'ANY', IVORY, 0.12)}
          {label(cx, c.y + 49, 17, 'TRIPLE', IVORY, 0.12)}
          {FACES.map((n, i) => die(n, cx - 35 + (i % 3) * 25, c.y + 60 + Math.floor(i / 3) * 26, 20))}
          {odds}
        </>
      )
    case 'combo':
      return compact ? (
        <>
          {dice(s.faces, 16.5, c.y + 4.5, false, 3)}
          {odds}
        </>
      ) : (
        <>
          {dice(s.faces, 29, c.y + 7, true, 4)}
          {odds}
        </>
      )
    case 'single': {
      if (compact)
        return (
          <>
            {die(s.faces[0], cx - 11, c.y + 5, 22)}
            <Odds x={cx} y={c.y + 39} size={Math.max(floor, 9.5)} base={SINGLE_ODDS[1]} />
          </>
        )
      // the die, then what it pays on one, two and three dice (tiny dice above each); spaced for the floor's sizes
      const at = [c.x + 73, c.x + 104, c.x + 137]
      return (
        <>
          {die(s.faces[0], c.x + 10, c.y + 12, 42)}
          {[1, 2, 3].map((n) => {
            const mx = at[n - 1]
            return (
              <g key={n}>
                {Array.from({ length: n }, (_, i) => (
                  <rect key={i} x={mx - (n * 6 + (n - 1) * 2) / 2 + i * 8} y={c.y + 17} width={6} height={6} rx={1.4} fill={IVORY} fillOpacity={0.85} />
                ))}
                <text x={mx} y={c.y + 46} fontSize={Math.max(floor, n === 1 ? 15 : 13)} fontWeight={900} fill={GOLD} textAnchor="middle">
                  {SINGLE_ODDS[n]}:1
                </text>
              </g>
            )
          })}
        </>
      )
    }
  }
})

/** a number of odds counting up from `from` to `to` as the pill lands */
function CountOdds({ from, to }: { from: number; to: number }) {
  const [v, setV] = useState(from)
  useEffect(() => {
    const c = animate(from, to, { duration: 0.42, delay: 0.08, ease: [0.2, 0.7, 0.3, 1], onUpdate: (x) => setV(Math.round(x)) })
    return () => c.stop()
  }, [from, to])
  return <>{oddsText(v)}</>
}

/** a payout as its tag prints it: in full where the cell has room, else short ("+12.5K", "+15K", "+1.25M") */
function payText(v: number, roomPx: number, fontPx: number) {
  const full = `+${fmt(v, v % 1 ? 2 : 0)}`
  const width = (s: string) => s.length * fontPx * 0.6 + fontPx * 0.9
  if (width(full) <= roomPx || v < 1e4) return full
  return v >= 1e6 ? `+${+(v / 1e6).toFixed(2)}M` : `+${+(v / 1e3).toFixed(1)}K`
}

/* ---------------- the table ---------------- */

export interface BoardProps {
  layout: TableLayout
  left: number
  top: number
  width: number
  height: number
  stageH: number
  bets: Bets
  /** winnings paid beside a stake (payout minus stake) */
  wins: Bets
  leaving: Leaving
  struck: readonly Lucky[]
  /** the spots that won this roll, while the result shows */
  winning: ReadonlySet<BetKey> | null
  interactive: boolean
  onPlace: (k: BetKey) => void
  onRemove: (k: BetKey) => void
  shake: { key: BetKey; n: number } | null
}

export function Board({ layout, left, top, width, height, stageH, bets, wins, leaving, struck, winning, interactive, onPlace, onRemove, shake }: BoardProps) {
  const u = useUid()
  const k = width / layout.vw
  // the cells' print redraws only when the scale changes noticeably
  const k2 = Math.round(k * 100) / 100
  const compact = layout.id === 'compact'
  const chip = compact ? Math.round(Math.min(30, Math.max(22, 27 * k))) : Math.round(Math.min(46, Math.max(28, 40 * k)))
  const [flash, setFlash] = useState<Partial<Record<BetKey, number>>>({})
  const [tip, setTip] = useState<BetKey | null>(null)
  const pressTimer = useRef(0)
  const longPress = useRef(false)
  const lastPointer = useRef('mouse')
  /** when a pointer last went down on a spot, and whether the spot in focus got there by keyboard */
  const downAt = useRef(0)
  const keyFocus = useRef(false)
  const multOf = (key: BetKey) => struck.find((l) => l.key === key)?.mult ?? 1
  useEffect(() => () => clearTimeout(pressTimer.current), [])
  // the spots whose payout tag has shown this round: their odds pill stays gone as the chips go back
  const paid = useRef(new Set<BetKey>())
  if (!struck.length) paid.current.clear()
  for (const key of Object.keys(wins) as BetKey[]) paid.current.add(key)

  const press = (key: BetKey) => {
    if (longPress.current) {
      longPress.current = false
      return
    }
    if (!interactive) return
    setFlash((f) => ({ ...f, [key]: (f[key] ?? 0) + 1 }))
    onPlace(key)
  }
  const onDown = (e: ReactPointerEvent, key: BetKey) => {
    lastPointer.current = e.pointerType
    downAt.current = performance.now()
    longPress.current = false
    clearTimeout(pressTimer.current)
    if (e.pointerType !== 'touch' || !interactive) return
    // a long press takes a chip off (the click that follows is swallowed)
    pressTimer.current = window.setTimeout(() => {
      longPress.current = true
      onRemove(key)
      navigator.vibrate?.(12)
    }, 450)
  }
  const cancelPress = () => clearTimeout(pressTimer.current)
  // A focused spot takes a chip on Enter, and on Space when it was reached with the keyboard (a spot just clicked
  // leaves Space to roll, the page's own key)
  const onKey = (e: ReactKeyboardEvent, key: BetKey) => {
    if (e.key === 'Enter' || (e.key === ' ' && keyFocus.current)) {
      e.preventDefault()
      e.stopPropagation()
      press(key)
    }
  }

  const tipCell = tip ? layout.byKey.get(tip) : null
  const tipText = tip ? spotTip(tip, multOf(tip)) : null
  const tipX = tipCell ? Math.min(width - 128, Math.max(128, (tipCell.x + tipCell.w / 2) * k)) : 0
  const r = compact ? 6 : 8
  const lost = (key: BetKey) => !!winning && !winning.has(key)
  // the dealer's spot, where lost chips go and winnings come from: the middle of the table's top rail (board px)
  const dealer = { x: width / 2, y: -chip * 0.7 }
  const tagPx = compact ? 10.5 : Math.round(Math.min(13, Math.max(11, 15 * k)))

  return (
    <div className="absolute" style={{ left, top, width, height }}>
      <svg
        viewBox={`0 0 ${layout.vw} ${layout.vh}`}
        className="absolute inset-0 h-full w-full overflow-visible [-webkit-touch-callout:none]"
        aria-label="Sic Bo table"
        onPointerLeave={() => setTip(null)}
      >
        <defs>
          <IvoryDefs id={`${u}iv`} />
          <linearGradient id={`${u}sheen`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".08" />
            <stop offset=".45" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${u}win`} cx=".5" cy=".5" r=".7">
            <stop offset="0" stopColor="#fff8dc" stopOpacity=".42" />
            <stop offset="1" stopColor="#ffd45c" stopOpacity=".12" />
          </radialGradient>
          <filter id={`${u}glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={compact ? 2.4 : 3.6} />
          </filter>
        </defs>

        {layout.cells.map((c) => {
          const s = spotOf(c.key)
          const placed = !!bets[c.key]
          const mult = multOf(c.key)
          const won = !!winning && winning.has(c.key)
          return (
            <motion.g
              // a refused chip shakes the cell: a new key replays the shake
              key={`${c.key}${shake?.key === c.key ? shake.n : ''}`}
              className={`group outline-none ${interactive ? 'cursor-pointer' : ''}`}
              role="button"
              tabIndex={interactive ? 0 : -1}
              aria-label={`${spotTitle(c.key)}, pays ${oddsText(s.kind === 'single' ? SINGLE_ODDS[1] : s.odds * mult)}${won ? ', won' : ''}${placed ? `, ${fmt(bets[c.key]!)} on it` : ''}`}
              onClick={() => press(c.key)}
              onContextMenu={(e) => {
                e.preventDefault()
                // a touch's long press is handled by its own timer
                if (lastPointer.current !== 'touch' && interactive) onRemove(c.key)
              }}
              onPointerDown={(e) => onDown(e, c.key)}
              onFocus={() => (keyFocus.current = performance.now() - downAt.current > 500)}
              onPointerUp={cancelPress}
              onPointerCancel={cancelPress}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setTip(c.key)}
              onPointerLeave={() => {
                cancelPress()
                setTip((t) => (t === c.key ? null : t))
              }}
              onKeyDown={(e) => onKey(e, c.key)}
              animate={shake?.key === c.key ? { x: [0, -6, 5, -3, 2, 0] } : { x: 0 }}
              transition={{ duration: 0.36 }}
            >
              {/* (the dimming sits on a plain group: framer owns the motion group's style) */}
              <g style={{ opacity: lost(c.key) ? DIM : 1, transition: 'opacity .35s' }}>
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill={TONE[s.kind] ?? 'rgba(0,0,0,.18)'} stroke="rgba(247,197,72,.5)" strokeWidth={compact ? 1.1 : 1.3} />
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill={`url(#${u}sheen)`} pointerEvents="none" />
                <rect
                  x={c.x}
                  y={c.y}
                  width={c.w}
                  height={c.h}
                  rx={r}
                  fill="#fff"
                  pointerEvents="none"
                  className={`opacity-0 transition-opacity duration-150 ${interactive ? 'group-hover:opacity-[.08] group-focus-visible:opacity-[.1]' : ''}`}
                />
                {flash[c.key] ? (
                  <motion.rect
                    key={flash[c.key]}
                    x={c.x}
                    y={c.y}
                    width={c.w}
                    height={c.h}
                    rx={r}
                    fill="#ffe7a0"
                    initial={{ opacity: 0.3 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    pointerEvents="none"
                  />
                ) : null}
                <g pointerEvents="none" style={{ opacity: placed ? 0.42 : 1, transition: 'opacity .25s' }}>
                  <CellArt c={c} compact={compact} k={k2} ivory={`url(#${u}iv)`} struck={mult > 1} />
                </g>
              </g>
              {/* the keyboard's focus: a gold ring */}
              <rect
                x={c.x + 1}
                y={c.y + 1}
                width={c.w - 2}
                height={c.h - 2}
                rx={r}
                fill="none"
                stroke={GOLD}
                strokeWidth={compact ? 2.2 : 3}
                pointerEvents="none"
                className="opacity-0 group-focus-visible:opacity-100"
              />
            </motion.g>
          )
        })}

        {/* struck cells: a gold frame with a soft glow (faded with the cell if it lost) */}
        <g pointerEvents="none">
          <AnimatePresence>
            {struck.map((l) => {
              const c = layout.byKey.get(l.key)
              if (!c) return null
              return (
                <motion.g
                  key={`s-${l.key}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: lost(l.key) ? DIM : 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.4 } }}
                  transition={{ duration: lost(l.key) ? 0.35 : 0.12 }}
                >
                  <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill="#ffd45c" fillOpacity={0.14} />
                  <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill="none" stroke="#ffcf40" strokeWidth={compact ? 4 : 6} filter={`url(#${u}glow)`} opacity={0.8} />
                  <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill="none" stroke="#ffe27a" strokeWidth={compact ? 1.8 : 2.6} />
                </motion.g>
              )
            })}
          </AnimatePresence>
        </g>

        {/* the result: every winning cell lights up */}
        <g pointerEvents="none">
          <AnimatePresence>
            {winning &&
              [...winning].map((key) => {
                const c = layout.byKey.get(key)
                if (!c) return null
                const mine = !!bets[key] || !!wins[key]
                return (
                  <motion.g key={`w-${key}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.45 } }} transition={{ duration: 0.3 }}>
                    <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill={`url(#${u}win)`} />
                    <motion.rect
                      x={c.x}
                      y={c.y}
                      width={c.w}
                      height={c.h}
                      rx={r}
                      fill="none"
                      stroke="#ffe9a0"
                      strokeWidth={compact ? 5 : 8}
                      filter={`url(#${u}glow)`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: mine ? [0, 1, 0.55, 0.95] : [0, 0.7, 0.4] }}
                      transition={{ duration: 1.5, times: mine ? [0, 0.25, 0.6, 1] : [0, 0.35, 1], ease: 'easeInOut' }}
                    />
                    <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={r} fill="none" stroke="#fff4c4" strokeWidth={compact ? 1.8 : 2.4} />
                  </motion.g>
                )
              })}
          </AnimatePresence>
        </g>
      </svg>

      {/* the chips */}
      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence custom={leaving}>
          {layout.cells.flatMap((c) => {
            const ax = c.ax * k
            const ay = c.ay * k
            const down = stageH - top - ay + chip
            // to the dealer (lost), or back down to the player (the table cleared, or the round's chips collected)
            const toDealer = { x: dealer.x - ax, y: dealer.y - ay }
            const out = (to: Leaving) =>
              to === 'house'
                ? { ...toDealer, opacity: 0, scale: 0.6, transition: { duration: 0.42, ease: EASE_IN, opacity: { duration: 0.42, ease: [0.7, 0, 1, 0.4] } } }
                : { y: down, opacity: 0, transition: { duration: 0.5, ease: EASE_IN } }
            const items = []
            const stakeAmt = bets[c.key]
            const winAmt = wins[c.key]
            const struckHere = multOf(c.key) > 1
            if (stakeAmt)
              items.push(
                <motion.div
                  key={c.key}
                  className="absolute"
                  style={{ left: ax - chip / 2, top: ay - chip / 2 }}
                  initial={{ opacity: 0, scale: 0.6, y: -12 }}
                  // beside its winnings once paid; a jump when lightning strikes its spot
                  animate={{ opacity: 1, scale: 1, x: winAmt ? -chip * 0.3 : 0, y: struckHere && !winning ? [0, -chip * 0.45, 0, -chip * 0.12, 0] : 0 }}
                  exit="out"
                  variants={{ out }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28, y: struckHere && !winning ? { duration: 0.55, times: [0, 0.3, 0.62, 0.8, 1], ease: 'easeOut' } : undefined }}
                >
                  <ChipPile amount={stakeAmt} size={chip} />
                </motion.div>,
              )
            if (winAmt)
              items.push(
                <motion.div
                  key={`${c.key}-win`}
                  className="absolute"
                  style={{ left: ax - chip / 2, top: ay - chip / 2 }}
                  initial={{ ...toDealer, opacity: 0, scale: 0.7 }}
                  animate={{ x: chip * 0.3, y: 0, opacity: 1, scale: 1 }}
                  exit="out"
                  variants={{ out }}
                  transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.18 } }}
                >
                  <ChipPile amount={winAmt} size={chip} />
                </motion.div>,
              )
            return items
          })}
        </AnimatePresence>
      </div>

      {/* over the chips: the badges, a struck cell's odds this roll, and at the result what each winning bet paid */}
      <svg viewBox={`0 0 ${layout.vw} ${layout.vh}`} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`${u}badge`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff3b0" />
            <stop offset=".5" stopColor="#ffd04d" />
            <stop offset="1" stopColor="#f0a020" />
          </linearGradient>
        </defs>
        <AnimatePresence>
          {struck.map((l) => {
            const c = layout.byKey.get(l.key)
            if (!c) return null
            const h = compact ? 17 : 26
            const fs = compact ? 12 : 18
            const w = (String(l.mult).length + 1) * fs * 0.62 + (compact ? 9 : 14)
            const x = Math.max(1, Math.min(layout.vw - w - 1, c.x + c.w - w * 0.72))
            const y = Math.max(1, c.y - h * 0.58)
            return (
              <motion.g key={`b-${l.key}`} initial={{ opacity: 1 }} animate={{ opacity: lost(l.key) ? 0.55 : 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} transition={{ duration: 0.35 }}>
                <motion.g
                  initial={{ scale: 0, rotate: -25 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 13 }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                >
                  <rect x={x} y={y + h * 0.1} width={w} height={h} rx={h / 2} fill="#2a1200" opacity={0.55} />
                  <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={`url(#${u}badge)`} stroke="#5a2c00" strokeWidth={compact ? 1.1 : 1.5} />
                  <text x={x + w / 2} y={y + h * 0.74} fontSize={fs} fontWeight={900} fill="#2a1200" textAnchor="middle">
                    ×{l.mult}
                  </text>
                </motion.g>
              </motion.g>
            )
          })}
        </AnimatePresence>
      </svg>
      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence>
          {struck.map((l) => {
            const c = layout.byKey.get(l.key)
            // a winning struck cell's pill gives way to its payout tag
            if (!c || paid.current.has(l.key)) return null
            const o = oddsAt(c, compact, k)
            const px = Math.max(ODDS_FLOOR, o.size * k * 1.1)
            const base = spotOf(l.key).odds
            return (
              <motion.div
                key={`o-${l.key}`}
                className="absolute z-[5] -translate-x-1/2 -translate-y-1/2"
                style={{ left: o.x * k, top: (o.y - o.size * 0.36) * k }}
                initial={{ opacity: 0 }}
                animate={{ opacity: lost(l.key) ? 0.5 : 1 }}
                exit={{ opacity: 0, transition: { duration: 0.25 } }}
                transition={{ duration: 0.15 }}
              >
                {/* the odds as printed float off... */}
                <motion.span
                  className="tnum absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-extrabold leading-none text-gold"
                  style={{ fontSize: o.size * k }}
                  initial={{ opacity: 1, y: 0 }}
                  animate={{ opacity: 0, y: -o.size * k * 1.4 }}
                  transition={{ duration: 0.45, ease: 'easeOut' }}
                >
                  {oddsText(base)}
                </motion.span>
                {/* ...and the odds this roll count up on a pill */}
                <motion.span
                  className="tnum block whitespace-nowrap rounded-full bg-[linear-gradient(180deg,#3a1d00,#1f0e00)] font-black leading-none text-[#ffe9a3] shadow-[0_2px_6px_rgba(0,0,0,.5)] ring-1 ring-[#ffd45c]/80"
                  style={{ fontSize: px, padding: `${px * 0.22}px ${px * 0.45}px` }}
                  initial={{ scale: 1.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 16 }}
                >
                  <CountOdds from={base} to={base * l.mult} />
                </motion.span>
              </motion.div>
            )
          })}
          {layout.cells.map((c) => {
            const v = wins[c.key]
            if (!v) return null
            // under the chips, inside the cell
            const tagU = (tagPx * 1.5) / k
            const chipU = chip / k
            const room = c.w * k - 4
            const text = payText(v, room, tagPx)
            const half = (text.length * tagPx * 0.6 + tagPx * 0.9) / 2 / k
            const x = Math.min(c.x + c.w - half - 1, Math.max(c.x + half + 1, c.ax))
            const y = Math.min(c.y + c.h - tagU / 2 - 1.5, c.ay + chipU / 2 + tagU / 2 - 2 / k)
            return (
              <motion.div
                key={`t-${c.key}`}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: x * k, top: y * k }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.25 } }}
                transition={{ delay: 0.3, type: 'spring', stiffness: 480, damping: 20 }}
              >
                <span
                  className="tnum block whitespace-nowrap rounded-full bg-[linear-gradient(180deg,#fff3c4,#ffd45c_60%,#f0a52a)] font-black leading-none text-[#2a1600] shadow-[0_2px_8px_rgba(0,0,0,.55)] ring-1 ring-[#5a2c00]/70"
                  style={{ fontSize: tagPx, padding: `${tagPx * 0.25}px ${tagPx * 0.45}px` }}
                >
                  {text}
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* the hover tooltip */}
      <AnimatePresence>
        {tipCell && tipText && (
          <motion.div
            key={tip}
            className="pointer-events-none absolute z-30 w-[256px] -translate-x-1/2 -translate-y-full rounded-xl border border-gold/25 bg-[#140a0d]/95 px-3 py-2 shadow-[0_14px_34px_-10px_rgba(0,0,0,.85)]"
            style={{ left: tipX, top: tipCell.y * k - 10 }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.14, delay: 0.12 }}
          >
            <div className="text-[13px] font-extrabold text-ink">{tipText.title}</div>
            {tipText.lines.map((l, i) => (
              <div key={i} className={`tnum text-[11.5px] font-semibold leading-snug ${l.startsWith('Struck') ? 'text-gold' : 'text-muted'}`}>
                {l}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
