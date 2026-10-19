import { memo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Chip, chipLabel } from '../../art/Chip'
import { fmt } from '../../lib/format'
import type { BetKey, BetResult } from './rules'
import { GOLD } from './Cards'

/*
  The four betting circles printed on the felt in front of the player: Trips, Ante = Blind, Play. Chips stack in
  them as HTML over the print, so they can drop in, be swept off to the dealer, be paid beside their stake and slide
  back to the player. The Play circle prints the bets it can take (4× and 3× before the flop, 2× on the flop, 1× at
  the river), lit while that choice is up.

  While bets go down, a click or tap on Ante (or Blind, which always matches it) or Trips places the chosen chip; a
  right-click or a long press takes one off. At the end of a hand each circle says what it did: "+25", "Returned" or
  "Lost".
*/

export type Leaving = 'dealer' | 'player'
export type Outcomes = Partial<Record<BetKey, BetResult['outcome']>>

const ORDER: BetKey[] = ['trips', 'ante', 'blind', 'play']
const NAME: Record<BetKey, string> = { trips: 'Trips', ante: 'Ante', blind: 'Blind', play: 'Play' }
/** what each circle prints inside, faintly, while it is empty */
const PRINT: Record<BetKey, string> = { trips: '3 – 50 : 1', ante: '1 : 1', blind: 'to 500 : 1', play: '1 : 1' }
const EASE_IN = [0.5, 0, 0.75, 0] as const

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

