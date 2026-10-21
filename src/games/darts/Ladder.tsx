import { memo } from 'react'
import { motion } from 'framer-motion'
import type { Throwing } from './rules'
import { chanceText, multText } from './table'

/*
  The paytable ladder beside the board: its steps (table.ts) from the top step down to par, each with what it pays
  and, live, the chance of reaching it from where the round stands. As the darts go in, the rail beside the steps
  fills up to the running total and every step it passes lights up (it is locked in: totals only grow); a step the
  darts left can no longer reach greys out. When the round is in, the step it reached glows.

  Upright beside the board on a wide stage; on a phone a strip of chips across the top, lowest first.
*/

/** a step's colours: under the stake back, at least the stake back, ten times or more */
const tone = (m: number) => (m >= 10 ? 'gold' : m >= 1 ? 'win' : 'part')
const LIT = {
  part: 'bg-[linear-gradient(180deg,#3b5468,#2a4152)] text-ink ring-white/25',
  win: 'bg-[linear-gradient(180deg,#3ff08f,#16b85e)] text-[#032412] ring-[#7dffb3]/60',
  gold: 'bg-[linear-gradient(180deg,#fff0b0,#f7c548_55%,#e09a1f)] text-[#2a1c00] ring-[#fff3c4]/70',
}
const PAY = { part: 'text-muted', win: 'text-accent', gold: 'text-gold' }

interface Props {
  t: Throwing
  steps: number[]
  /** the chance of ending on each total or more, from where the round stands */
  reach: Float64Array
  /** the running total (0 before a dart) */
  total: number
  /** the round is in: its total is final */
  done: boolean
}

