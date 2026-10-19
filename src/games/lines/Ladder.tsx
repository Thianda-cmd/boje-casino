import { memo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt, fmtCompact } from '../../lib/format'
import { LADDER_W, MACHINE_H, MACHINE_W, STRIP_H } from './layout'
import { FONT, GOLD, INK, starPath } from './art'
import { LADDER, linesOf } from './rules'

/*
  The prize ladder: what the card pays at the end by lines, read from the rules' LADDER (2 lines up to the full
  card). Beside the machine it is a game-show tower, top prize at the top, each step with its multiple and what it
  pays at the bet; on a phone it is a strip of pills over the card, each with its lines, multiple and coins. The step
  the card stands on now is lit gold (the light springs up as lines land), and the next one says what it still
  needs: "+2 lines", or "1 number" when one number would finish enough lines at once.
*/

export const STEPS = LADDER.flatMap((mult, lines) => (mult > 0 ? [{ lines, mult }] : []))
/** the step `lines` stands on (-1: under the first) */
export const stepOf = (lines: number) => STEPS.reduce((a, s, i) => (lines >= s.lines ? i : a), -1)

/**
 * The fewest numbers that take the card to `target` lines, if that is one or two (0: it takes more). One number can
 * finish two lines at once, so this can be fewer than the lines still needed.
 */
export function numbersTo(marks: readonly boolean[], target: number): number {
  const open = marks.flatMap((m, i) => (m ? [] : [i]))
  const m = marks.slice()
  for (const i of open) {
    m[i] = true
    if (linesOf(m) >= target) return 1
    m[i] = false
  }
  for (let a = 0; a < open.length; a++)
    for (let b = a + 1; b < open.length; b++) {
      m[open[a]] = m[open[b]] = true
      const ok = linesOf(m) >= target
      m[open[a]] = m[open[b]] = false
      if (ok) return 2
    }
  return 0
}

const multText = (m: number) => `${m}×`
const money = (n: number) => (n >= 1e6 ? fmtCompact(n) : fmt(n))
/** the strip's coins, short enough for a pill a phone's thumb wide */
const short = (n: number) => (n >= 1000 ? fmtCompact(n) : n >= 100 ? fmt(n, 0) : fmt(n))

const TITLE = 50
const ROW = (MACHINE_H - TITLE - 14) / STEPS.length
const PILL = (MACHINE_W - 16) / STEPS.length

/** the middle of step i's row, in the ladder's own space */
export function stepXY(mode: 'wide' | 'narrow', i: number) {
  return mode === 'wide' ? { x: LADDER_W / 2, y: TITLE + (STEPS.length - 1 - i) * ROW + ROW / 2 } : { x: 8 + i * PILL + PILL / 2, y: STRIP_H / 2 }
}

