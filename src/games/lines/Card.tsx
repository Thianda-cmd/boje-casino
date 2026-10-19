import { memo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CARD_H, CARD_W, CELL, GAP, GRID_TOP, HEAD, cellXY, colX } from './layout'
import { COL, FONT, GOLD, HatBadge, INK, LetterBall, blobPath, droplets, twinklePath } from './art'
import { LINES, LINES_AT, colOf, doneLines } from './rules'

/*
  The bingo card: a glossy grape frame with the L-U-C-K-Y balls across the top, and 25 numbers on cream discs. One
  SVG, drawn in layers so a finished line's gold stroke passes over the daubs but under the numbers (they stay
  readable however many lines run through them): the frame and discs, the glows (a column lit by a Joker, the whole
  field by a Super Joker), the daubs, the lines, the numbers, then the joker targets. Clickable cells sit on top as
  buttons, live only while a joker waits.

  A number a line still needs (the line's other four are marked) sits on a warm disc in a steady gold ring, so the
  tension the decision plate talks about is plain on the card; while that decision is up the rings breathe. While a
  joker waits, its targets say what they would do: a gold ring on a number that finishes a line, a solid ring on one
  that leaves a line a number away, a dashed one otherwise, and the suggested one pulses under a BEST tag. Pointing
  at a target (or focusing it) traces the lines through it and tags it with what it does ("LINE!", "4 OF 5").

  A daub that has just been stamped plays its stamp (ink splat, ring, number pop): `stamps` counts each cell's
  stamps, so a new stamp remounts it. Daubs and lines already there when a card is shown (a resumed game) just sit.
  Endless loops (glows, pulses) hold still for players who ask their system for less motion.
*/

/** what marking a cell would do: the lines it finishes, and the most marked of the lines through it afterwards */
export interface Effect {
  done: number
  fill: number
}

/** what marking each of `cells` would do to the card */
export function effectsOf(marks: readonly boolean[], cells: Iterable<number>): Map<number, Effect> {
  const out = new Map<number, Effect>()
  for (const i of cells) {
    let done = 0
    let fill = 0
    for (const k of LINES_AT[i]) {
      const n = LINES[k].filter((j) => j === i || marks[j]).length
      if (n === 5) done++
      fill = Math.max(fill, n)
    }
    out.set(i, { done, fill })
  }
  return out
}

interface Props {
  u: string
  card: readonly number[]
  marks: readonly boolean[]
  stamps: Readonly<Record<number, number>>
  jokered: ReadonlySet<number>
  /** cells a waiting joker may go on, with what each would do (null: no joker waiting) */
  placeable: ReadonlyMap<number, Effect> | null
  best: number
  glowCols: ReadonlySet<number>
  superGlow: boolean
  near: ReadonlySet<number>
  /** the extra-spin decision is up: the numbers lines still need call for attention */
  deciding: boolean
  /** changes when a fresh card is dealt */
  dealKey: number
  quick: boolean
  onPick: (cell: number) => void
}

const R = 41
const FIELD = { x: 8, y: GRID_TOP - 8, w: CARD_W - 16, h: CARD_H - 8 - (GRID_TOP - 8) }
const CENTER = { transformBox: 'fill-box', transformOrigin: 'center' } as const
const NEAR_RING = '#f2a51e'

/** a line's stroke, from just outside its first cell to just outside its last */
function lineEnds(k: number) {
  const l = LINES[k]
  const a = cellXY(l[0])
  const b = cellXY(l[4])
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const e = 30 / d
  return { x0: a.x - dx * e, y0: a.y - dy * e, x1: b.x + dx * e, y1: b.y + dy * e }
}
export const LINE_ENDS = LINES.map((_, k) => lineEnds(k))

const effectText = (e: Effect) => (e.done >= 2 ? `${e.done} LINES!` : e.done === 1 ? 'LINE!' : `${e.fill} OF 5`)

