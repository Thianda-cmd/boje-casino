import { useEffect, useRef, useState } from 'react'
import { Label, Segmented, Toggle } from '../../components/ui'
import { Coin, IconTrophy } from '../../components/icons'
import { fmt, round2 } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { CHALLENGE_MIN_BET, MAX_BET, MIN_BET } from '../../store/wallet'
import { multLabel } from './rules'
import type { Speed } from './ScratchCard'

/*
  The panel's own controls: the card price (quick chips and a field), the speed of Reveal all and autoplay, autoplay's
  extra stops and the strip that sums up an autoplay session.
*/

const PRICES = [1, 5, 10, 25, 100, 500]

export function PriceControl({ value, onChange, disabled, balance }: { value: number; onChange: (v: number) => void; disabled?: boolean; balance: number }) {
  const [text, setText] = useState(value.toFixed(2))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value.toFixed(2))
  }, [value])
  const commit = (v: number) => {
    const n = round2(Math.min(MAX_BET, Math.max(MIN_BET, Number.isFinite(v) ? v : MIN_BET)))
    onChange(n)
    setText(n.toFixed(2))
  }
  const btn = 'h-full min-w-11 px-3 text-[13px] font-bold text-ink/90 transition hover:bg-hover active:scale-95 disabled:pointer-events-none disabled:opacity-40'
  return (
    <div>
      <Label right={<>{fmt(balance)}</>}>Card price</Label>
      <div className={`grid grid-cols-6 gap-1 ${disabled ? 'opacity-60' : ''}`}>
        {PRICES.map((p) => {
          const on = Math.abs(value - p) < 0.001
          return (
            <button
              key={p}
              disabled={disabled}
              onClick={() => (sfx.click(), commit(p))}
              aria-pressed={on}
              title={p >= CHALLENGE_MIN_BET ? 'Counts toward challenges' : undefined}
              className={`tnum relative h-9 rounded-md text-[13px] font-extrabold transition disabled:pointer-events-none ${on ? 'bg-hover text-ink shadow-[inset_0_0_0_2px_rgba(247,197,72,.7)]' : 'bg-raised text-muted hover:text-ink'}`}
            >
              {p}
              {p >= CHALLENGE_MIN_BET && <IconTrophy size={9} className="absolute right-[3px] top-[3px] text-gold/80" strokeWidth={2.6} />}
            </button>
          )
        })}
      </div>
      <div className={`mt-1.5 flex h-11 items-stretch overflow-hidden rounded-lg border-2 border-raised bg-stage shadow-[inset_0_1px_3px_rgba(0,0,0,.25)] transition-colors focus-within:border-hover hover:border-hover ${disabled ? 'opacity-60' : ''}`}>
        <label className="flex min-w-0 flex-1 cursor-text items-center gap-2 pl-3">
          <Coin size={17} />
          <input
            type="number"
            inputMode="decimal"
            min={MIN_BET}
            step="1"
            disabled={disabled}
            value={text}
            onFocus={(e) => {
              focused.current = true
              e.target.select()
            }}
            onBlur={() => {
              focused.current = false
              commit(parseFloat(text))
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            onChange={(e) => {
              setText(e.target.value)
              const n = parseFloat(e.target.value)
              if (Number.isFinite(n) && n >= MIN_BET) onChange(round2(Math.min(MAX_BET, n)))
            }}
            aria-label="Card price"
            className="tnum h-full w-full min-w-0 bg-transparent text-[15px] font-bold outline-none"
          />
        </label>
        <div className="flex items-stretch bg-raised">
          <button disabled={disabled} className={btn} onClick={() => (sfx.click(), commit(value / 2))}>
            ½
          </button>
          <div className="my-2.5 w-px bg-stage/60" />
          <button disabled={disabled} className={btn} onClick={() => (sfx.click(), commit(value * 2))}>
            2×
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-dim">
        <IconTrophy size={11} className="shrink-0 text-gold/80" />
        {value >= CHALLENGE_MIN_BET ? 'This price counts toward challenges' : `Cards of ${CHALLENGE_MIN_BET}+ count toward challenges`}
      </div>
    </div>
  )
}

/** cards per buy: one, or a stack of 5 or 10 paid for at once and dealt one at a time */
export function CountControl({ value, onChange, disabled, price }: { value: 1 | 5 | 10; onChange: (v: 1 | 5 | 10) => void; disabled?: boolean; price: number }) {
  return (
    <div>
      <Label right={value > 1 ? `${fmt(round2(price * value))} a stack` : undefined}>Cards per buy</Label>
      <Segmented
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: 1, label: '×1' },
          { value: 5, label: '×5' },
          { value: 10, label: '×10' },
        ]}
      />
    </div>
  )
}

export function SpeedControl({ value, onChange, disabled }: { value: Speed; onChange: (v: Speed) => void; disabled?: boolean }) {
  return (
    <div>
      <Label right={value === 'instant' ? 'no coin, straight to the result' : value === 'turbo' ? 'a quicker coin' : undefined}>Reveal speed</Label>
      <Segmented
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'turbo', label: 'Turbo' },
          { value: 'instant', label: 'Instant' },
        ]}
      />
    </div>
  )
}

export interface Stops {
  /** stop after a win of at least this many times the price (0: never) */
  win: number
  /** stop after the card's top prize */
  jackpot: boolean
}

export function AutoStops({ stops, onChange, disabled }: { stops: Stops; onChange: (s: Stops) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label>Stop after a win of</Label>
        <div className={`grid grid-cols-5 gap-1 ${disabled ? 'opacity-60' : ''}`}>
          {[0, 10, 50, 100, 500].map((m) => (
            <button
              key={m}
              disabled={disabled}
              onClick={() => (sfx.click(), onChange({ ...stops, win: m }))}
              aria-pressed={stops.win === m}
              className={`tnum h-9 rounded-md text-[12.5px] font-extrabold transition disabled:pointer-events-none ${stops.win === m ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}
            >
              {m === 0 ? 'Off' : `${multLabel(m)}+`}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2">
        <div className="text-[13px] font-bold">
          Stop on a jackpot <span className="text-[11px] font-semibold text-dim">(the card's top prize)</span>
        </div>
        <Toggle on={stops.jackpot} onChange={(v) => onChange({ ...stops, jackpot: v })} disabled={disabled} label="Stop on a jackpot" />
      </div>
    </div>
  )
}

export interface Session {
  played: number
  won: number
  net: number
  best: number
}

export const NO_SESSION: Session = { played: 0, won: 0, net: 0, best: 0 }

/** an autoplay session in one line: cards played, how many won, the net and the best multiplier */
export function SessionStrip({ s, compact }: { s: Session; compact?: boolean }) {
  const net = round2(s.net)
  return (
    <div className={`tnum flex items-center justify-between gap-2 rounded-lg bg-stage font-semibold text-dim ${compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-[11.5px]'}`}>
      <span>
        <b className="text-ink">{s.played}</b> played
      </span>
      <span>
        <b className="text-ink">{s.won}</b> won
      </span>
      <span>
        net <b className={net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : 'text-ink'}>{net > 0 ? '+' : ''}{fmt(net)}</b>
      </span>
      <span>
        best <b className="text-gold">{s.best ? multLabel(s.best) : '–'}</b>
      </span>
    </div>
  )
}
