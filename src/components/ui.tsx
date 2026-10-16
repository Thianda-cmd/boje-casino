import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { Coin } from './icons'
import { fmt, fmtMult, round2 } from '../lib/format'
import { MAX_BET, MIN_BET, useWallet } from '../store/wallet'
import { sfx } from '../lib/sound'

export function AnimatedNumber({ value, digits = 2, className = '' }: { value: number; digits?: number; className?: string }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => fmt(v, digits))
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1] })
    return c.stop
  }, [value, mv])
  return <motion.span className={`tnum ${className}`}>{text}</motion.span>
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] font-semibold text-muted">
      <span>{children}</span>
      {right && <span className="tnum text-dim">{right}</span>}
    </div>
  )
}

const fieldBox =
  'flex h-12 items-stretch overflow-hidden rounded-lg border-2 border-raised bg-stage shadow-[inset_0_1px_3px_rgba(0,0,0,.25)] transition-colors focus-within:border-hover hover:border-hover'

export function BetInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const balance = useWallet((s) => s.balance)
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
      <Label right={<>{fmt(balance)}</>}>Bet amount</Label>
      <div className={`${fieldBox} ${disabled ? 'opacity-60' : ''}`}>
        <label className="flex min-w-0 flex-1 cursor-text items-center gap-2 pl-3">
          <Coin size={18} />
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
            aria-label="Bet amount"
            className="tnum h-full w-full min-w-0 bg-transparent text-[16px] font-bold outline-none"
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
    </div>
  )
}

/** A numeric field that only commits on blur or Enter, clamped to [min, max]. */
export function NumberField({
  label,
  right,
  value,
  onCommit,
  suffix,
  min,
  max,
  digits = 2,
  disabled,
  onSuffixClick,
}: {
  label?: ReactNode
  right?: ReactNode
  value: number
  onCommit: (v: number) => void
  suffix?: ReactNode
  min: number
  max: number
  digits?: number
  disabled?: boolean
  onSuffixClick?: () => void
}) {
  const [text, setText] = useState(value.toFixed(digits))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value.toFixed(digits))
  }, [value, digits])
  const commit = () => {
    const n = parseFloat(text)
    const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value
    onCommit(v)
    setText(v.toFixed(digits))
  }
  return (
    <div className="min-w-0">
      {label && <Label right={right}>{label}</Label>}
      <div className={`${fieldBox} ${disabled ? 'opacity-60' : ''}`}>
        <input
          type="number"
          inputMode="decimal"
          disabled={disabled}
          value={text}
          onFocus={(e) => {
            focused.current = true
            e.target.select()
          }}
          onBlur={() => {
            focused.current = false
            commit()
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          onChange={(e) => setText(e.target.value)}
          className="tnum w-full min-w-0 bg-transparent px-3 text-[16px] font-bold outline-none"
        />
        {suffix != null &&
          (onSuffixClick ? (
            <button disabled={disabled} onClick={onSuffixClick} className="flex items-center bg-raised px-3 text-[13px] font-bold text-muted transition hover:bg-hover hover:text-ink">
              {suffix}
            </button>
          ) : (
            <span className="flex items-center pr-3 text-[14px] font-bold text-muted">{suffix}</span>
          ))}
      </div>
    </div>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  disabled?: boolean
  size?: 'md' | 'lg'
}) {
  const id = useId()
  return (
    <div className={`relative flex rounded-full bg-stage p-1 ${disabled ? 'opacity-60' : ''}`}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            disabled={disabled}
            onClick={() => {
              if (active) return
              sfx.click()
              onChange(o.value)
            }}
            className={`relative z-10 flex-1 rounded-full ${size === 'lg' ? 'py-2.5' : 'py-2'} text-[13px] font-bold transition-colors ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}
          >
            {active && (
              <motion.span
                layoutId={id}
                layoutDependency={value}
                className="absolute inset-0 -z-10 rounded-full bg-raised shadow-[0_2px_6px_rgba(0,0,0,.25),inset_0_1px_0_rgba(255,255,255,.06)]"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'accent',
  className = '',
  sub,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'accent' | 'gold' | 'danger' | 'neutral'
  className?: string
  sub?: ReactNode
}) {
  const tones = {
    accent: 'bg-accent text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] hover:brightness-110',
    gold: 'bg-gold text-[#2a1c00] shadow-[0_8px_22px_-10px_rgba(247,197,72,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.4)] hover:brightness-105',
    danger: 'bg-danger text-white shadow-[0_8px_22px_-10px_rgba(255,77,97,.8),inset_0_-3px_0_rgba(0,0,0,.18)] hover:brightness-110',
    neutral: 'bg-raised text-ink shadow-[inset_0_-3px_0_rgba(0,0,0,.2),inset_0_1px_0_rgba(255,255,255,.05)] hover:bg-hover',
  }
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.97 }}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[52px] w-full flex-col items-center justify-center rounded-lg px-4 text-[16px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none ${tones[tone]} ${className}`}
    >
      <span className="inline-flex items-center gap-1.5">{children}</span>
      {sub && <span className="tnum text-[12px] font-bold opacity-75">{sub}</span>}
    </motion.button>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'accent' | 'gold' }) {
  return (
    <div className="rounded-lg bg-stage px-3 py-2">
      <div className="text-[11px] font-semibold text-dim">{label}</div>
      <div className={`tnum text-[15px] font-bold ${tone === 'accent' ? 'text-accent' : tone === 'gold' ? 'text-gold' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      disabled={disabled}
      onClick={() => (sfx.click(), onChange(!on))}
      aria-label={label}
      aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-raised'} disabled:opacity-50`}
    >
      <motion.span
        initial={false}
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow"
      />
    </button>
  )
}

/** Standard game layout: controls on the left (bottom on mobile), stage on the right. */
export function GameShell({ panel, stage, footer, stageClass = '' }: { panel: ReactNode; stage: ReactNode; footer?: ReactNode; stageClass?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col-reverse overflow-hidden rounded-2xl border border-line bg-panel2 shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] lg:h-[calc(100dvh-108px)] lg:min-h-[600px] lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-4 bg-panel2 p-4 lg:w-[320px] lg:overflow-y-auto">{panel}</aside>
        <section className={`relative h-[min(58vh,540px)] min-h-[340px] min-w-0 touch-manipulation select-none bg-stage lg:h-auto lg:flex-1 ${stageClass}`}>{stage}</section>
      </div>
      {footer}
    </div>
  )
}