function ChipStack({ amount, size }: { amount: number; size: number }) {
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

export interface CirclesProps {
  x: Record<BetKey, number>
  y: number
  d: number
  labelY: number
  small: boolean
  /** the stakes in each circle (the Blind always matches the Ante) */
  stakes: Record<BetKey, number>
  /** winnings paid beside a stake */
  wins: Partial<Record<BetKey, number>>
  outcomes: Outcomes | null
  leaving: Leaving
  /** where lost chips go and winnings come from (stage px) */
  dealer: { x: number; y: number }
  stageH: number
  /** the Play bets that can be made right now (multiples of the ante) */
  options: number[]
  interactive: boolean
  onPlace: (k: BetKey) => void
  onRemove: (k: BetKey) => void
  shake: { key: BetKey; n: number } | null
}

function CirclesView({ x, y, d, labelY, small, stakes, wins, outcomes, leaving, dealer, stageH, options, interactive, onPlace, onRemove, shake }: CirclesProps) {
  const chip = Math.round(d * 0.6)
  const pressTimer = useRef(0)
  const longPress = useRef(false)
  const lastPointer = useRef('mouse')
  const takes = (k: BetKey) => interactive && k !== 'play'

  const onDown = (e: ReactPointerEvent, k: BetKey) => {
    lastPointer.current = e.pointerType
    longPress.current = false
    clearTimeout(pressTimer.current)
    if (e.pointerType !== 'touch' || !takes(k)) return
    // a long press takes a chip off (the click that follows is swallowed)
    pressTimer.current = window.setTimeout(() => {
      longPress.current = true
      onRemove(k)
      navigator.vibrate?.(12)
    }, 450)
  }
  const cancel = () => clearTimeout(pressTimer.current)

  return (
    <>
      {/* the print: rings, names, the equals sign between Ante and Blind */}
      {ORDER.map((k) => {
        const cx = x[k]
        const o = outcomes?.[k]
        const empty = !stakes[k] && !wins[k]
        const isPlay = k === 'play'
        return (
          <motion.button
            key={`${k}${shake?.key === k ? shake.n : ''}`}
            type="button"
            tabIndex={takes(k) ? 0 : -1}
            aria-label={`${NAME[k]}${stakes[k] ? `, ${fmt(stakes[k])} on it` : ''}${takes(k) ? (k === 'blind' ? ', matches the Ante: click to add a chip to both' : ', click to add a chip') : ''}`}
            className={`group absolute rounded-full outline-none ${takes(k) ? 'cursor-pointer' : 'cursor-default'}`}
            style={{ left: cx - d / 2, top: y - d / 2, width: d, height: d }}
            onClick={() => {
              if (longPress.current) return void (longPress.current = false)
              if (takes(k)) onPlace(k)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              if (lastPointer.current !== 'touch' && takes(k)) onRemove(k)
            }}
            onPointerDown={(e) => onDown(e, k)}
            onPointerUp={cancel}
            onPointerCancel={cancel}
            onPointerLeave={cancel}
            animate={shake?.key === k ? { x: [0, -6, 5, -3, 2, 0] } : { x: 0 }}
            transition={{ duration: 0.36 }}
          >
            <span
              className="absolute inset-0 rounded-full transition-[box-shadow,background] duration-300"
              style={{
                background: o === 'win' ? 'radial-gradient(circle, rgba(255,225,130,.22), rgba(255,200,80,.06) 70%)' : 'radial-gradient(circle, rgba(140,170,255,.07), rgba(0,0,0,.12) 72%)',
                boxShadow:
                  o === 'win'
                    ? `0 0 0 2.5px #ffe28a, 0 0 24px 2px rgba(255,212,92,.55), inset 0 0 18px rgba(255,212,92,.25)`
                    : `0 0 0 ${small ? 1.5 : 2}px rgba(247,197,72,${o === 'lose' ? 0.3 : 0.72}), inset 0 0 0 ${small ? 4 : 5}px rgba(5,12,34,.35), inset 0 0 0 ${small ? 5 : 6.5}px rgba(247,197,72,.28)`,
              }}
            />
            {takes(k) && <span className="absolute inset-0 rounded-full bg-white opacity-0 transition-opacity duration-150 group-hover:opacity-[.07] group-focus-visible:opacity-[.1]" />}
            {/* the circle's own print while it is empty */}
            <span
              className={`absolute inset-0 flex flex-col items-center justify-center font-black transition-opacity duration-300 ${empty ? 'opacity-100' : 'opacity-0'}`}
              style={{ color: GOLD }}
            >
              {isPlay ? (
                <PlayOptions options={options} small={small} />
              ) : (
                <span className={`tnum whitespace-nowrap opacity-70 ${small ? 'text-[8.5px]' : 'text-[10.5px]'}`}>{PRINT[k]}</span>
              )}
            </span>
          </motion.button>
        )
      })}
      {/* Ante = Blind */}
      <span
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 font-black"
        style={{ left: (x.ante + x.blind) / 2, top: y, color: GOLD, opacity: 0.75, fontSize: small ? 15 : 20 }}
      >
        =
      </span>

      {/* the names under the circles, or what each did at the end of the hand */}
      {ORDER.map((k) => {
        const o = outcomes?.[k]
        // a win's tag arrives with its winnings
        const won = wins[k]
        const tag = o === 'win' ? (won ? `+${fmt(won, won % 1 ? 2 : 0)}` : null) : o === 'push' && stakes[k] ? 'Returned' : o === 'lose' ? 'Lost' : null
        return (
          <div key={k} className="pointer-events-none absolute flex -translate-x-1/2 justify-center" style={{ left: x[k], top: labelY, width: d * 1.5 }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {tag ? (
                <motion.span
                  key={`t${tag}`}
                  className={`tnum whitespace-nowrap rounded-full font-black leading-none ${small ? 'px-1.5 py-[3px] text-[10.5px]' : 'px-2.5 py-1 text-[12.5px]'}`}
                  style={
                    o === 'win'
                      ? { background: 'linear-gradient(180deg,#fff3c4,#ffd45c 60%,#f0a52a)', color: '#2a1600', boxShadow: '0 2px 8px rgba(0,0,0,.5)' }
                      : o === 'push'
                        ? { background: 'rgba(255,255,255,.9)', color: '#0b1730' }
                        : { background: 'rgba(3,8,24,.7)', color: 'rgba(255,255,255,.5)' }
                  }
                  initial={{ opacity: 0, scale: 0.6, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', stiffness: 480, damping: 22 }}
                >
                  {tag}
                </motion.span>
              ) : (
                <motion.span
                  key="name"
                  className={`whitespace-nowrap font-black uppercase ${small ? 'text-[10px] tracking-[.14em]' : 'text-[12px] tracking-[.2em]'}`}
                  style={{ color: GOLD }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.9 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                >
                  {NAME[k]}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        )
      })}

      {/* the chips: over the cards, so winnings slid in from the dealer pass above the player's hand */}
      <div className="pointer-events-none absolute inset-0 z-[5]">
        <AnimatePresence custom={leaving}>
          {ORDER.flatMap((k) => {
            const ax = x[k]
            const toDealer = { x: dealer.x - ax, y: dealer.y - y }
            const out = (to: Leaving) =>
              to === 'dealer'
                ? { ...toDealer, opacity: 0, scale: 0.6, transition: { duration: 0.46, ease: EASE_IN, opacity: { duration: 0.46, ease: [0.7, 0, 1, 0.4] } } }
                : { y: stageH - y + chip, opacity: 0, transition: { duration: 0.5, ease: EASE_IN } }
            const items = []
            const stake = stakes[k]
            const win = wins[k]
            if (stake)
              items.push(
                <motion.div
                  key={k}
                  className="absolute"
                  style={{ left: ax - chip / 2, top: y - chip / 2 }}
                  // the Play bet is pushed out from the player's side; the rest drop in
                  initial={k === 'play' ? { opacity: 0, y: d * 1.1, scale: 0.9 } : { opacity: 0, scale: 0.6, y: -12 }}
                  animate={{ opacity: 1, scale: 1, x: win ? -chip * 0.3 : 0, y: 0 }}
                  exit="out"
                  variants={{ out }}
                  transition={k === 'play' ? { duration: 0.42, ease: [0.16, 1, 0.3, 1] } : { type: 'spring', stiffness: 520, damping: 28 }}
                >
                  <ChipStack amount={stake} size={chip} />
                </motion.div>,
              )
            if (win)
              items.push(
                <motion.div
                  key={`${k}-win`}
                  className="absolute"
                  style={{ left: ax - chip / 2, top: y - chip / 2 }}
                  initial={{ ...toDealer, opacity: 0, scale: 0.7 }}
                  animate={{ x: chip * 0.3, y: 0, opacity: 1, scale: 1 }}
                  exit="out"
                  variants={{ out }}
                  transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.18 } }}
                >
                  <ChipStack amount={win} size={chip} />
                </motion.div>,
              )
            return items
          })}
        </AnimatePresence>
      </div>
    </>
  )
}

/** The Play circle's print: the four bets it can take, the ones open now lit */
function PlayOptions({ options, small }: { options: number[]; small: boolean }) {
  const all = [4, 3, 2, 1]
  const live = options.length > 0
  return (
    <span className={`grid grid-cols-2 ${small ? 'gap-x-1 gap-y-0' : 'gap-x-1.5 gap-y-0.5'}`}>
      {all.map((m) => {
        const on = options.includes(m)
        return (
          <motion.span
            key={m}
            className={`tnum rounded-[5px] text-center leading-none ${small ? 'px-[3px] py-[2px] text-[10px]' : 'px-1 py-[3px] text-[12px]'}`}
            initial={false}
            animate={{ opacity: on ? 1 : live ? 0.28 : 0.6, scale: on ? 1.08 : 1 }}
            style={on ? { background: GOLD, color: '#1d1200', boxShadow: '0 0 12px rgba(247,197,72,.55)' } : { color: GOLD }}
          >
            {m}×
          </motion.span>
        )
      })}
    </span>
  )
}

export const Circles = memo(CirclesView)
