import { useId, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Label, NumberField, Toggle } from '../../components/ui'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { LEVERAGES, type Side } from './rules'
import { useView } from './desk'
import { fmtPct, fmtPrice, liqMove, moveFor, signed } from './levels'
import { SL_RANGE, TP_RANGE, type Prefs, type Trade } from './storage'

/*
  The side panel's pieces: the leverage picker (the seven leverages, coloured from a gentle teal at 1× to a hot red
  at 100×, with the risk in words and the move that liquidates), auto close (take profit and stop loss as multiples of
  the stake, each saying what it closes at and how far the price must go), the two big order buttons (each with the
  liquidation price an order would get right now), and the list of recent trades.
*/

/** each leverage's colour, and its risk in a word */
const RISK = [
  { color: '#00d1a0', word: 'Gentle' },
  { color: '#22d36f', word: 'Low' },
  { color: '#9be03c', word: 'Moderate' },
  { color: '#f7c548', word: 'Bold' },
  { color: '#ffa23d', word: 'High' },
  { color: '#ff7a3d', word: 'Very high' },
  { color: '#ff4d61', word: 'Extreme' },
]

export function LeveragePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const id = useId()
  const i = Math.max(0, (LEVERAGES as readonly number[]).indexOf(value))
  const risk = RISK[i]
  return (
    <div>
      <Label right={<span className="font-extrabold" style={{ color: risk.color }}>{risk.word} risk</span>}>Leverage</Label>
      <div className="grid grid-cols-7 gap-1 rounded-xl bg-stage p-1" role="radiogroup" aria-label="Leverage">
        {LEVERAGES.map((l, k) => {
          const on = l === value
          return (
            <button
              key={l}
              role="radio"
              aria-checked={on}
              aria-label={`${l} times leverage`}
              onClick={() => !on && (sfx.click(), onChange(l))}
              className={`relative z-10 h-10 rounded-lg text-[12.5px] font-black transition-colors ${on ? 'text-[#06180f]' : 'text-muted hover:text-ink'}`}
            >
              {on && (
                <motion.span
                  layoutId={id}
                  layoutDependency={value}
                  className="absolute inset-0 -z-10 rounded-lg"
                  style={{ background: `linear-gradient(180deg, ${RISK[k].color}, ${RISK[k].color}cc)`, boxShadow: `0 4px 14px -4px ${RISK[k].color}, inset 0 1px 0 rgba(255,255,255,.4), inset 0 -2px 0 rgba(0,0,0,.18)` }}
                  transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                />
              )}
              {l}×
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative h-1.5 flex-1 rounded-full bg-[linear-gradient(90deg,#00d1a0,#9be03c_35%,#f7c548_55%,#ff7a3d_78%,#ff4d61)] opacity-90">
          <motion.span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-stage"
            style={{ background: risk.color }}
            initial={false}
            animate={{ left: `${(i / (LEVERAGES.length - 1)) * 100}%` }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          />
        </div>
      </div>
      <div className="mt-1.5 text-[11.5px] font-semibold text-dim">
        Liquidated by a <span className="tnum font-extrabold text-ink">{fmtPct(liqMove(value))}</span> move against you
      </div>
    </div>
  )
}

function Quick({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={() => (sfx.click(), onClick())} className={`h-12 min-w-11 rounded-lg px-2 text-[12.5px] font-extrabold transition ${on ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}>
      {children}
    </button>
  )
}

export function AutoClose({ prefs, set, bet }: { prefs: Prefs; set: (p: Partial<Prefs>) => void; bet: number }) {
  const lev = prefs.leverage
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-stage p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-ink">Take profit</div>
          {!prefs.tpOn && <div className="text-[11px] font-semibold text-dim">Close itself at a target</div>}
        </div>
        <Toggle on={prefs.tpOn} onChange={(v) => set({ tpOn: v })} label="Take profit" />
      </div>
      {prefs.tpOn && (
        <div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1">
            <NumberField value={prefs.tp} min={TP_RANGE.min} max={TP_RANGE.max} onCommit={(v) => set({ tp: Math.round(v * 100) / 100 })} suffix="×" />
            {[1.5, 2, 5].map((v) => (
              <Quick key={v} on={prefs.tp === v} onClick={() => set({ tp: v })}>
                {v}×
              </Quick>
            ))}
          </div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-dim">
            At <span className="tnum font-extrabold text-accent">{fmt(bet * prefs.tp)}</span>, a <span className="tnum font-extrabold text-ink">{fmtPct(moveFor(lev, prefs.tp))}</span> move your way
          </div>
        </div>
      )}
      <div className="h-px bg-white/[.05]" />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-ink">Stop loss</div>
          {!prefs.slOn && <div className="text-[11px] font-semibold text-dim">Cut a loser before liquidation</div>}
        </div>
        <Toggle on={prefs.slOn} onChange={(v) => set({ slOn: v })} label="Stop loss" />
      </div>
      {prefs.slOn && (
        <div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1">
            <NumberField value={prefs.sl} min={SL_RANGE.min} max={SL_RANGE.max} onCommit={(v) => set({ sl: Math.round(v * 100) / 100 })} suffix="×" />
            {[0.8, 0.5, 0.3].map((v) => (
              <Quick key={v} on={prefs.sl === v} onClick={() => set({ sl: v })}>
                {v}×
              </Quick>
            ))}
          </div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-dim">
            At <span className="tnum font-extrabold text-gold">{fmt(bet * prefs.sl)}</span>, a <span className="tnum font-extrabold text-ink">{fmtPct(-moveFor(lev, prefs.sl))}</span> move against you
          </div>
        </div>
      )}
    </div>
  )
}

const Arrow = ({ up }: { up: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="11" fill={up ? 'rgba(3,36,18,.18)' : 'rgba(255,255,255,.18)'} />
    <path d={up ? 'M12 6.5 6.8 13h3.6v4.5h3.2V13h3.6Z' : 'M12 17.5 6.8 11h3.6V6.5h3.2V11h3.6Z'} fill="currentColor" />
  </svg>
)

function TradeButton({ side, onClick, disabled, sub }: { side: Side; onClick: () => void; disabled: boolean; sub: ReactNode }) {
  const up = side === 'up'
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.96, y: 2 }}
      whileHover={disabled ? undefined : { y: -1 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={up ? 'Open an Up position' : 'Open a Down position'}
      className={`relative flex min-h-[66px] flex-col items-center justify-center overflow-hidden rounded-xl px-2 transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100 ${
        up
          ? 'bg-[linear-gradient(180deg,#46f394,#1dbd62)] text-[#032412] shadow-[0_10px_24px_-12px_rgba(34,211,111,.9),inset_0_-4px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.45)]'
          : 'bg-[linear-gradient(180deg,#ff6f7f,#e3324c)] text-white shadow-[0_10px_24px_-12px_rgba(255,77,97,.9),inset_0_-4px_0_rgba(0,0,0,.2),inset_0_1px_0_rgba(255,255,255,.35)]'
      }`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />
      <span className="relative flex items-center gap-1.5 text-[19px] font-black leading-none">
        <Arrow up={up} />
        {up ? 'Up' : 'Down'}
      </span>
      <span className="tnum relative mt-1 text-[11.5px] font-bold opacity-80">{sub}</span>
    </motion.button>
  )
}

export function TradeButtons({ leverage, onTrade, blocked }: { leverage: number; onTrade: (s: Side) => void; blocked: string | null }) {
  const price = useView((s) => s.price)
  const room = liqMove(leverage)
  return (
    <div className="grid grid-cols-2 gap-2">
      <TradeButton side="up" onClick={() => onTrade('up')} disabled={!!blocked} sub={blocked ?? `Liq ${fmtPrice(price * (1 - room))}`} />
      <TradeButton side="down" onClick={() => onTrade('down')} disabled={!!blocked} sub={blocked ?? `Liq ${fmtPrice(price * (1 + room))}`} />
    </div>
  )
}

const REASON: Record<Trade['reason'], string> = { manual: '', takeProfit: 'TP', stopLoss: 'SL', liquidated: 'LIQ', cap: 'MAX', left: 'Left' }

export function TradeList({ limit }: { limit: number }) {
  const trades = useView((s) => s.trades)
  const shown = trades.slice(0, limit)
  const net = shown.reduce((a, t) => a + t.payout - t.stake, 0)
  return (
    <div className="rounded-lg bg-stage p-1.5">
      <div className="flex items-center justify-between px-1.5 pb-1 pt-1">
        <span className="text-[10.5px] font-black uppercase tracking-[0.14em] text-dim">Recent trades</span>
        {shown.length > 0 && <span className={`tnum text-[11.5px] font-extrabold ${net >= 0 ? 'text-accent' : 'text-danger'}`}>{signed(net)}</span>}
      </div>
      {!shown.length && <div className="px-1.5 pb-2 text-[12px] font-semibold text-dim">Your closed positions show here.</div>}
      {shown.map((t) => {
        const n = t.payout - t.stake
        const mult = t.payout / t.stake
        return (
          <div key={t.id} className="grid grid-cols-[52px_1fr_auto_64px] items-center gap-1.5 rounded-md px-1.5 py-[5px] text-[12px] odd:bg-white/[.025]">
            <span className={`text-[11px] font-black ${t.side === 'up' ? 'text-accent' : 'text-danger'}`}>
              {t.side === 'up' ? '▲' : '▼'} {t.leverage}×
            </span>
            <span className="tnum truncate font-semibold text-muted">{fmt(t.stake)}</span>
            <span className="tnum flex items-center gap-1 font-extrabold text-ink/85">
              {REASON[t.reason] && <span className={`rounded px-1 text-[9px] font-black ${t.reason === 'liquidated' ? 'bg-danger/20 text-danger' : 'bg-white/10 text-muted'}`}>{REASON[t.reason]}</span>}
              {mult.toFixed(2)}×
            </span>
            <span className={`tnum text-right font-extrabold ${n > 0 ? 'text-accent' : n < 0 ? 'text-danger/90' : 'text-muted'}`}>{signed(n)}</span>
          </div>
        )
      })}
    </div>
  )
}