/** The centred result card most games show after a win. Render inside AnimatePresence. */
export function WinPopup({ mult, amount }: { mult: number; amount: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 340, damping: 22 }}
    >
      <div className="min-w-[180px] rounded-2xl border-[3px] border-accent bg-panel px-8 py-5 text-center shadow-[0_24px_60px_-12px_rgba(0,0,0,.75),0_0_48px_-10px_rgba(34,211,111,.55)]">
        <div className="tnum text-[34px] font-black leading-none tracking-tight text-accent">{fmtMult(mult)}</div>
        <div className="mx-auto my-3 h-[3px] w-10 rounded-full bg-raised" />
        <div className="tnum flex items-center justify-center gap-1.5 text-[16px] font-extrabold">
          {fmt(amount)} <Coin size={17} />
        </div>
      </div>
    </motion.div>
  )
}

export type PillTone = 'win' | 'loss' | 'gold' | 'neutral'
const PILL: Record<PillTone, string> = {
  win: 'bg-accent text-[#032412]',
  gold: 'bg-gold text-[#2a1c00]',
  loss: 'bg-raised text-ink/80',
  neutral: 'bg-raised text-muted',
}

/** A row of recent results, newest first. */
export function HistoryPills({
  items,
  className = '',
}: {
  items: { key: string | number; label: ReactNode; tone: PillTone; style?: React.CSSProperties; onClick?: () => void }[]
  className?: string
}) {
  // pills re-measure their layout only when a result arrives, not on every render of the game around them
  const head = items[0]?.key
  return (
    <div className={`no-scrollbar flex gap-1.5 overflow-hidden ${className}`}>
      <AnimatePresence initial={false}>
        {items.map((it) => {
          const Tag = it.onClick ? motion.button : motion.span
          return (
            <Tag
              key={it.key}
              layout
              layoutDependency={head}
              initial={{ opacity: 0, scale: 0.6, x: -12 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 520, damping: 32 }}
              onClick={it.onClick}
              className={`tnum shrink-0 rounded-full px-3 py-1.5 text-[12px] font-extrabold leading-none ${PILL[it.tone]} ${it.onClick ? 'cursor-pointer transition-[filter] hover:brightness-110' : ''}`}
              style={it.style}
            >
              {it.label}
            </Tag>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/** Notifies the wallet if a bet can't be placed. */
export function useStake() {
  const placeBet = useWallet((s) => s.placeBet)
  const pushToast = useWallet((s) => s.pushToast)
  return (amount: number) => {
    const ok = placeBet(amount)
    if (!ok) pushToast({ kind: 'info', title: 'Not enough coins. Visit Rewards to earn more.' })
    else sfx.bet()
    return ok
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
