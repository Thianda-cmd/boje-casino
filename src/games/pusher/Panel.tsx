import { useRef } from 'react'
import { Label, Toggle } from '../../components/ui'
import { sfx } from '../../lib/sound'
import { UPPER_FRONT_Z } from './geom'
import { PAYTABLE, oddsLabel } from './rules'
import { ItemGlyph } from './art'
import { VALUE, type Field, type ItemKind } from './types'
import { NAME, isPrize, multText } from './words'

/*
  Coin Cascade's controls and panels beside the machine: the aim rail under the machine (drag the coin along the slot,
  or ← →), what is on the field (the five prizes, which tier each is on, and the coins), the paytable (what each thing
  pays and the chance of at least one going over in a drop, the chance of any win, of a Coin Shower and of a Quake,
  and the top win), and Auto's extra stops (after a win of so much, or on any prize).
*/

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** where the aim points, in words */
export const aimText = (a: number) => (Math.abs(a) < 0.05 ? 'Centre' : `${a < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(a) * 100)}%`)

/* ---------------- the aim ---------------- */

/** the slot rail under the machine: the coin rides it, wherever the player drags it (← → too) */
export function AimBar({ aim, onAim, compact }: { aim: number; onAim: (a: number) => void; compact: boolean }) {
  const rail = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const PAD = 16
  const at = (clientX: number) => {
    const r = rail.current?.getBoundingClientRect()
    if (!r) return
    onAim(Math.round(clamp(((clientX - r.left - PAD) / Math.max(1, r.width - PAD * 2)) * 2 - 1, -1, 1) * 100) / 100)
  }
  return (
    <div className="relative z-10 flex h-[50px] shrink-0 items-center gap-2.5 border-t border-white/[.07] bg-[linear-gradient(180deg,#0c1338,#080c26)] px-3 sm:h-[54px] sm:gap-3 sm:px-4">
      <span className="text-[10.5px] font-black uppercase tracking-[0.16em] text-[#5ff6ea]/85">Aim</span>
      <div
        ref={rail}
        role="slider"
        tabIndex={0}
        aria-label="Aim: where your coin drops in"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(aim * 100)}
        aria-valuetext={aimText(aim)}
        className="relative h-10 min-w-0 flex-1 cursor-grab touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#5ff6ea]/60 active:cursor-grabbing"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          at(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && at(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {/* the slot */}
        <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full border border-[#ffd23a]/70 bg-[#02041a] shadow-[inset_0_1px_4px_rgba(0,0,0,.9),0_0_12px_rgba(255,210,58,.28)]" style={{ left: PAD - 6, right: PAD - 6 }} />
        {[-1, -0.5, 0, 0.5, 1].map((t) => (
          <span key={t} className={`absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${t === 0 ? 'bg-[#ffd23a]' : 'bg-[#ffd23a]/45'}`} style={{ left: `calc(${PAD}px + (100% - ${PAD * 2}px) * ${(t + 1) / 2})` }} />
        ))}
        {/* the coin */}
        <div className="pointer-events-none absolute top-1/2" style={{ left: `calc(${PAD}px + (100% - ${PAD * 2}px) * ${(aim + 1) / 2})`, transform: 'translate(-50%, -50%)' }}>
          <ItemGlyph kind="silver" size={compact ? 28 : 31} className="drop-shadow-[0_0_9px_rgba(95,246,234,.7)]" />
        </div>
      </div>
      <span className="tnum w-[64px] shrink-0 text-right text-[11.5px] font-bold text-white/60 sm:w-[72px] sm:text-[12px]">{aimText(aim)}</span>
      {!compact && <span className="hidden max-w-[210px] text-[11px] font-semibold leading-tight text-white/40 xl:block">← → to aim. Aim moves where your coin lands, never what a drop pays.</span>}
    </div>
  )
}

/* ---------------- what's on the field ---------------- */

/** the prizes on the field (and the coins): `gone` ones have gone over the edge in the drop on show, `fresh` ones just dropped in */
export function FieldStrip({ field, gone, fresh }: { field: Field; gone: ReadonlySet<number>; fresh: ReadonlySet<number> }) {
  let silver = 0
  let gold = 0
  const prizes: Field['items'] = []
  for (const it of field.items) {
    if (it.kind === 'silver') silver++
    else if (it.kind === 'gold') gold++
    else prizes.push(it)
  }
  prizes.sort((a, b) => VALUE[b.kind] - VALUE[a.kind] || a.id - b.id)
  return (
    <div className="rounded-xl bg-stage p-3 ring-1 ring-white/[.04]">
      <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-muted">
        <span>On the field</span>
        <span className="tnum text-[11.5px] text-dim">
          {silver + gold} coins · <span className="text-gold/80">{gold} gold</span>
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {prizes.map((p) => {
          const out = gone.has(p.id)
          const upper = p.z < UPPER_FRONT_Z
          return (
            <div
              key={p.id}
              title={`${NAME[p.kind]} (pays ${multText(VALUE[p.kind])}): ${out ? 'over the edge!' : `on the ${upper ? 'upper' : 'lower'} tier`}`}
              className={`relative flex flex-col items-center rounded-lg bg-panel2 pb-1 pt-1.5 transition ${out ? 'ring-2 ring-gold' : ''}`}
            >
              <ItemGlyph kind={p.kind} size={26} className={out ? 'opacity-40' : ''} />
              <span className="tnum mt-0.5 text-[11px] font-black leading-tight text-gold">{multText(VALUE[p.kind])}</span>
              <span className={`text-[9.5px] font-extrabold uppercase leading-tight tracking-wide ${out ? 'text-gold' : 'text-dim'}`}>{out ? 'Won!' : upper ? 'Upper' : 'Lower'}</span>
              {fresh.has(p.id) && !out && <span className="absolute -right-1 -top-1.5 rounded-full bg-accent px-1 text-[8.5px] font-black uppercase leading-[14px] text-[#032412]">New</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- the paytable ---------------- */

export function Paytable({ onInfo }: { onInfo: () => void }) {
  const rows = [...PAYTABLE.rows].reverse()
  return (
    <div className="rounded-xl bg-stage p-3 ring-1 ring-white/[.04]">
      <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-muted">
        <span>Paytable</span>
        <button onClick={() => (sfx.click(), onInfo())} className="text-dim transition hover:text-ink">
          How it works · fairness
        </button>
      </div>
      <div className="grid grid-cols-[24px_1fr_auto_auto] items-center gap-x-2 gap-y-[3px] text-[12.5px]">
        <span />
        <span className="text-[10px] font-bold uppercase tracking-wider text-dim">Over the edge</span>
        <span className="text-right text-[10px] font-bold uppercase tracking-wider text-dim">Pays</span>
        <span className="w-[66px] text-right text-[10px] font-bold uppercase tracking-wider text-dim">A drop</span>
        {rows.map((r) => (
          <Row key={r.kind} kind={r.kind} value={r.value} chance={r.chance} />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-1 text-center">
        {[
          ['Any win', oddsLabel(PAYTABLE.anyWin)],
          ['Top win', multText(PAYTABLE.top)],
          ['Shower', oddsLabel(PAYTABLE.shower)],
          ['Quake', oddsLabel(PAYTABLE.quake)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-panel2 px-0.5 py-1">
            <div className="text-[10px] font-semibold leading-tight text-dim">{k}</div>
            <div className="tnum whitespace-nowrap text-[11.5px] font-extrabold leading-tight">{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ kind, value, chance }: { kind: ItemKind; value: number; chance: number }) {
  return (
    <>
      <ItemGlyph kind={kind} size={22} />
      <span className={`truncate font-bold ${isPrize(kind) ? 'text-ink' : 'text-ink/80'}`}>{NAME[kind]}</span>
      <span className="tnum text-right font-black text-gold">{multText(value)}</span>
      <span className="tnum w-[66px] text-right text-[11.5px] font-bold text-muted">{oddsLabel(chance)}</span>
    </>
  )
}

/* ---------------- Auto's stops ---------------- */

export interface Stops {
  /** stop after a drop that wins at least this many times the stake (0: never) */
  win: number
  /** stop after a drop that brings a prize (a gem or better) */
  prize: boolean
}

export function AutoStops({ stops, onChange, disabled }: { stops: Stops; onChange: (s: Stops) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label>Stop after a win of</Label>
        <div className={`grid grid-cols-5 gap-1 ${disabled ? 'opacity-60' : ''}`}>
          {[0, 2, 5, 25, 100].map((m) => (
            <button
              key={m}
              disabled={disabled}
              onClick={() => (sfx.click(), onChange({ ...stops, win: m }))}
              aria-pressed={stops.win === m}
              className={`tnum h-9 rounded-md text-[12.5px] font-extrabold transition disabled:pointer-events-none ${stops.win === m ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}
            >
              {m === 0 ? 'Off' : `${m}×+`}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2">
        <div className="text-[13px] font-bold">
          Stop on a prize <span className="text-[11px] font-semibold text-dim">(a gem or better)</span>
        </div>
        <Toggle on={stops.prize} onChange={(v) => onChange({ ...stops, prize: v })} disabled={disabled} label="Stop on a prize" />
      </div>
    </div>
  )
}