export const Card = memo(function Card({ u, card, marks, stamps, jokered, placeable, best, glowCols, superGlow, near, deciding, dealKey, quick, onPick }: Props) {
  const calm = !!useReducedMotion()
  const done = doneLines(marks)
  // lines on the card when it was dealt or shown draw instantly; the ones finished since draw themselves in
  const base = useRef({ key: dealKey, lines: new Set(done) })
  if (base.current.key !== dealKey) base.current = { key: dealKey, lines: new Set(done) }
  const placing = placeable != null
  const [pointed, setPointed] = useState(-1)
  const hover = placing && placeable.has(pointed) ? pointed : -1
  const hoverFx = hover >= 0 ? placeable!.get(hover)! : null
  const loop = (duration: number) => (calm ? { duration: 0 } : { duration, repeat: Infinity, ease: 'easeInOut' as const })

  return (
    <div className="absolute left-0 top-0" style={{ width: CARD_W, height: CARD_H }}>
      <svg width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`${u}frm`} x1="0" y1="0" x2=".35" y2="1">
            <stop offset="0" stopColor="#b48dff" />
            <stop offset=".5" stopColor="#8452f0" />
            <stop offset="1" stopColor="#5f2fd0" />
          </linearGradient>
          <linearGradient id={`${u}fld`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="1" stopColor="#f6ecda" />
          </linearGradient>
          <radialGradient id={`${u}cd`} cx=".42" cy=".34" r=".72">
            <stop offset="0" stopColor="#fffbf1" />
            <stop offset=".7" stopColor="#fbedd0" />
            <stop offset="1" stopColor="#f0d9ac" />
          </radialGradient>
          {/* the warm disc of a number a line still needs */}
          <radialGradient id={`${u}cdw`} cx=".42" cy=".34" r=".72">
            <stop offset="0" stopColor="#fffbe6" />
            <stop offset=".62" stopColor="#ffeaa0" />
            <stop offset="1" stopColor="#f7c955" />
          </radialGradient>
          <radialGradient id={`${u}halo`}>
            <stop offset=".6" stopColor={GOLD} stopOpacity=".9" />
            <stop offset="1" stopColor={GOLD} stopOpacity="0" />
          </radialGradient>
          <pattern id={`${u}dots`} width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="9" cy="9" r="2.2" fill="#fff" opacity=".13" />
          </pattern>
        </defs>

        {/* the frame: a toon shadow, the grape body with its dots, the cream field */}
        <rect x="2" y="11" width={CARD_W - 4} height={CARD_H - 4} rx="30" fill={INK} opacity=".45" />
        <rect x="2" y="2" width={CARD_W - 4} height={CARD_H - 4} rx="30" fill={`url(#${u}frm)`} stroke={INK} strokeWidth="4" />
        <rect x="6" y="6" width={CARD_W - 12} height={HEAD + 4} rx="26" fill={`url(#${u}dots)`} />
        <path d={`M30 9 H${CARD_W - 30}`} stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".35" />
        <path d={twinklePath(CARD_W - 16, 18, 6)} fill="#fff" opacity=".8" />
        <path d={twinklePath(16, HEAD - 6, 4.5)} fill="#fff" opacity=".6" />
        {COL.map((_, c) => (
          <g key={c} transform={`translate(${colX(c) - 25} ${HEAD / 2 + 3 - 25}) scale(.5)`}>
            <LetterBall u={u} col={c} />
          </g>
        ))}
        <rect x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} rx="22" fill={`url(#${u}fld)`} stroke={INK} strokeWidth="3" />

        {/* a Super Joker lights the whole field */}
        <AnimatePresence>
          {superGlow && (
            <motion.rect
              key="super"
              x={FIELD.x - 3}
              y={FIELD.y - 3}
              width={FIELD.w + 6}
              height={FIELD.h + 6}
              rx="25"
              fill={GOLD}
              fillOpacity=".16"
              stroke={GOLD}
              strokeWidth="6"
              initial={{ opacity: 0 }}
              animate={{ opacity: calm ? 0.85 : [0.55, 1, 0.55] }}
              exit={{ opacity: 0, transition: { duration: 0.25 } }}
              transition={loop(1.1)}
            />
          )}
        </AnimatePresence>
        {/* a Joker lights its column */}
        <AnimatePresence>
          {[...glowCols].map((c) => (
            <motion.rect
              key={`col${c}`}
              x={colX(c) - CELL / 2 - 4}
              y={GRID_TOP - 5}
              width={CELL + 8}
              height={5 * CELL + 4 * GAP + 10}
              rx="26"
              fill={COL[c].main}
              fillOpacity=".22"
              stroke={COL[c].main}
              strokeWidth="4"
              initial={{ opacity: 0 }}
              animate={{ opacity: calm ? 0.85 : [0.6, 1, 0.6] }}
              exit={{ opacity: 0, transition: { duration: 0.25 } }}
              transition={loop(1)}
            />
          ))}
        </AnimatePresence>

        {/* the discs (dimmed while a joker waits and can't go there); a number a line still needs on a warm disc, haloed */}
        {card.map((_, i) => {
          const { x, y } = cellXY(i)
          const dim = placing && !marks[i] && !placeable.has(i)
          const needed = near.has(i) && !marks[i]
          return (
            <g key={i} opacity={dim ? 0.5 : 1} style={{ transition: 'opacity .25s' }}>
              {needed && (
                <motion.circle cx={x} cy={y} r={R + 13} fill={`url(#${u}halo)`} initial={{ opacity: 0 }} animate={{ opacity: calm ? 0.6 : [0.35, deciding ? 0.95 : 0.7, 0.35] }} transition={loop(deciding ? 1.1 : 1.6)} />
              )}
              <circle cx={x} cy={y + 2.5} r={R} fill={INK} opacity=".12" />
              <circle cx={x} cy={y} r={R} fill={`url(#${u}${needed ? 'cdw' : 'cd'})`} stroke={INK} strokeOpacity=".2" strokeWidth="2" />
              <path d={`M${x - R * 0.62} ${y - R * 0.42} A${R * 0.75} ${R * 0.75} 0 0 1 ${x - R * 0.1} ${y - R * 0.74}`} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".8" />
              {needed && (
                <motion.circle
                  cx={x}
                  cy={y}
                  r={R - 2.5}
                  fill="none"
                  stroke={NEAR_RING}
                  strokeWidth="5.5"
                  style={CENTER}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.95, scale: deciding && !calm ? [1, 1.07, 1] : 1 }}
                  transition={{ opacity: { duration: 0.25 }, scale: deciding && !calm ? loop(1.1) : { duration: 0.3 } }}
                />
              )}
            </g>
          )
        })}

        {/* the daubs */}
        {card.map((_, i) => (marks[i] ? <Daub key={`${i}-${stamps[i] ?? 0}`} cell={i} fresh={!!stamps[i]} quick={quick} /> : null))}

        {/* the finished lines */}
        {done.map((k) => {
          const e = LINE_ENDS[k]
          const fresh = !base.current.lines.has(k)
          const d = `M${e.x0} ${e.y0} L${e.x1} ${e.y1}`
          const t = { duration: quick ? 0.26 : 0.42, ease: [0.3, 0.7, 0.4, 1] as const }
          return (
            <g key={`line${k}`} strokeLinecap="round" fill="none">
              <motion.path d={d} stroke={INK} strokeWidth="21" opacity=".92" initial={fresh ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={t} />
              <motion.path d={d} stroke={GOLD} strokeWidth="13" initial={fresh ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={t} />
              <motion.path d={d} stroke="#fff6c4" strokeWidth="4" opacity=".9" initial={fresh ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={t} />
            </g>
          )
        })}

        {/* the lines through a pointed-at target: gold dots for one it would finish, white for the rest */}
        {hover >= 0 &&
          LINES_AT[hover].map((k) => {
            const n = LINES[k].filter((j) => j === hover || marks[j]).length
            if (n < 2) return null
            const e = LINE_ENDS[k]
            return (
              <path
                key={`trace${k}`}
                d={`M${e.x0} ${e.y0} L${e.x1} ${e.y1}`}
                stroke={n === 5 ? GOLD : '#fff'}
                strokeWidth={n === 5 ? 11 : 8}
                strokeDasharray={n === 5 ? '1 15' : '1 13'}
                strokeLinecap="round"
                opacity={n === 5 ? 1 : 0.55 + n * 0.08}
                style={{ filter: `drop-shadow(0 0 1.5px ${INK})` }}
              />
            )
          })}

        {/* the numbers: ink on the cream, white on a daub */}
        {card.map((n, i) => {
          const { x, y } = cellXY(i)
          const on = marks[i]
          return (
            <motion.text
              key={`${dealKey}-${i}-${n}-${on ? stamps[i] ?? 0 : 'off'}`}
              x={x}
              y={y + 12}
              textAnchor="middle"
              fontSize={on ? 36 : 34}
              fontWeight="900"
              fontFamily={FONT}
              letterSpacing="-1"
              fill={on ? '#fff' : INK}
              stroke={on ? INK : 'none'}
              strokeWidth={on ? 6 : 0}
              paintOrder="stroke"
              style={CENTER}
              initial={on ? (stamps[i] ? { scale: 1.45 } : false) : { opacity: 0, y: -10 }}
              animate={on ? { scale: 1 } : { opacity: 1, y: 0 }}
              transition={on ? { type: 'spring', stiffness: 600, damping: 14, delay: quick ? 0.03 : 0.06 } : { duration: 0.3, delay: (colOf(i) * 5 + (i % 5)) * 0.018 }}
            >
              {n}
            </motion.text>
          )
        })}

        {/* a joker's hat on the numbers jokers marked */}
        {[...jokered].map((i) =>
          marks[i] ? (
            <g key={`hat${i}`} transform={`translate(${cellXY(i).x + 13} ${cellXY(i).y - 44}) rotate(14 13 13)`}>
              <motion.g style={CENTER} initial={{ scale: 0 }} animate={{ scale: 1.1 }} transition={{ type: 'spring', stiffness: 500, damping: 14, delay: 0.12 }}>
                <HatBadge u={u} />
              </motion.g>
            </g>
          ) : null,
        )}

        {/* where a waiting joker may go: each ring says what the spot would do; the suggested one pulses */}
        {placing &&
          [...placeable].map(([i, e]) => {
            const { x, y } = cellXY(i)
            const c = COL[colOf(i)]
            const top = i === best
            const finishes = e.done > 0
            const setsUp = !finishes && e.fill === 4
            const color = finishes ? GOLD : c.main
            const dashed = !top && !finishes && !setsUp
            return (
              <motion.g
                key={`t${i}`}
                pointerEvents="none"
                style={CENTER}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: top && !calm ? [1, 1.07, 1] : 1 }}
                transition={{ scale: top && !calm ? loop(0.9) : { duration: 0.2 }, opacity: { duration: 0.2 } }}
              >
                {finishes && <circle cx={x} cy={y} r={R + 3} fill="none" stroke={INK} strokeWidth="10" opacity=".85" />}
                <motion.circle
                  cx={x}
                  cy={y}
                  r={R + 3}
                  fill="none"
                  stroke={color}
                  strokeWidth={top || finishes ? 6 : setsUp ? 5 : 4}
                  strokeDasharray={dashed ? '9 7' : undefined}
                  opacity={dashed ? 0.95 : 1}
                  style={CENTER}
                  animate={{ rotate: dashed && !calm ? 360 : 0 }}
                  transition={dashed && !calm ? { duration: 6, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
                />
              </motion.g>
            )
          })}
        {/* the tags: BEST on the suggested spot, what it does on the one pointed at */}
        {placing && best >= 0 && <Tag key={`best${best}`} cell={best} text={hover === best && hoverFx ? `BEST · ${effectText(hoverFx)}` : 'BEST'} color={COL[colOf(best)].dark} bob={!calm} />}
        {hover >= 0 && hover !== best && hoverFx && <Tag key={`fx${hover}`} cell={hover} text={effectText(hoverFx)} color={hoverFx.done ? '#b26b00' : COL[colOf(hover)].dark} bob={false} />}
      </svg>

      {/* the cells, clickable while a joker waits */}
      {card.map((n, i) => {
        const { x, y } = cellXY(i)
        const e = placing ? placeable.get(i) : undefined
        const live = !!e
        return (
          <button
            key={i}
            data-cell={i}
            disabled={!live}
            onClick={() => live && onPick(i)}
            onPointerEnter={(ev) => live && ev.pointerType === 'mouse' && setPointed(i)}
            onPointerLeave={() => setPointed((p) => (p === i ? -1 : p))}
            onFocus={() => live && setPointed(i)}
            onBlur={() => setPointed((p) => (p === i ? -1 : p))}
            aria-label={e ? `Place the joker on ${n}${e.done ? `, finishes ${e.done === 1 ? 'a line' : `${e.done} lines`}` : `, makes a line ${e.fill} of 5`}${i === best ? ', suggested' : ''}` : `${n}${marks[i] ? ', marked' : ''}`}
            className={`absolute rounded-full outline-none transition-transform ${live ? 'cursor-pointer hover:scale-105 hover:bg-white/15 focus-visible:ring-4 focus-visible:ring-white/70 active:scale-95' : 'cursor-default'}`}
            style={{ left: x - R - 2, top: y - R - 2, width: (R + 2) * 2, height: (R + 2) * 2 }}
          />
        )
      })}
    </div>
  )
})

