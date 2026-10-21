import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal } from '../../components/Modal'
import { Spinner } from '../../components/Loader'
import { Coin, IconX } from '../../components/icons'
import { ActionButton, Toggle } from '../../components/ui'
import { fmt, round2 } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { casesSfx } from '../cases/sound'
import { useWallet } from '../../store/wallet'
import { CrateArt } from '../cases/art'
import { CRATES, TIERS, multLabel, topMult, type Tier } from '../cases/rules'
import { CRAZY, CrazyMark, EMBER, ModeGlyph, TEAM } from './art'
import { costOf } from './engine'
import type { Setup } from './actions'
import { readLast } from './ledger'
import { LIMITS, MODES, SEATS, type Mode } from './types'

/* Setting up a battle: the crates in order (one per round), the stake per crate, how many play and how, and whether
   the house bots take the empty seats straight away. */

const UNITS = [1, 5, 10, 50, 100, 500]
const MODE_TEXT: Record<Mode, string> = { '1v1': 'Two players', '1v1v1': 'Three players', '1v1v1v1': 'Four players', '2v2': 'Two teams of two' }

export function defaultSetup(): Setup {
  const last = readLast()
  const cases = (last?.cases ?? []).filter((t): t is Tier => TIERS.includes(t as Tier)).slice(0, LIMITS.MAX_CASES)
  return {
    mode: last && MODES.includes(last.mode) ? last.mode : '1v1',
    crazy: !!last?.crazy,
    unit: last ? Math.min(LIMITS.MAX_UNIT, Math.max(LIMITS.MIN_UNIT, last.unit)) : 10,
    cases: cases.length ? cases : ['medium', 'medium', 'high'],
  }
}