export const Ladder = memo(function Ladder({ marks, bet, mode, live }: { marks: readonly boolean[]; bet: number; mode: 'wide' | 'narrow'; live: boolean }) {
  const calm = useReducedMotion()
  const lines = linesOf(marks)
  const at = stepOf(lines)
  // the next step's hint only while a game is on
  const next = live && at + 1 < STEPS.length ? at + 1 : -1
  const need = next >= 0 ? STEPS[next].lines - lines : 0
  const nums = next >= 0 && need > 1 ? numbersTo(marks, STEPS[next].lines) : 0
  const hint = nums > 0 && nums < need ? `${nums} ${nums === 1 ? 'number' : 'numbers'}` : `+${need} ${need === 1 ? 'line' : 'lines'}`
  const spring = { type: 'spring', stiffness: 380, damping: 26 } as const

  if (mode === 'narrow')
    return (
      <div className="absolute left-0 top-0" style={{ width: MACHINE_W, height: STRIP_H }}>
        <div className="absolute inset-0 translate-y-[6px] rounded-[20px]" style={{ background: INK, opacity: 0.45 }} />
        <div className="absolute inset-0 rounded-[20px] border-[4px]" style={{ borderColor: INK, background: 'linear-gradient(180deg,#7a4ae6,#4a1fae)' }} />
        {at >= 0 && (
          <motion.div
            className="absolute rounded-[13px] border-[3px]"
            style={{ top: 8, width: PILL - 4, height: STRIP_H - 16, borderColor: INK, background: `linear-gradient(180deg,#fff3a8,${GOLD} 55%,#f0a21c)`, boxShadow: '0 3px 0 rgba(29,15,48,.5)' }}
            initial={false}
            animate={{ left: 8 + at * PILL + 2 }}
            transition={spring}
          />
        )}
        {STEPS.map((s, i) => {
          const lit = i === at
          const nx = i === next
          const below = i < at
          return (
            <div key={s.lines} className="absolute flex flex-col items-center justify-center" style={{ left: 8 + i * PILL, top: 8, width: PILL, height: STRIP_H - 16 }}>
              {nx && <div className="absolute inset-[2px] rounded-[13px] border-[2.5px] border-dashed border-white/75 bg-white/[.08]" />}
              <div className="relative text-[15px] font-black leading-none" style={{ color: lit ? INK : 'rgba(255,255,255,.7)', fontFamily: FONT }}>
                {s.lines === 12 ? 'FULL' : s.lines}
              </div>
              <motion.div
                key={lit ? 'lit' : 'off'}
                initial={lit ? { scale: 1.35 } : false}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                className="tnum relative mt-[4px] font-black leading-none tracking-[-.04em]"
                // "0.75×" is a character longer than the rest: a size down keeps it inside its pill
                style={{ fontSize: multText(s.mult).length > 4 ? 16 : 19, color: lit ? INK : below ? 'rgba(255,255,255,.55)' : '#fff', fontFamily: FONT }}
              >
                {multText(s.mult)}
              </motion.div>
              <div className="tnum relative mt-[5px] text-[13.5px] font-extrabold leading-none tracking-[-.03em]" style={{ color: lit ? 'rgba(29,15,48,.8)' : s.lines === 12 ? GOLD : 'rgba(255,255,255,.62)', fontFamily: FONT }}>
                {short(bet * s.mult)}
              </div>
            </div>
          )
        })}
      </div>
    )

  return (
    <div className="absolute left-0 top-0" style={{ width: LADDER_W, height: MACHINE_H }}>
      <div className="absolute inset-0 translate-y-[8px] rounded-[26px]" style={{ background: INK, opacity: 0.45 }} />
      <div className="absolute inset-0 rounded-[26px] border-[4px]" style={{ borderColor: INK, background: 'linear-gradient(180deg,#7a4ae6 0%,#5a2cc9 45%,#3f189b 100%)' }}>
        <div className="absolute inset-x-6 top-[5px] h-[3px] rounded-full bg-white/35" />
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-1.5" style={{ height: TITLE }}>
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
          <path d={starPath(10, 10.5, 9)} fill={GOLD} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <span className="text-[15px] font-black uppercase tracking-[.12em] text-white" style={{ fontFamily: FONT, textShadow: `0 2px 0 ${INK}` }}>
          Prize ladder
        </span>
      </div>
      {at >= 0 && (
        <motion.div
          className="absolute left-[10px] right-[10px] rounded-[16px] border-[3px]"
          style={{ height: ROW - 8, borderColor: INK, background: `linear-gradient(180deg,#fff5b8,${GOLD} 50%,#f2a51e)`, boxShadow: '0 4px 0 rgba(29,15,48,.5), 0 0 26px rgba(255,210,61,.55)' }}
          initial={false}
          animate={{ top: TITLE + (STEPS.length - 1 - at) * ROW + 4 }}
          transition={spring}
        />
      )}
      {STEPS.map((s, i) => {
        const lit = i === at
        const nx = i === next
        const below = i < at
        const top = s.lines === 12
        return (
          <div key={s.lines} className="absolute left-[10px] right-[10px] flex items-center gap-2.5 pl-2 pr-2" style={{ top: TITLE + (STEPS.length - 1 - i) * ROW + 4, height: ROW - 8 }}>
            {!lit && <div className={`absolute inset-0 rounded-[16px] ${nx ? 'border-[2.5px] border-dashed border-white/70 bg-white/[.07]' : top ? 'border-2 border-[#ffd23d]/60 bg-[#ffd23d]/[.12]' : 'bg-black/[.16]'}`} />}
            <div
              className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-[2.5px] text-[14px] font-black"
              style={{ borderColor: INK, background: lit ? '#fff' : top ? GOLD : below ? '#c9b4ff' : '#efe6ff', color: INK, fontFamily: FONT }}
            >
              {top ? (
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                  <path d={starPath(10, 10.5, 9)} fill={lit ? GOLD : '#fff'} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              ) : (
                s.lines
              )}
            </div>
            <div className="relative min-w-0 flex-1">
              <motion.div
                key={lit ? 'lit' : 'off'}
                initial={lit ? { scale: 1.25, x: -4 } : false}
                animate={{ scale: 1, x: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                className="tnum origin-left text-[21px] font-black leading-none tracking-tight"
                style={{ color: lit ? INK : below ? 'rgba(255,255,255,.6)' : '#fff', fontFamily: FONT, textShadow: lit ? 'none' : `0 2px 0 ${INK}` }}
              >
                {multText(s.mult)}
              </motion.div>
              <div className="tnum mt-1 flex items-center gap-1 text-[11.5px] font-extrabold leading-none" style={{ color: lit ? INK : 'rgba(255,255,255,.62)' }}>
                {money(bet * s.mult)}
                {/* an ink ring keeps the gold coin from melting into the lit gold step */}
                <span className="flex rounded-full" style={lit ? { boxShadow: `0 0 0 1.5px ${INK}` } : undefined}>
                  <Coin size={11} />
                </span>
              </div>
            </div>
            {nx && (
              <motion.div
                className="relative shrink-0 whitespace-nowrap rounded-full border-2 bg-white px-1.5 py-[3px] text-[10px] font-black uppercase leading-none tracking-wide"
                style={{ borderColor: INK, color: INK, fontFamily: FONT }}
                animate={calm ? undefined : { y: [0, -2, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
              >
                {hint}
              </motion.div>
            )}
          </div>
        )
      })}
    </div>
  )
})