/**
 * A little pill tag above a cell, pointing down at it. On the top row it sits lower, its pointer over the disc's rim,
 * so it stays clear of the letter balls above (and bobs downward only).
 */
function Tag({ cell, text, color, bob }: { cell: number; text: string; color: string; bob: boolean }) {
  const { x, y } = cellXY(cell)
  const top = cell % 5 === 0
  const w = 18 + text.length * 7.6
  // the pill's top edge
  const py = top ? y - R - 15 : y - R - 21
  return (
    <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: bob ? [0, top ? 2 : -3, 0] : 0 }} transition={{ y: bob ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.15 }, opacity: { duration: 0.15 } }} pointerEvents="none">
      <rect x={x - w / 2} y={py} width={w} height="20" rx="10" fill="#fff" stroke={INK} strokeWidth="2.5" />
      <path d={`M${x - 5} ${py + 18.5} L${x} ${py + 25} L${x + 5} ${py + 18.5}`} fill="#fff" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <rect x={x - 6} y={py + 16.5} width="12" height="3" fill="#fff" />
      <text x={x} y={py + 14.5} textAnchor="middle" fontSize="11.5" fontWeight="900" fill={color} fontFamily={FONT} letterSpacing=".8">
        {text}
      </text>
    </motion.g>
  )
}