export const Ladder = memo(function Ladder({ t, steps, reach, total, done, height, title }: Props & { height: number; title: string }) {
  const rows = [...steps].reverse()
  const n = rows.length
  const head = 46
  const foot = 30
  const gap = 6
  const rowH = Math.max(34, Math.min(56, (height - head - foot - 24 - gap * (n - 1)) / n))
  const listH = n * rowH + (n - 1) * gap
  // the rail: total 0 at its foot, each step at its row's middle, the top step at the top row's middle
  const yOf = (i: number) => i * (rowH + gap) + rowH / 2
  const railY = (s: number) => {
    const asc = steps
    if (s <= 0) return listH
    if (s < asc[0]) return listH - ((listH - yOf(n - 1)) * s) / asc[0]
    for (let i = 0; i < asc.length - 1; i++) {
      if (s < asc[i + 1]) {
        const y0 = yOf(n - 1 - i)
        const y1 = yOf(n - 2 - i)
        return y0 + ((y1 - y0) * (s - asc[i])) / (asc[i + 1] - asc[i])
      }
    }
    return yOf(0)
  }
  const reached = steps.filter((s) => total >= s)
  const best = reached.length ? reached[reached.length - 1] : -1
  const fillY = railY(total)
  return (
    <div className="flex flex-col rounded-2xl bg-[#08121b]/80 px-3 pb-2.5 pt-3 ring-1 ring-white/[.07] backdrop-blur-sm">
      <div className="mb-2.5 px-0.5" style={{ height: head - 10 }}>
        <div className="whitespace-nowrap text-[10.5px] font-black uppercase tracking-[0.16em] text-white/55">Pays on the total</div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[12.5px] font-extrabold text-white/85">{title}</span>
          <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.1em] text-white/35">chance</span>
        </div>
      </div>
      <div className="relative flex gap-1" style={{ height: listH }}>
        {/* the rail and its fill up to the running total, the total riding on top */}
        <div className="relative w-[28px] shrink-0">
          <div className="absolute inset-y-0 left-1/2 w-[6px] -translate-x-1/2 rounded-full bg-white/[.07]" />
          <motion.div
            className="absolute bottom-0 left-1/2 w-[6px] -translate-x-1/2 rounded-full bg-[linear-gradient(0deg,#16b85e,#3ff08f)] shadow-[0_0_12px_rgba(46,232,127,.55)]"
            initial={false}
            animate={{ height: Math.max(0, listH - fillY) }}
            transition={{ type: 'spring', stiffness: 160, damping: 22 }}
          />
          <motion.div
            className="tnum absolute left-1/2 z-10 flex h-[22px] min-w-[28px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white px-1 text-[11.5px] font-black text-[#0a1620] shadow-[0_3px_10px_rgba(0,0,0,.5)]"
            initial={false}
            animate={{ top: fillY, opacity: total > 0 ? 1 : 0 }}
            transition={{ type: 'spring', stiffness: 160, damping: 22 }}
          >
            {total}
          </motion.div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col" style={{ gap }}>
          {rows.map((s) => {
            const m = t.pays[s]
            const k = tone(m)
            const lit = total >= s
            const p = reach[s]
            const gone = !lit && p <= 0
            const won = done && s === best
            return (
              <motion.div
                key={s}
                layout="position"
                className={`relative flex items-center gap-1.5 overflow-hidden rounded-xl px-2 ring-1 transition-[background,opacity,box-shadow] duration-300 ${lit ? LIT[k] : 'bg-white/[.045] text-ink ring-white/[.06]'} ${gone ? 'opacity-35' : ''}`}
                style={{ height: rowH }}
                animate={won ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                transition={won ? { duration: 0.6, repeat: 2 } : { duration: 0.2 }}
              >
                {won && <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/25" />}
                <div className="tnum w-[38px] shrink-0 text-[15px] font-black leading-none">
                  {s}
                  {s < t.top && <span className="text-[11px] opacity-70">+</span>}
                </div>
                <div className={`tnum min-w-0 flex-1 text-right text-[15px] font-black leading-none ${lit ? '' : PAY[k]}`}>{multText(m)}</div>
                <div className={`tnum flex w-[47px] shrink-0 justify-end whitespace-nowrap text-right text-[10px] font-bold leading-none ${lit ? 'opacity-80' : 'text-white/45'}`}>{lit ? <Check /> : gone ? 'out' : chanceText(p)}</div>
              </motion.div>
            )
          })}
        </div>
      </div>
      <div className="flex items-center justify-between px-0.5 pt-2.5 text-[10.5px] font-bold text-white/45" style={{ height: foot - 4 }}>
        <span>Par {t.par}</span>
        <span>Return {(t.rtp * 100).toFixed(2)}%</span>
      </div>
    </div>
  )
})

/** a step locked in */
function Check({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-label="locked in">
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  )
}

/** the ladder as a strip of chips, lowest step first (phones) */
export const LadderStrip = memo(function LadderStrip({ t, steps, reach, total, done }: Props) {
  const reached = steps.filter((s) => total >= s)
  const best = reached.length ? reached[reached.length - 1] : -1
  return (
    <div className="flex gap-1">
      {steps.map((s) => {
        const m = t.pays[s]
        const k = tone(m)
        const lit = total >= s
        const p = reach[s]
        const gone = !lit && p <= 0
        const won = done && s === best
        return (
          <motion.div
            key={s}
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-lg py-1 ring-1 transition-[background,opacity] duration-300 ${lit ? LIT[k] : 'bg-[#08121b]/85 text-ink ring-white/[.08]'} ${gone ? 'opacity-35' : ''}`}
            animate={won ? { scale: [1, 1.1, 1] } : { scale: 1 }}
            transition={won ? { duration: 0.5, repeat: 2 } : { duration: 0.2 }}
          >
            {won && <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/25" />}
            <div className="tnum text-[11.5px] font-black leading-tight">
              {s}
              {s < t.top && <span className="opacity-70">+</span>}
            </div>
            <div className={`tnum text-[12px] font-black leading-tight ${lit ? '' : PAY[k]}`}>{multText(m)}</div>
            <div className={`tnum flex h-[11px] items-center whitespace-nowrap text-[8.5px] font-bold leading-tight ${lit ? 'opacity-80' : 'text-white/45'}`}>{lit ? <Check size={11} /> : gone ? 'out' : chanceText(p)}</div>
          </motion.div>
        )
      })}
    </div>
  )
})