export default function CreateModal({ initial, name, onCreate, onClose }: { initial: Setup; name: string; onCreate: (s: Setup, bots: boolean) => Promise<boolean>; onClose: () => void }) {
  const balance = useWallet((s) => s.balance)
  const [cases, setCases] = useState<Tier[]>(initial.cases)
  const [unit, setUnit] = useState(initial.unit)
  const [unitText, setUnitText] = useState(String(initial.unit))
  const [mode, setMode] = useState<Mode>(initial.mode)
  const [crazy, setCrazy] = useState(initial.crazy)
  const [bots, setBots] = useState(false)
  const [busy, setBusy] = useState(false)

  const cost = costOf(unit, cases)
  const full = cases.length >= LIMITS.MAX_CASES
  const tooMuch = cost > LIMITS.MAX_COST
  const short = balance < cost
  const count = (t: Tier) => cases.filter((x) => x === t).length

  const add = (t: Tier) => {
    if (full) return
    casesSfx.pick(TIERS.indexOf(t))
    setCases((c) => [...c, t])
  }
  const removeOne = (t: Tier) => {
    const i = cases.lastIndexOf(t)
    if (i < 0) return
    sfx.click()
    setCases((c) => c.filter((_, j) => j !== i))
  }
  const removeAt = (i: number) => {
    sfx.click()
    setCases((c) => c.filter((_, j) => j !== i))
  }
  const commitUnit = (v: number) => {
    const n = round2(Math.min(LIMITS.MAX_UNIT, Math.max(LIMITS.MIN_UNIT, Number.isFinite(v) ? v : LIMITS.MIN_UNIT)))
    setUnit(n)
    setUnitText(String(n))
  }

  const submit = async () => {
    if (busy || !cases.length || tooMuch || short) return
    setBusy(true)
    const ok = await onCreate({ mode, crazy, unit, cases }, bots)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal onClose={onClose} title="Create a battle" width={580}>
      <div className="flex flex-col gap-4">
        {/* crates */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-wider text-muted">
              Crates <span className="tnum text-dim">· {cases.length}/{LIMITS.MAX_CASES}</span>
            </span>
            {cases.length > 0 && (
              <button onClick={() => (sfx.click(), setCases([]))} className="text-[12px] font-bold text-dim transition hover:text-ink">
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TIERS.map((t) => {
              const n = count(t)
              return (
                <div key={t} className={`relative flex flex-col items-center rounded-xl px-2 pb-2 pt-2.5 transition ${n ? 'bg-hover shadow-[inset_0_0_0_2px_rgba(255,122,61,.55)]' : 'bg-raised'}`}>
                  <button onClick={() => add(t)} disabled={full} className="flex flex-col items-center transition active:scale-95 disabled:opacity-50" aria-label={`Add a ${CRATES[t].name}`}>
                    <CrateArt tier={t} size={58} />
                    <span className="mt-1 text-[13px] font-extrabold text-ink">{CRATES[t].name.replace(' Crate', '')}</span>
                    <span className="tnum text-[11px] font-semibold text-dim">up to {multLabel(topMult(CRATES[t]))}</span>
                  </button>
                  <div className="mt-2 flex w-full items-center justify-between rounded-lg bg-stage p-0.5">
                    <button onClick={() => removeOne(t)} disabled={!n} className="flex h-7 w-8 items-center justify-center rounded-md text-[17px] font-black text-muted transition hover:bg-raised hover:text-ink disabled:opacity-30" aria-label="One fewer">
                      −
                    </button>
                    <span className={`tnum text-[14px] font-black ${n ? 'text-ink' : 'text-dim'}`}>{n}</span>
                    <button onClick={() => add(t)} disabled={full} className="flex h-7 w-8 items-center justify-center rounded-md text-[17px] font-black text-muted transition hover:bg-raised hover:text-ink disabled:opacity-30" aria-label="One more">
                      +
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {/* the rounds, in order */}
          <div className="no-scrollbar mt-2 flex min-h-[54px] items-center gap-1.5 overflow-x-auto rounded-xl bg-stage px-2 py-1.5">
            <AnimatePresence initial={false}>
              {cases.map((t, i) => (
                <motion.button
                  key={`${i}:${t}`}
                  layout="position"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 520, damping: 32 }}
                  onClick={() => removeAt(i)}
                  className="group relative shrink-0 rounded-lg bg-panel2 p-1 transition hover:bg-raised"
                  title={`Round ${i + 1}: ${CRATES[t].name} (tap to remove)`}
                >
                  <CrateArt tier={t} size={34} />
                  <span className="tnum absolute -left-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0c1823] px-1 text-[9px] font-black text-muted ring-1 ring-white/10">{i + 1}</span>
                  <span className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-danger text-white group-hover:flex">
                    <IconX size={10} />
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
            {!cases.length && <span className="px-2 text-[12px] font-semibold text-dim">Add crates above: each one is a round.</span>}
          </div>
        </section>

        {/* stake */}
        <section>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted">Stake per crate</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border-2 border-raised bg-stage px-3 focus-within:border-hover">
              <Coin size={17} />
              <input
                type="number"
                inputMode="decimal"
                value={unitText}
                onChange={(e) => {
                  setUnitText(e.target.value)
                  const n = parseFloat(e.target.value)
                  if (Number.isFinite(n) && n >= LIMITS.MIN_UNIT) setUnit(round2(Math.min(LIMITS.MAX_UNIT, n)))
                }}
                onBlur={() => commitUnit(parseFloat(unitText))}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                onFocus={(e) => e.target.select()}
                aria-label="Stake per crate"
                className="tnum h-full w-full min-w-0 bg-transparent text-[15px] font-bold outline-none"
              />
              <button onClick={() => (sfx.click(), commitUnit(unit / 2))} className="rounded-md bg-raised px-2 py-1 text-[12px] font-bold text-muted hover:text-ink">
                ½
              </button>
              <button onClick={() => (sfx.click(), commitUnit(unit * 2))} className="rounded-md bg-raised px-2 py-1 text-[12px] font-bold text-muted hover:text-ink">
                2×
              </button>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {UNITS.map((u) => (
                <button
                  key={u}
                  onClick={() => (sfx.click(), commitUnit(u))}
                  className={`tnum h-9 rounded-lg px-2 text-[12px] font-extrabold transition ${unit === u ? 'bg-hover text-ink shadow-[inset_0_0_0_2px_rgba(255,122,61,.55)]' : 'bg-raised text-muted hover:bg-hover hover:text-ink'}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* mode */}
        <section>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted">Players</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODES.map((m) => {
              const on = m === mode
              return (
                <button
                  key={m}
                  onClick={() => (sfx.click(), setMode(m))}
                  aria-pressed={on}
                  className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 transition ${on ? 'bg-hover shadow-[inset_0_0_0_2px_rgba(255,122,61,.55)]' : 'bg-raised hover:bg-hover'}`}
                >
                  <ModeGlyph mode={m} size={18} color={on ? (m === '2v2' ? TEAM[0] : EMBER) : '#8ea3b8'} />
                  <span className="text-[14px] font-black text-ink">{m}</span>
                  <span className="text-[11px] font-semibold text-dim">{MODE_TEXT[m]}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* options */}
        <section className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-raised px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${CRAZY}22`, color: CRAZY }}>
              <CrazyMark size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-extrabold text-ink">Crazy mode</span>
              <span className="block text-[11.5px] font-semibold text-dim">The lowest total wins</span>
            </span>
            <Toggle on={crazy} onChange={setCrazy} label="Crazy mode" />
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-raised px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[.07] text-[15px]" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9fb3c8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="8" width="16" height="12" rx="3" />
                <path d="M12 8V4M9 4h6M9 13h.01M15 13h.01M9.5 17h5" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-extrabold text-ink">Play the bots now</span>
              <span className="block text-[11.5px] font-semibold text-dim">House bots fill every empty seat</span>
            </span>
            <Toggle on={bots} onChange={setBots} label="Play the bots now" />
          </label>
        </section>

        {/* summary */}
        <div className="flex items-center gap-3 rounded-xl bg-stage px-3 py-2.5">
          <div className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-muted">
            <div>
              {cases.length || 0} {cases.length === 1 ? 'round' : 'rounds'} · {SEATS[mode]} seats · playing as <span className="font-extrabold text-ink">{name}</span>
            </div>
            <div className="text-dim">{tooMuch ? `A seat can cost at most ${fmt(LIMITS.MAX_COST, 0)}.` : short ? 'Not enough coins for a seat.' : 'Your seat is paid now and comes back if the battle is called off.'}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-bold uppercase tracking-wide text-dim">Your seat</div>
            <div className={`tnum flex items-center justify-end gap-1 text-[18px] font-black ${tooMuch || short ? 'text-danger' : 'text-ink'}`}>
              {fmt(cost)} <Coin size={16} />
            </div>
          </div>
        </div>

        <ActionButton tone="gold" onClick={submit} disabled={busy || !cases.length || tooMuch || short}>
          {busy && <Spinner size={16} />} {bots ? 'Create and play' : 'Create battle'}
        </ActionButton>
      </div>
    </Modal>
  )
}
