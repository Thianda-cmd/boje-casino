import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { COL, FONT, GOLD, INK, Sym, starPath } from './art'
import { MACHINE_W, REELS_H } from './layout'
import { STEPS } from './Ladder'

/*
  The plates Lucky Lines lays over its machine (design space): the extra-spin decision (with its hints read off the
  card) and the result, both over the reels once they have done their work; the reels' own plate (the spins counter
  and what the card pays, which before a first game says what Play does and while a joker waits says where it
  goes); the shouts over the card's letters (a line, a joker, a free spin, the welcome back); and the big win's
  rolling amount. Toon style throughout: white cards and pills with ink edges and a hard shadow.
*/

const card = 'absolute left-0 top-0 rounded-[24px] border-[4px] bg-white'
const cardStyle = { width: MACHINE_W, height: REELS_H, borderColor: INK, boxShadow: '0 8px 0 rgba(29,15,48,.45)' }
const enter = { initial: { opacity: 0, y: 18, scale: 0.96 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.16 } }, transition: { type: 'spring', stiffness: 420, damping: 30 } } as const

function Chip({ children, tone = 'soft' }: { children: ReactNode; tone?: 'soft' | 'gold' }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 px-2.5 py-[3px] text-[12.5px] font-extrabold leading-none ${tone === 'gold' ? 'bg-[#fff1b8]' : 'bg-[#f1ebff]'}`} style={{ borderColor: INK, color: INK }}>
      {children}
    </span>
  )
}

function BigButton({
  children,
  sub,
  tone,
  disabled,
  onClick,
  label,
  h,
  kbd,
  armed,
}: {
  children: ReactNode
  sub?: ReactNode
  tone: 'violet' | 'gold'
  disabled?: boolean
  onClick: () => void
  label: string
  h: number
  kbd?: string
  armed?: boolean
}) {
  const bg = tone === 'gold' ? `linear-gradient(180deg,#fff3a8,${GOLD} 50%,#f0a21c)` : armed ? 'linear-gradient(180deg,#c9a8ff,#9a6af8 55%,#7a45e6)' : 'linear-gradient(180deg,#b28aff,#8452f0 55%,#6430d6)'
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.96, y: 3 }}
      whileHover={disabled ? undefined : { y: -1 }}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-[16px] border-[3px] px-3 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        height: h,
        borderColor: INK,
        background: bg,
        boxShadow: disabled ? 'none' : `0 5px 0 rgba(29,15,48,.55), inset 0 2px 0 rgba(255,255,255,.45)${armed ? `, 0 0 0 4px #fff, 0 0 0 7px ${INK}` : ''}`,
        color: tone === 'gold' ? INK : '#fff',
        fontFamily: FONT,
      }}
    >
      {kbd && (
        <kbd className="absolute bottom-1.5 right-1.5 rounded-[5px] border-[1.5px] px-[5px] py-px text-[10px] font-black leading-none opacity-70" style={{ borderColor: 'currentColor', fontFamily: FONT }}>
          {kbd}
        </kbd>
      )}
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[18px] font-black leading-none" style={tone === 'violet' ? { textShadow: `0 2px 0 ${INK}` } : undefined}>
        {children}
      </span>
      {sub && <span className="mt-1 whitespace-nowrap text-[11.5px] font-extrabold leading-none opacity-85">{sub}</span>}
    </motion.button>
  )
}

