import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DieFace } from './art'
import { describe, oddsWon, sorted, spotOf, type Dice } from './rules'
import type { PastRoll } from './storage'
import { spotTitle } from './words'

/*
  The rolls gone by. A history column of the latest rolls (the three dice, the total on a pill coloured Small, Big or
  Triple, and odd or even), the same as a row of pills where the stage has no side room, and the stats over the last
  hundred: Small / Big / Triple and Odd / Even shares, how often each face showed, the hot and cold totals, and the
  biggest lucky strikes.
*/

export const SIZE_COLOR = { small: '#4c9bff', big: '#ff5468', triple: '#f7c548' } as const
const SIZE_NAME = { small: 'Small', big: 'Big', triple: 'Triple' } as const

function TotalPill({ dice, size }: { dice: Dice; size: number }) {
  const d = describe(dice)
  return (
    <span
      className="tnum flex shrink-0 items-center justify-center rounded-full font-black leading-none"
      style={{ width: size, height: size, fontSize: size * 0.48, background: SIZE_COLOR[d.size], color: d.size === 'triple' ? '#2a1c00' : '#fff', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.18)' }}
      title={`${d.total}: ${SIZE_NAME[d.size]}${d.parity !== 'triple' ? `, ${d.parity}` : ''}`}
    >
      {d.total}
    </span>
  )
}

/** one past roll: the dice, the total, odd or even */
export function RollRow({ roll, die, fresh, words = true }: { roll: PastRoll; die: number; fresh?: boolean; words?: boolean }) {
  const d = describe(roll.dice)
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 ${fresh ? 'bg-white/[0.07]' : ''}`}>
      <span className="flex shrink-0 gap-[3px]">
        {sorted(roll.dice).map((n, i) => (
          <DieFace key={i} n={n} size={die} />
        ))}
      </span>
      <TotalPill dice={roll.dice} size={Math.round(die * 1.25)} />
      {words && (
        <span className="min-w-0 truncate text-[10.5px] font-extrabold uppercase tracking-wide text-white/55">
          {d.size === 'triple' ? <span className="text-gold">Triple</span> : `${SIZE_NAME[d.size]} · ${d.parity}`}
        </span>
      )}
    </div>
  )
}

/** the latest rolls, newest on top, as many as `rows` */
export function HistoryColumn({ rolls, rows, die, words, empty, onOpen }: { rolls: readonly PastRoll[]; rows: number; die: number; words: boolean; empty?: string; onOpen: () => void }) {
  const list = rolls.slice(-rows).reverse()
  return (
    <button onClick={onOpen} className="flex w-full flex-col gap-0.5 text-left" aria-label="Roll history and stats">
      <AnimatePresence initial={false}>
        {list.map((r, i) => (
          <motion.div
            key={r.t}
            layout="position"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1 - i * (0.5 / Math.max(1, rows)), x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <RollRow roll={r} die={die} fresh={i === 0} words={words} />
          </motion.div>
        ))}
      </AnimatePresence>
      {!list.length && empty && <span className="px-1.5 text-[11.5px] font-semibold text-white/45">{empty}</span>}
    </button>
  )
}

/** the latest rolls as a row of pills, newest first (a stage with no side room) */
export function HistoryStrip({ rolls, onOpen }: { rolls: readonly PastRoll[]; onOpen: () => void }) {
  const list = rolls.slice(-14).reverse()
  return (
    <button onClick={onOpen} className="no-scrollbar flex min-w-0 items-center gap-1 overflow-hidden" aria-label="Roll history and stats">
      <AnimatePresence initial={false}>
        {list.map((r, i) => (
          <motion.span
            key={r.t}
            layout="position"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: i ? 0.85 : 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 32 }}
          >
            <TotalPill dice={r.dice} size={i ? 24 : 28} />
          </motion.span>
        ))}
      </AnimatePresence>
    </button>
  )
}

/* ---------------- stats ---------------- */

function Bar({ parts }: { parts: { label: string; value: number; color: string; ink: string }[] }) {
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div className="flex h-7 overflow-hidden rounded-lg bg-black/30">
      {parts.map((p) =>
        p.value ? (
          <div
            key={p.label}
            className="tnum flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap text-[11px] font-black"
            style={{ width: `${(p.value / sum) * 100}%`, background: p.color, color: p.ink }}
            title={`${p.label}: ${p.value}`}
          >
            {p.value / sum >= 0.12 ? `${p.label} ${Math.round((p.value / sum) * 100)}%` : p.value / sum >= 0.05 ? `${Math.round((p.value / sum) * 100)}%` : ''}
          </div>
        ) : null,
      )}
    </div>
  )
}

const Section = ({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) => (
  <div>
    <div className="mb-1.5 flex items-baseline justify-between text-[10.5px] font-black uppercase tracking-[0.14em] text-white/50">
      <span>{title}</span>
      {right && <span className="tnum normal-case tracking-normal text-white/40">{right}</span>}
    </div>
    {children}
  </div>
)

export function StatsView({ rolls }: { rolls: readonly PastRoll[] }) {
  const n = rolls.length
  if (!n) return <div className="py-6 text-center text-[13px] font-semibold text-muted">Roll the dice and the stats fill in here.</div>
  const size = { small: 0, big: 0, triple: 0 }
  const parity = { odd: 0, even: 0, triple: 0 }
  const faces = [0, 0, 0, 0, 0, 0]
  const totals = new Map<number, { count: number; last: number }>()
  for (let t = 4; t <= 17; t++) totals.set(t, { count: 0, last: -1 })
  rolls.forEach((r, i) => {
    const d = describe(r.dice)
    size[d.size]++
    parity[d.parity]++
    for (const f of r.dice) faces[f - 1]++
    if (d.total >= 4 && d.total <= 17) {
      const e = totals.get(d.total)!
      e.count++
      e.last = i
    }
  })
  const ranked = [...totals.entries()].map(([t, e]) => ({ t, ...e, ago: e.last < 0 ? Infinity : n - 1 - e.last }))
  // hot: the most frequent of the totals that came up at all; cold: the rarest, longest gone first
  const hot = ranked
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.ago - b.ago)
    .slice(0, 4)
  const cold = [...ranked].sort((a, b) => a.count - b.count || b.ago - a.ago).slice(0, 4)
  const maxFace = Math.max(...faces, 1)
  const strikes = rolls
    .flatMap((r) => r.lucky.filter((l) => l.mult >= 10).map((l) => ({ ...l, t: r.t, won: oddsWon(spotOf(l.key), r.dice) > 0 })))
    .slice(-6)
    .reverse()
  return (
    <div className="flex flex-col gap-4">
      <Section title="Small · Big" right={`last ${n} roll${n > 1 ? 's' : ''}`}>
        <Bar
          parts={[
            { label: 'Small', value: size.small, color: SIZE_COLOR.small, ink: '#fff' },
            { label: 'Triple', value: size.triple, color: SIZE_COLOR.triple, ink: '#2a1c00' },
            { label: 'Big', value: size.big, color: SIZE_COLOR.big, ink: '#fff' },
          ]}
        />
      </Section>
      <Section title="Odd · Even">
        <Bar
          parts={[
            { label: 'Odd', value: parity.odd, color: '#3a4a5c', ink: '#fff' },
            { label: 'Triple', value: parity.triple, color: SIZE_COLOR.triple, ink: '#2a1c00' },
            { label: 'Even', value: parity.even, color: '#6b7d90', ink: '#fff' },
          ]}
        />
      </Section>
      <Section title="Each face" right={`of ${n * 3} dice`}>
        <div className="grid grid-cols-6 gap-1.5">
          {faces.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="flex h-12 w-full items-end overflow-hidden rounded-md bg-black/30">
                <motion.div
                  className="w-full rounded-md bg-gradient-to-t from-[#b8862a] to-gold"
                  initial={false}
                  animate={{ height: `${(c / maxFace) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 26 }}
                />
              </div>
              <DieFace n={(i + 1) as 1} size={18} />
              <span className="tnum text-[10.5px] font-bold text-white/60">{Math.round((c / (n * 3)) * 100)}%</span>
            </div>
          ))}
        </div>
      </Section>
      <div className="grid grid-cols-2 gap-3">
        <Section title="Hot totals">
          <div className="flex flex-wrap gap-1">
            {hot.map((h) => (
              <span key={h.t} className="tnum rounded-md bg-[#ff5468]/15 px-1.5 py-0.5 text-[12px] font-extrabold text-[#ff9aa6]">
                {h.t} <span className="font-semibold text-white/45">×{h.count}</span>
              </span>
            ))}
          </div>
        </Section>
        <Section title="Cold totals">
          <div className="flex flex-wrap gap-1">
            {cold.map((h) => (
              <span key={h.t} className="tnum rounded-md bg-[#4c9bff]/15 px-1.5 py-0.5 text-[12px] font-extrabold text-[#9cc6ff]">
                {h.t} <span className="font-semibold text-white/45">×{h.count}</span>
              </span>
            ))}
          </div>
        </Section>
      </div>
      <Section title="Big lucky strikes">
        {strikes.length ? (
          <div className="flex flex-col gap-1">
            {strikes.map((s, i) => (
              <div key={`${s.t}-${s.key}-${i}`} className="flex items-center gap-2 text-[12px] font-bold">
                <span className="tnum rounded-full bg-gold px-1.5 py-px text-[11px] font-black text-[#2a1200]">×{s.mult}</span>
                <span className="text-white/80">{spotTitle(s.key)}</span>
                <span className={`ml-auto text-[11px] font-extrabold ${s.won ? 'text-accent' : 'text-white/35'}`}>{s.won ? 'hit' : 'missed'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] font-semibold text-white/45">Strikes of ×10 or more show up here.</div>
        )}
      </Section>
    </div>
  )
}

/** the history and the stats under two tabs (the desktop side card, and the phone's sheet) */
export function RollsPanel({ rolls, rows, initial = 'history' }: { rolls: readonly PastRoll[]; rows: number; initial?: 'history' | 'stats' }) {
  const [tab, setTab] = useState(initial)
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex rounded-full bg-black/30 p-0.5" role="tablist">
        {(['history', 'stats'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-1.5 text-[12px] font-extrabold capitalize transition ${tab === t ? 'bg-white/12 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.08)]' : 'text-white/50 hover:text-white/80'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'history' ? (
        <div className="flex flex-col gap-0.5">
          {rolls
            .slice(-rows)
            .reverse()
            .map((r, i) => (
              <RollRow key={r.t} roll={r} die={20} fresh={i === 0} />
            ))}
          {!rolls.length && <div className="py-6 text-center text-[13px] font-semibold text-muted">No rolls yet.</div>}
        </div>
      ) : (
        <StatsView rolls={rolls} />
      )}
    </div>
  )
}
