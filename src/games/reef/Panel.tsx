import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Toggle } from '../../components/ui'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { COSTS, RTP, multLabel, speciesOf, type FishId } from './rules'
import { LEVEL_COLORS } from './looks'
import { CannonArt, INK, Portrait, chip } from './art'
import type { Session } from './purse'

/*
  The left column (under the stage on a phone): the cannon's level with a picture of the cannon that grows with it,
  the Auto fire and Lock toggles, the session since the page opened and its biggest catch, the paytable, and the one
  honest line about the odds. The reef itself is played on the stage; nothing here has to be pressed to fire.
*/

interface Props {
  level: number
  onLevel: (i: number) => void
  auto: boolean
  onAuto: (on: boolean) => void
  lock: boolean
  onLock: (on: boolean) => void
  session: Session
  balance: number
  portraits: Partial<Record<FishId, string>>
  onPaytable: () => void
}

export function Panel({ level, onLevel, auto, onAuto, lock, onLock, session, balance, portraits, onPaytable }: Props) {
  const cost = COSTS[level]
  const net = session.won - session.spent
  return (
    <>
      {/* the cannon */}
      <div className="rounded-xl bg-stage p-3">
        <div className="flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>Cannon</span>
          <span className="tnum text-dim">
            Level {level + 1} of {COSTS.length}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Step label="Lower the cannon" disabled={level === 0} onClick={() => onLevel(level - 1)}>
            <path d="M6 12h12" />
          </Step>
          <div className="flex min-w-0 flex-1 flex-col items-center">
            <CannonArt level={level} className="h-[118px] w-[124px]" />
            <div className="tnum mt-1 flex items-center gap-1.5 leading-none">
              <Coin size={20} />
              <span className="text-[24px] font-black">{fmt(cost, 0)}</span>
              <span className="text-[12px] font-semibold text-dim">a shot</span>
            </div>
          </div>
          <Step label="Raise the cannon" disabled={level === COSTS.length - 1} onClick={() => onLevel(level + 1)}>
            <path d="M6 12h12M12 6v12" />
          </Step>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1" role="radiogroup" aria-label="Cannon level">
          {COSTS.map((c, i) => {
            const on = i === level
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${c} coins a shot`}
                onClick={() => onLevel(i)}
                className={`tnum relative h-8 rounded-md text-[12.5px] font-black transition ${on ? 'text-white' : 'bg-panel2 text-muted hover:bg-raised hover:text-ink'} ${c > balance && !on ? 'opacity-45' : ''}`}
                style={on ? { background: LEVEL_COLORS[i], boxShadow: `inset 0 0 0 2px ${INK}, 0 2px 0 ${INK}`, textShadow: `0 1px 0 ${INK}` } : undefined}
              >
                {c}
              </button>
            )
          })}
        </div>
      </div>

      {/* auto fire and lock */}
      <div className="flex flex-col rounded-xl bg-stage">
        <ToggleRow title="Auto fire" sub="Fires on its own at the pointer, or at your target" k="A" on={auto} onChange={onAuto} />
        <div className="mx-3 h-px bg-line" />
        <ToggleRow title="Lock target" sub="Pick a creature: torpedoes home in on it" k="L" on={lock} onChange={onLock} />
      </div>

      {/* the session, and its biggest catch */}
      <div className="rounded-xl bg-stage p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-muted">This session</span>
          <span className={`tnum flex items-center gap-1 text-[15px] font-black ${net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : 'text-ink'}`}>
            {net > 0 ? '+' : net < 0 ? '−' : ''}
            {fmt(Math.abs(net))}
            <Coin size={14} />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <Figure label="Shots" value={session.shots.toLocaleString('en-US')} />
          <Figure label="Catches" value={session.catches.toLocaleString('en-US')} />
          <Figure label="Spent" value={fmt(session.spent)} />
          <Figure label="Won" value={fmt(session.won)} />
        </div>
        <div className="mt-2.5 flex min-h-[48px] items-center gap-2.5 border-t border-line pt-2.5">
          {session.best ? (
            <>
              <motion.div key={`${session.best.id}-${session.best.payout}`} initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 14 }}>
                <Portrait id={session.best.id} src={portraits[session.best.id]} size={44} />
              </motion.div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-dim">Biggest catch</div>
                <div className="flex items-center gap-1.5 truncate text-[13px] font-extrabold">
                  {speciesOf(session.best.id).name}
                  <span className="tnum rounded-full px-1.5 text-[11px] font-black leading-[16px]" style={{ ...chip(speciesOf(session.best.id).color), boxShadow: `inset 0 0 0 1.5px ${INK}` }}>
                    {multLabel(session.best.mult)}
                  </span>
                </div>
              </div>
              <div className="tnum flex shrink-0 items-center gap-1 text-[14px] font-black text-gold">
                +{fmt(session.best.payout)}
                <Coin size={13} />
              </div>
            </>
          ) : (
            <div className="text-[12px] font-semibold text-dim">Your biggest catch shows here.</div>
          )}
        </div>
      </div>

      <button type="button" onClick={() => (sfx.click(), onPaytable())} className="h-10 shrink-0 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
        Paytable
      </button>

      <p className="-mt-1 text-[12px] leading-relaxed text-muted">
        Every shot returns {Math.round(RTP * 100)}% on average: big creatures pay more but are caught less often.
      </p>
      <p className="hidden text-[11px] leading-relaxed text-dim lg:block lg:mt-auto">
        Click or hold the reef to fire (Space too). A auto fire, L lock (Esc lets go), 1–7, Q / E or the mouse wheel change the cannon.
      </p>
    </>
  )
}

function Step({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-ink transition hover:bg-hover disabled:opacity-35"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
        {children}
      </svg>
    </motion.button>
  )
}

function ToggleRow({ title, sub, k, on, onChange }: { title: string; sub: string; k: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-bold">
          {title}
          <kbd className="hidden rounded border border-line bg-raised px-1.5 text-[10.5px] font-bold leading-[17px] text-muted lg:inline">{k}</kbd>
        </div>
        <div className="text-[11px] leading-snug text-dim">{sub}</div>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] font-semibold text-dim">{label}</span>
      <span className="tnum text-[13px] font-bold">{value}</span>
    </div>
  )
}