/** a daub: the ink splat in the column's colour, its droplets and (when just stamped) the ring it sends out */
function Daub({ cell, fresh, quick }: { cell: number; fresh: boolean; quick: boolean }) {
  const { x, y } = cellXY(cell)
  const c = COL[colOf(cell)]
  const k = (R + 3) / 50
  const blob = blobPath(cell + 1, 50, 50, 50)
  const drops = droplets(cell + 1)
  return (
    <g transform={`translate(${x - 50 * k} ${y - 50 * k}) scale(${k})`}>
      {fresh && (
        <motion.circle cx="50" cy="50" r="50" fill="none" stroke={c.main} strokeWidth="6" style={CENTER} initial={{ scale: 0.7, opacity: 0.9 }} animate={{ scale: 1.55, opacity: 0 }} transition={{ duration: quick ? 0.35 : 0.5, ease: 'easeOut' }} />
      )}
      <motion.g style={CENTER} initial={fresh ? { scale: 1.75, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 16 }}>
        <path d={blob} fill={c.dark} transform="translate(0 4)" />
        <path d={blob} fill={c.main} stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
        <ellipse cx="36" cy="30" rx="17" ry="9.5" fill="#fff" opacity=".42" transform="rotate(-28 36 30)" />
        <circle cx="66" cy="70" r="16" fill={c.light} opacity=".22" />
      </motion.g>
      {drops.map(([dx, dy, r], i) => (
        <motion.circle key={i} cx={dx} cy={dy} r={r} fill={c.main} stroke={INK} strokeWidth="1.6" style={CENTER} initial={fresh ? { scale: 0 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 700, damping: 18, delay: fresh ? 0.05 + i * 0.02 : 0 }} />
      ))}
    </g>
  )
}
