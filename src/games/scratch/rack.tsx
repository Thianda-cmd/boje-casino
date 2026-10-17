import { memo } from 'react'
import { motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { round2 } from '../../lib/format'
import { CARDS, coinLabel, hitChance, maxMult, oddsLabel, topPrize, type CardId } from './rules'
import { CardThumb, THEMES } from './cardart'
import { SymbolArt } from './symbols'

/*
  The card rack. On a wide stage it is a column of tiles, each a little fanned stack of that card with its hero symbol,
  its name, a risk meter, the top prize in coins at the current price and how often it wins. On a narrow stage the
  cards are a row of chips; on a short landscape one, a column of chips.
*/

/** short names for the chips */
export const SHORT: Record<CardId, string> = { clover: 'Clover', gold: 'Gold', fruit: 'Fruit', diamond: 'Diamond' }

/** the most a card can pay at a price, in coins */
export const topCoins = (id: CardId, price: number) => round2(price * maxMult(CARDS[id]))

/** one to four bars, lit up to the card's risk */
export function RiskMeter({ id, on = true, size = 'md' }: { id: CardId; on?: boolean; size?: 'sm' | 'md' }) {
  const c = CARDS[id]
  const col = on ? THEMES[id].table.edge : '#6f879b'
  const h = size === 'sm' ? [4, 6, 8, 10] : [5, 7.5, 10, 12.5]
  return (
    <span className="inline-flex items-end gap-[2px]" aria-label={`${c.risk} risk`} role="img">
      {h.map((v, i) => (
        <span key={i} className="rounded-[1.5px]" style={{ width: size === 'sm' ? 3 : 3.5, height: v, background: i < c.riskLevel ? col : 'rgba(255,255,255,.14)' }} />
      ))}
    </span>
  )
}

/** a small fanned stack of the card with its hero symbol in front */
const Stack = memo(function Stack({ id, on, size = 40 }: { id: CardId; on: boolean; size?: number }) {
  const hero = topPrize(CARDS[id]).sym
  return (
    <div className="relative shrink-0" style={{ width: size + 14, height: size * 1.4 + 6 }}>
      <div className="absolute left-[7px] top-[3px] opacity-60" style={{ transform: `rotate(${on ? -14 : -9}deg)`, transformOrigin: '50% 90%', transition: 'transform .35s cubic-bezier(.3,1.4,.5,1)' }}>
        <CardThumb id={id} size={size} />
      </div>
      <div className="absolute left-[7px] top-[3px] opacity-80" style={{ transform: `rotate(${on ? -6 : -4}deg)`, transformOrigin: '50% 90%', transition: 'transform .35s cubic-bezier(.3,1.4,.5,1)' }}>
        <CardThumb id={id} size={size} />
      </div>
      <div className="absolute left-[7px] top-[3px]" style={{ transform: on ? 'rotate(4deg) translateY(-2px)' : 'none', transformOrigin: '50% 90%', transition: 'transform .35s cubic-bezier(.3,1.4,.5,1)' }}>
        <CardThumb id={id} size={size} />
      </div>
      <div className="absolute -bottom-1 -right-1 drop-shadow-[0_3px_3px_rgba(0,0,0,.5)]">
        <SymbolArt sym={hero} size={size * 0.72} />
      </div>
    </div>
  )
})

/** a card in the rack (wide stages) */
export function RackTile({ id, on, price, disabled, onPick }: { id: CardId; on: boolean; price: number; disabled: boolean; onPick: () => void }) {
  const c = CARDS[id]
  const t = THEMES[id]
  return (
    <motion.button
      onClick={onPick}
      disabled={disabled}
      aria-pressed={on}
      whileHover={disabled || on ? undefined : { x: 3 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      className={`relative flex items-center gap-2.5 rounded-xl py-2 pl-1.5 pr-2.5 text-left backdrop-blur-[2px] transition-[background,box-shadow,opacity] disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-[#0b1822]/80' : 'bg-[#0b1822]/55 hover:bg-[#0b1822]/75'}`}
      style={{ boxShadow: on ? `inset 0 0 0 2px ${t.table.edge}, 0 12px 28px -14px ${t.table.edge}` : 'inset 0 0 0 1px rgba(255,255,255,.07)' }}
    >
      <Stack id={id} on={on} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-extrabold text-ink">{c.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: on ? t.table.edge : '#7f97ab' }}>
          <RiskMeter id={id} on={on} size="sm" />
          {c.risk}
        </div>
        <div className="tnum mt-1 flex items-center gap-1 text-[12px] font-extrabold text-gold">
          <span className="text-[10.5px] font-bold text-dim">Top</span> {coinLabel(topCoins(id, price))} <Coin size={11} />
        </div>
        <div className="tnum text-[11px] font-semibold text-muted">Wins {oddsLabel(hitChance(c))}</div>
      </div>
    </motion.button>
  )
}

/** a card in the rack (narrow stages): its hero symbol, short name and top prize in coins */
export function RackChip({ id, on, price, disabled, onPick, tall }: { id: CardId; on: boolean; price: number; disabled: boolean; onPick: () => void; tall?: boolean }) {
  const c = CARDS[id]
  const t = THEMES[id]
  return (
    <button
      onClick={onPick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={`${c.name}, ${c.risk.toLowerCase()} risk, top prize ${coinLabel(topCoins(id, price))}`}
      className={`flex min-w-0 items-center gap-[3px] rounded-lg pl-1 pr-1 transition disabled:opacity-40 ${tall ? 'h-[46px]' : 'h-[44px]'} ${on ? 'bg-[#0b1822]/85' : 'bg-[#0b1822]/55'}`}
      style={{ boxShadow: on ? `inset 0 0 0 2px ${t.table.edge}` : 'inset 0 0 0 1px rgba(255,255,255,.07)' }}
    >
      <span className="shrink-0" style={{ transform: on ? 'scale(1.08) rotate(-6deg)' : 'none', transition: 'transform .3s cubic-bezier(.3,1.4,.5,1)' }}>
        <SymbolArt sym={topPrize(c).sym} size={22} />
      </span>
      <span className="min-w-0 flex-1 text-left leading-[1.15]">
        <span className="block truncate text-[10.5px] font-extrabold tracking-[-.02em]" style={{ color: on ? '#fff' : '#c4d3e0' }}>
          {SHORT[id]}
        </span>
        <span className="tnum block truncate text-[10px] font-bold" style={{ color: on ? t.table.edge : '#8aa1b4' }}>
          {coinLabel(topCoins(id, price))}
        </span>
      </span>
    </button>
  )
}