/** the decision once the paid-up spins are spent: an extra spin at its price, or collect */
export function ExtrasPlate({
  price,
  floor,
  collect,
  left,
  max,
  hints,
  afford,
  armed,
  keys,
  touch,
  btnH,
  onBuy,
  onCollect,
}: {
  price: number | null
  /** the price is the floor (1% of the bet), not what the spin is worth */
  floor: boolean
  collect: number
  left: number
  max: number
  hints: string[]
  afford: boolean
  /** a dear spin was pressed once: the next press buys it */
  armed: boolean
  /** show the keys on the buttons */
  keys: boolean
  touch: boolean
  /** the buttons' height (design px): taller on a phone, so they stay a thumb high */
  btnH: number
  onBuy: () => void
  onCollect: () => void
}) {
  const none = left <= 0
  const buySub = price == null ? 'Working out the price…' : !afford ? 'Not enough coins' : armed ? `${touch ? 'Tap' : 'Click'} again to buy` : floor ? 'minimum price' : '97% back on average'
  return (
    <motion.div className={card} style={cardStyle} {...enter}>
      <div className="flex h-full flex-col justify-between px-4 pb-3.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[19px] font-black leading-none tracking-tight" style={{ color: INK, fontFamily: FONT }}>
            {none ? 'No extra spins left' : 'Buy an extra spin?'}
          </div>
          <Chip>
            {left} of {max} extras left
          </Chip>
        </div>
        <div className="flex min-h-[22px] flex-wrap items-center gap-1.5">
          {hints.map((h, i) => (
            <Chip key={h} tone={i === 0 ? 'gold' : 'soft'}>
              {h}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2.5">
          {!none && (
            <BigButton
              tone="violet"
              h={btnH}
              kbd={keys ? 'E' : undefined}
              armed={armed}
              disabled={price == null || !afford}
              onClick={onBuy}
              label={price == null ? 'Extra spin, working out the price' : armed ? `Buy an extra spin for ${fmt(price)}: press again to confirm` : `Buy an extra spin for ${fmt(price)}`}
              sub={buySub}
            >
              Extra spin
              {price != null && (
                <span className="tnum flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[16px]">
                  {fmt(price)} <Coin size={15} />
                </span>
              )}
            </BigButton>
          )}
          <BigButton tone="gold" h={btnH} kbd={keys ? 'C' : undefined} onClick={onCollect} label={`Collect ${fmt(collect)}`} sub={collect > 0 ? 'end the game and take it' : 'end the game'}>
            Collect
            <span className="tnum flex items-center gap-1 rounded-full bg-white/60 px-2 py-0.5 text-[16px]">
              {fmt(collect)} <Coin size={15} />
            </span>
          </BigButton>
        </div>
      </div>
    </motion.div>
  )
}

export interface Result {
  lines: number
  mult: number
  payout: number
  staked: number
  extras: number
  free: number
}

/** the finished game: lines, the step it reached and what it paid */
export function ResultPlate({ r }: { r: Result }) {
  const won = r.payout > 0
  return (
    <motion.div className={card} style={cardStyle} {...enter}>
      <div className="flex h-full items-center gap-4 px-5">
        <div className="flex h-[92px] w-[92px] shrink-0 flex-col items-center justify-center rounded-[22px] border-[3px]" style={{ borderColor: INK, background: won ? `linear-gradient(180deg,#fff3a8,${GOLD} 55%,#f0a21c)` : '#efe8fb', boxShadow: '0 4px 0 rgba(29,15,48,.35)' }}>
          <div className="tnum text-[40px] font-black leading-none" style={{ color: INK, fontFamily: FONT }}>
            {r.lines}
          </div>
          <div className="text-[12px] font-black uppercase tracking-wider" style={{ color: INK }}>
            {r.lines === 1 ? 'line' : 'lines'}
          </div>
        </div>
        <div className="min-w-0 flex-1" style={{ color: INK, fontFamily: FONT }}>
          <div className="text-[13px] font-extrabold uppercase tracking-[.1em] opacity-60">{won ? (r.lines === 12 ? 'Full card!' : 'You collected') : 'Game over'}</div>
          {won ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="tnum rounded-full border-[3px] px-2.5 py-0.5 text-[20px] font-black leading-none" style={{ borderColor: INK, background: '#efe6ff' }}>
                {r.mult}×
              </span>
              <span className="tnum flex items-center gap-1.5 text-[30px] font-black leading-none tracking-tight">
                {fmt(r.payout)} <Coin size={26} />
              </span>
            </div>
          ) : (
            <div className="mt-1 text-[22px] font-black leading-tight">{r.lines === 0 ? 'No lines this time' : 'One line, no prize this time'}</div>
          )}
          <div className="mt-1.5 text-[12.5px] font-bold opacity-60">
            {r.extras > 0 ? `${r.extras} extra ${r.extras === 1 ? 'spin' : 'spins'} · staked ${fmt(r.staked)}` : r.free > 0 ? `${r.free} free ${r.free === 1 ? 'spin' : 'spins'} won` : `Staked ${fmt(r.staked)}`} · Play for a new card
          </div>
        </div>
      </div>
    </motion.div>
  )
}

const pill = 'pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-full border-[2.5px] bg-white font-black leading-none'
const pillStyle = { borderColor: INK, color: INK, fontFamily: FONT, boxShadow: '0 3px 0 rgba(29,15,48,.5)' }
const pop = { initial: { opacity: 0, y: 6, scale: 0.9 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, scale: 0.95, transition: { duration: 0.12 } }, transition: { type: 'spring', stiffness: 520, damping: 26 } } as const

/** the reels' plate before a first game: what Play does, in one breath */
export function IntroNote({ u, bet }: { u: string; bet: string }) {
  return (
    <motion.div key="intro" className={`${pill} mx-auto h-[30px] py-0 pl-1 pr-3.5 text-[14.5px]`} style={pillStyle} {...pop}>
      <Sym u={u} s={{ kind: 'joker' }} col={0} size={26} />
      Play: 10 spins for {bet}, make lines, climb to
      <span className="rounded-md px-1.5 py-[3px]" style={{ background: GOLD }}>
        500×
      </span>
    </motion.div>
  )
}

/** the reels' plate while a joker waits: where it goes, and the key that places it */
export function JokerNote({ jokers, supers, keys }: { jokers: number[]; supers: number; keys: boolean }) {
  const n = jokers.length + supers
  const c = jokers[0]
  const text = jokers.length ? `Place your Joker in the ${COL[c].letter} column` : 'Super Joker: pick any number'
  return (
    <motion.div className={`${pill} h-[28px] py-0 pl-1 pr-3 text-[13.5px]`} style={pillStyle} {...pop}>
      <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1 text-[11.5px] text-white" style={{ background: jokers.length ? COL[c].main : '#e2a20c', boxShadow: `inset 0 0 0 2px ${INK}` }}>
        {n > 1 ? `×${n}` : jokers.length ? COL[c].letter : '★'}
      </span>
      {text}
      {keys && <span className="text-[11.5px] font-extrabold opacity-50">{jokers.length ? `· press ${c + 1}` : '· click a number'}</span>}
    </motion.div>
  )
}

export type ShoutKind = 'line' | 'free' | 'joker' | 'super' | 'welcome'
export interface Shout {
  id: number
  kind: ShoutKind
  text: string
}

const SHOUT: Record<ShoutKind, { bg: string; ink: boolean }> = {
  line: { bg: `linear-gradient(180deg,#fff6b0,${GOLD} 50%,#f2a51e)`, ink: true },
  // the Super Joker's gold runs deeper, toward orange, like his ball
  super: { bg: 'linear-gradient(180deg,#fff8cf,#ffcf3a 45%,#e8860a)', ink: true },
  free: { bg: 'linear-gradient(180deg,#c9fff6,#4fe6d2 50%,#16a99c)', ink: true },
  joker: { bg: 'linear-gradient(180deg,#c9a8ff,#8452f0 55%,#6430d6)', ink: false },
  welcome: { bg: '#fff', ink: true },
}

/** the shout over the card's letters: a line, a joker, a free spin, or the welcome back */
export function ShoutLayer({ shout }: { shout: Shout | null }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[5px] z-30 flex justify-center">
      <AnimatePresence mode="popLayout">
        {shout && (
          <motion.div
            key={shout.id}
            initial={shout.kind === 'welcome' ? { opacity: 0, y: -10, scale: 0.9 } : { opacity: 0, scale: 0.4, rotate: -8 }}
            animate={shout.kind === 'welcome' ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, scale: 1, rotate: -3 }}
            exit={{ opacity: 0, scale: shout.kind === 'welcome' ? 0.95 : 1.12, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 520, damping: shout.kind === 'welcome' ? 26 : 15 }}
            className={`flex items-center gap-2 whitespace-nowrap rounded-full border-[4px] font-black ${shout.kind === 'welcome' ? 'mt-[8px] px-5 py-1.5 text-[17px]' : 'px-6 py-1 text-[32px] uppercase italic tracking-tight'}`}
            style={{
              fontFamily: FONT,
              borderColor: INK,
              background: SHOUT[shout.kind].bg,
              color: SHOUT[shout.kind].ink ? INK : '#fff',
              textShadow: SHOUT[shout.kind].ink ? '0 2px 0 rgba(255,255,255,.55)' : `0 3px 0 ${INK}`,
              boxShadow: '0 6px 0 rgba(29,15,48,.5)',
            }}
          >
            {shout.kind !== 'welcome' && <Star />}
            {shout.text}
            {shout.kind !== 'welcome' && <Star />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const Star = () => (
  <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden className="shrink-0 not-italic">
    <path d={starPath(10, 10.5, 9)} fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
  </svg>
)

/**
 * The reels' plate: a pip a paid-up spin (gold tickets for the free ones) or the extras bought, and what the card
 * pays now. `note` takes the pips' place (a joker waiting); `intro` takes the whole plate (before a first game).
 */
export function SpinsPlate({ base, free, left, extras, extraMax, pays, bet, note, intro }: { base: number; free: number; left: number; extras: number; extraMax: number; pays: number; bet: number; note?: ReactNode; intro?: ReactNode }) {
  const total = base + free
  // a long run of free spins packs the pips tighter, so they never reach the Pays chip
  const tight = total > 15
  const used = total - left
  const extra = left === 0 && extras > 0
  if (intro) return <div className="flex w-full items-center justify-center">{intro}</div>
  return (
    <div className="flex w-full items-center justify-between gap-3 text-white" style={{ fontFamily: FONT }}>
      <AnimatePresence mode="wait" initial={false}>
        {note ?? (
          <motion.div key="pips" className="flex min-w-0 items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            <span className="text-[12px] font-black uppercase tracking-[.14em] opacity-80">{extra ? 'Extra' : 'Spins'}</span>
            {extra ? (
              <span className="tnum text-[15px] font-black">
                {extras} / {extraMax}
              </span>
            ) : (
              <div className="flex min-w-0 items-center overflow-hidden" style={{ gap: tight ? 2 : 4 }}>
                {Array.from({ length: total }, (_, i) => {
                  const on = i >= used
                  const isFree = i >= base
                  return (
                    <motion.span
                      key={i}
                      initial={isFree ? { scale: 0 } : false}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 15 }}
                      className="block border-2"
                      style={{
                        width: isFree ? (tight ? 11 : 15) : tight ? 8 : 11,
                        height: tight ? 9 : 11,
                        borderRadius: isFree ? 3 : 99,
                        borderColor: INK,
                        background: on ? (isFree ? '#5ff0dc' : GOLD) : 'rgba(29,15,48,.45)',
                        boxShadow: on ? 'inset 0 -2px 0 rgba(0,0,0,.18)' : 'none',
                      }}
                    />
                  )
                })}
                <span className="tnum ml-1 text-[13px] font-black opacity-90">{left}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex shrink-0 items-center gap-1.5 text-[13px] font-black">
        <span className="uppercase tracking-[.12em] opacity-70">Pays</span>
        <span className="tnum flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: pays > 0 ? GOLD : 'rgba(29,15,48,.45)', color: pays > 0 ? INK : '#fff', boxShadow: `inset 0 0 0 2px ${INK}` }}>
          {fmt(pays * bet)} <Coin size={13} />
        </span>
      </div>
    </div>
  )
}

/** the hints on the decision card, worked out from the card: how close it is, and what the next step pays */
export function extraHints(marks: readonly boolean[], lines: number, linesNeed: number[]): string[] {
  const out: string[] = []
  const one = linesNeed.filter((n) => n === 1).length
  const two = linesNeed.filter((n) => n === 2).length
  if (one) out.push(`${one} ${one === 1 ? 'line is' : 'lines are'} 1 number away`)
  else if (two) out.push(`${two} ${two === 1 ? 'line is' : 'lines are'} 2 numbers away`)
  const next = STEPS.find((s) => s.lines > lines)
  if (next && marks.some((m) => !m)) out.push(`${next.lines === 12 ? 'Full card' : `${next.lines} lines`} pays ${next.mult}×`)
  return out
}

/** the amount on the big win, rolled up */
export function RollUp({ value, ms, onTick }: { value: number; ms: number; onTick?: () => void }) {
  const el = useRef<HTMLSpanElement>(null)
  const tick = useRef(onTick)
  tick.current = onTick
  useEffect(() => {
    let last = -1
    const c = animate(0, value, {
      duration: ms / 1000,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (v) => {
        if (el.current) el.current.textContent = fmt(v)
        const step = Math.floor((v / Math.max(value, 0.01)) * 24)
        if (step !== last) {
          last = step
          tick.current?.()
        }
      },
    })
    return c.stop
  }, [value, ms])
  return <span ref={el} className="tnum">{fmt(0)}</span>
}
