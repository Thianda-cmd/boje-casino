import { memo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { MILESTONES, fmtCash, type Milestone, type Save } from './engine'
import { MILESTONE_COINS, milestoneProgress } from './words'

/*
  The Milestones tab: one-time goals that pay real coins (into the wallet, through tycoonCollect: each exactly
  once). Ready ones come first with a Claim (and Claim all when there are several), then the ones under way, nearest
  first, each with how far along it is; the ones paid fold away underneath. (Drawn again only when one of those
  changes: the page draws a few times a second.)
*/

/** the coins-per-milestone badge */
const Pay = ({ n, on }: { n: number; on: boolean }) => (
  <span className={`tnum flex shrink-0 items-center gap-1 text-[13px] font-black ${on ? 'text-gold' : 'text-muted'}`}>
    {n.toLocaleString('en-US')} <Coin size={14} />
  </span>
)

/** how far a milestone under way is, 0..1 (a Cash goal counts in orders of magnitude, so a trillion isn't "0%" for weeks) */
function fraction(m: Milestone, s: Save) {
  const p = milestoneProgress(m, s)
  const f = p.cash ? Math.log10(1 + p.have) / Math.log10(1 + p.need) : p.have / p.need
  return Math.max(0, Math.min(0.999, f))
}

/** what the tab shows of a save: each milestone paid, ready, or how far along (in 2% steps) */
const shown = (s: Save) => MILESTONES.map((m) => (s.milestones.includes(m.id) ? 'p' : m.done(s) ? 'r' : Math.round(fraction(m, s) * 50))).join()

export const MilestonesTab = memo(function MilestonesTab({ s, onClaim, onClaimAll }: { s: Save; onClaim: (id: string, x: number, y: number) => void; onClaimAll: (x: number, y: number) => void }) {
  const [showDone, setShowDone] = useState(false)
  const all = useRef<HTMLButtonElement>(null)
  const ready = MILESTONES.filter((m) => !s.milestones.includes(m.id) && m.done(s))
  const going = MILESTONES.filter((m) => !s.milestones.includes(m.id) && !m.done(s))
    .map((m) => ({ m, p: milestoneProgress(m, s), f: fraction(m, s) }))
    .sort((a, b) => b.f - a.f)
  const done = MILESTONES.filter((m) => s.milestones.includes(m.id))
  const paid = done.reduce((a, m) => a + m.coins, 0)
  const waiting = ready.reduce((a, m) => a + m.coins, 0)
  const at = (el: Element | null) => {
    const r = el?.getBoundingClientRect()
    return r ? ([r.left + r.width / 2, r.top + r.height / 2] as const) : ([innerWidth / 2, innerHeight / 2] as const)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-xl bg-gold/[.07] px-3 py-2.5 ring-1 ring-gold/20">
        <div className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-muted">
          One-time goals that pay <b className="text-white">real coins</b>.{' '}
          <span className="tnum">
            {done.length} of {MILESTONES.length} done · {paid.toLocaleString('en-US')} of {MILESTONE_COINS.toLocaleString('en-US')}
          </span>{' '}
          <Coin size={12} className="inline align-[-2px]" />
        </div>
        {ready.length > 1 && (
          <motion.button
            ref={all}
            whileTap={{ scale: 0.95 }}
            onClick={() => onClaimAll(...at(all.current))}
            className="relative h-9 shrink-0 overflow-hidden rounded-lg bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] px-3 text-[12.5px] font-black text-[#3a2400] shadow-[inset_0_-2px_0_rgba(0,0,0,.14)]"
          >
            <span className="ty-motion pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/45" style={{ animation: 'ty-shine 2.4s ease-in-out infinite' }} />
            <span className="tnum relative">Claim all · {waiting.toLocaleString('en-US')}</span>
          </motion.button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {ready.map((m) => (
          <Ready key={m.id} m={m} list={ready.length} onClaim={(el) => onClaim(m.id, ...at(el))} />
        ))}
      </AnimatePresence>

      {going.map(({ m, p, f }) => (
        <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-panel2 p-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13.5px] font-extrabold text-ink">{m.name}</span>
              <Pay n={m.coins} on={false} />
            </div>
            <div className="truncate text-[12px] text-dim">{m.text}</div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/40">
                <div className="h-full origin-left rounded-full bg-gold/70 transition-transform duration-500" style={{ transform: `scaleX(${Math.max(0.02, f)})` }} />
              </div>
              <span className="tnum shrink-0 text-[11px] font-bold text-muted">{p.cash ? `${fmtCash(p.have)} / ${fmtCash(p.need)}` : `${Math.min(p.have, p.need).toLocaleString('en-US')} / ${p.need.toLocaleString('en-US')}`}</span>
            </div>
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <div className="mt-1">
          <button onClick={() => setShowDone((o) => !o)} className="flex w-full items-center justify-between rounded-xl px-1 py-1.5 text-[12px] font-extrabold uppercase tracking-wider text-dim hover:text-muted">
            Paid · {done.length}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className={`transition-transform ${showDone ? 'rotate-180' : ''}`} aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {showDone && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="flex flex-col gap-1 pt-1">
                  {done.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[.03] px-3 py-2 text-[12.5px]">
                      <span className="flex min-w-0 items-center gap-2 font-bold text-muted">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d36f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="m5 12.5 4.5 4.5L19 7.5" />
                        </svg>
                        <span className="truncate">{m.name}</span>
                      </span>
                      <Pay n={m.coins} on={false} />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}, (a, b) => a.onClaim === b.onClaim && a.onClaimAll === b.onClaimAll && shown(a.s) === shown(b.s))

/** a milestone reached and waiting: gold, with its Claim */
function Ready({ m, list, onClaim }: { m: Milestone; /** how many are ready: the rows close up when it changes */ list: number; onClaim: (el: Element | null) => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <motion.div
      layout="position"
      layoutDependency={list}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.22 } }}
      className="flex items-center gap-3 rounded-2xl p-2.5 shadow-[inset_0_0_0_1.5px_rgba(247,197,72,.6),0_10px_26px_-16px_rgba(247,197,72,.8)]"
      style={{ background: 'linear-gradient(120deg, rgba(247,197,72,.16), rgba(247,197,72,.05))' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-extrabold leading-tight text-ink">{m.name}</span>
          <span className="shrink-0 rounded-full bg-gold px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-[#3a2400] max-sm:hidden">Ready</span>
        </div>
        <div className="text-[12px] leading-snug text-muted">{m.text}</div>
      </div>
      <motion.button
        ref={btn}
        whileTap={{ scale: 0.95 }}
        onClick={() => onClaim(btn.current)}
        className="relative flex h-10 shrink-0 items-center gap-1.5 overflow-hidden rounded-xl bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] px-3.5 text-[13px] font-black text-[#3a2400] shadow-[0_8px_20px_-10px_rgba(247,197,72,.9),inset_0_-2px_0_rgba(0,0,0,.14)] hover:brightness-105"
      >
        <span className="ty-motion pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/45" style={{ animation: 'ty-shine 2.4s ease-in-out infinite' }} />
        <span className="relative">Claim</span>
        <span className="tnum relative flex items-center gap-1">
          {m.coins.toLocaleString('en-US')} <Coin size={14} />
        </span>
      </motion.button>
    </motion.div>
  )
}
