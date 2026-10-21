import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { FEE, LIQ, liqPrice, payoutAt, valueAt, type CloseReason, type Position } from './rules'
import { MAX_OPEN, useView } from './desk'
import { fmtPct, fmtPrice, liqMove, signed } from './levels'

/*
  The open positions, as cards along the foot of the stage, oldest first. A card shows its side and leverage, its
  stake, its value as a multiple of the stake with the profit or loss in coins, how much room it has left before
  liquidation (a bar that runs out, red and pulsing near the end), and a Close button with what closing pays now,
  which glows while that is more than the stake. A card that closes turns, in place, into its result (Closed, Take
  profit, Stop loss, Liquidated) for a moment before it goes. With two or more open, a summary leads the row with the
  total profit or loss and Close all. With none, the row says how to play and what the current settings risk.
*/

/** a position just closed, shown in its card's place for a moment */
export interface Ghost {
  pos: Position
  reason: CloseReason
  payout: number
}

const UP = '#22d36f'
const DOWN = '#ff4d61'

function SideChip({ p, compact }: { p: Position; compact: boolean }) {
  const up = p.side === 'up'
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-md font-black uppercase leading-none tracking-wide ${compact ? 'px-1.5 py-1 text-[10px]' : 'px-1.5 py-[5px] text-[10.5px]'}`}
      style={{ background: up ? 'rgba(34,211,111,.16)' : 'rgba(255,77,97,.16)', color: up ? UP : DOWN }}
    >
      <span className="text-[8px]">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {p.leverage}×
    </span>
  )
}

const Card = memo(function Card({ p, compact, focused, onClose, onFocus }: { p: Position; compact: boolean; focused: boolean; onClose: (id: string) => void; onFocus: (id: string | null) => void }) {
  const price = useView((s) => s.price)
  const v = valueAt(p, price)
  const mult = v / p.stake
  const pay = payoutAt(p, price, 'manual')
  const pnl = pay - p.stake
  const margin = 1 - FEE
  // the room left before liquidation: 1 at the entry (and better), 0 on the line
  const room = Math.max(0, Math.min(1, (mult - LIQ) / (margin - LIQ)))
  const danger = room < 0.25
  const profit = pnl > 0
  const col = mult >= margin ? UP : danger ? DOWN : '#ffb648'
  return (
    <div
      onMouseEnter={() => onFocus(p.id)}
      onMouseLeave={() => onFocus(null)}
      className={`relative flex h-full w-full gap-2 overflow-hidden rounded-xl p-2 ring-1 transition-shadow ${focused ? 'ring-white/25' : 'ring-white/10'} ${danger ? 'shadow-[inset_0_0_24px_rgba(255,77,97,.28)]' : ''}`}
      style={{ background: 'linear-gradient(180deg,#142a38 0%,#0e1f2b 100%)' }}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: p.side === 'up' ? UP : DOWN }} />
      <div className="flex min-w-0 flex-1 flex-col justify-between pl-1">
        <div className="flex items-center gap-1">
          <SideChip p={p} compact={compact} />
          {p.takeProfit && <span className="shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[8.5px] font-black tracking-wide text-accent">TP</span>}
          {p.stopLoss && <span className="shrink-0 rounded bg-gold/15 px-1 py-0.5 text-[8.5px] font-black tracking-wide text-gold">SL</span>}
          <span className="tnum ml-auto flex min-w-0 items-center gap-1 truncate text-[11px] font-bold text-muted">
            {fmt(p.stake)} <Coin size={11} />
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={`tnum font-black leading-none tracking-tight ${compact ? 'text-[19px]' : 'text-[21px]'}`} style={{ color: col }}>
            {mult >= 100 ? fmt(mult, 0) : mult.toFixed(2)}×
          </span>
          <span className={`tnum truncate text-[11.5px] font-extrabold ${pnl >= 0 ? 'text-accent' : 'text-danger'}`}>{signed(pnl)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/10" title="Room before liquidation">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${room * 100}%`, background: room > 0.6 ? UP : room > 0.3 ? '#ffb648' : DOWN }}
              animate={danger ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
              transition={danger ? { duration: 0.6, repeat: Infinity } : undefined}
            />
          </div>
          <span className="tnum shrink-0 text-[9.5px] font-bold text-dim">LIQ {fmtPrice(liqPrice(p))}</span>
        </div>
      </div>
      <motion.button
        onClick={() => onClose(p.id)}
        whileTap={{ scale: 0.94 }}
        animate={profit ? { boxShadow: ['0 0 0 0 rgba(34,211,111,.0)', '0 0 16px 2px rgba(34,211,111,.55)', '0 0 0 0 rgba(34,211,111,.0)'] } : { boxShadow: '0 0 0 0 rgba(0,0,0,0)' }}
        transition={profit ? { duration: 1.1, repeat: Infinity } : { duration: 0.2 }}
        className={`flex shrink-0 flex-col items-center justify-center rounded-lg leading-none transition-colors ${compact ? 'w-[62px]' : 'w-[70px]'} ${
          profit ? 'bg-accent text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16)]' : 'bg-raised text-ink shadow-[inset_0_-3px_0_rgba(0,0,0,.2)] hover:bg-hover'
        }`}
        aria-label={`Close ${p.side === 'up' ? 'Up' : 'Down'} ${p.leverage}× position for ${fmt(pay)} coins`}
      >
        <span className={`font-black ${compact ? 'text-[12.5px]' : 'text-[13.5px]'}`}>Close</span>
        <span className="tnum mt-1 text-[11px] font-extrabold opacity-80">{fmt(pay)}</span>
      </motion.button>
    </div>
  )
})

const STAMP: Record<CloseReason, { text: string; color: string }> = {
  manual: { text: 'Closed', color: '#e6eef5' },
  takeProfit: { text: 'Take profit', color: UP },
  stopLoss: { text: 'Stop loss', color: '#f7c548' },
  liquidated: { text: 'Liquidated', color: DOWN },
  cap: { text: 'Max win', color: '#f7c548' },
  left: { text: 'Closed', color: '#e6eef5' },
}

function GhostCard({ g, compact }: { g: Ghost; compact: boolean }) {
  const s = STAMP[g.reason]
  const net = g.payout - g.pos.stake
  const liq = g.reason === 'liquidated'
  const won = net > 0
  return (
    <motion.div
      initial={{ scale: 0.96 }}
      animate={liq ? { scale: 1, x: [0, -5, 5, -3, 3, 0] } : { scale: [0.96, 1.03, 1] }}
      transition={{ duration: 0.45 }}
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-xl"
      style={{
        background: liq ? 'linear-gradient(180deg,#3a0f18,#220810)' : won ? 'linear-gradient(180deg,#0f3a28,#0a2419)' : 'linear-gradient(180deg,#1a2a36,#111e28)',
        boxShadow: `inset 0 0 0 2px ${liq ? 'rgba(255,77,97,.7)' : won ? 'rgba(34,211,111,.7)' : 'rgba(255,255,255,.15)'}${won ? ', 0 0 22px -4px rgba(34,211,111,.55)' : ''}`,
      }}
    >
      <motion.span
        initial={{ scale: 2.2, opacity: 0, rotate: -14 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ type: 'spring', stiffness: 520, damping: 18 }}
        className={`rounded-md border-2 px-2 py-0.5 font-black uppercase italic leading-none tracking-[0.1em] ${compact ? 'text-[12px]' : 'text-[13.5px]'}`}
        style={{ color: s.color, borderColor: s.color }}
      >
        {s.text}
      </motion.span>
      <span className={`tnum mt-1.5 flex items-center gap-1 font-black leading-none ${compact ? 'text-[16px]' : 'text-[18px]'} ${won ? 'text-accent' : liq ? 'text-danger' : 'text-ink'}`}>
        {signed(net)} <Coin size={compact ? 13 : 15} />
      </span>
      <span className="tnum mt-1 text-[10.5px] font-bold text-white/55">
        {g.pos.side === 'up' ? '▲ Up' : '▼ Down'} {g.pos.leverage}× · {(g.payout / g.pos.stake).toFixed(2)}×
      </span>
    </motion.div>
  )
}

export function Positions({
  ghosts,
  compact,
  focus,
  onClose,
  onCloseAll,
  onFocus,
  bet,
  leverage,
}: {
  ghosts: readonly Ghost[]
  compact: boolean
  focus: string | null
  onClose: (id: string) => void
  onCloseAll: () => void
  onFocus: (id: string | null) => void
  bet: number
  leverage: number
}) {
  const positions = useView((s) => s.positions)
  const price = useView((s) => (positions.length > 1 ? s.price : 0))
  const items = [...positions.map((p) => ({ key: p.id, at: p.at, p, g: null as Ghost | null })), ...ghosts.filter((g) => !positions.some((p) => p.id === g.pos.id)).map((g) => ({ key: g.pos.id, at: g.pos.at, p: null as Position | null, g }))].sort((a, b) => a.at - b.at)
  const total = positions.length > 1 ? positions.reduce((a, p) => a + payoutAt(p, price, 'manual') - p.stake, 0) : 0
  const cardW = compact ? 'w-[214px]' : 'min-w-[172px] max-w-[236px] flex-1 basis-0'
  return (
    <div className={`absolute inset-x-0 bottom-0 z-20 border-t border-white/[.06] bg-[linear-gradient(180deg,#0a1721,#08131b)] ${compact ? 'h-[90px]' : 'h-[104px]'}`}>
      <div className={`no-scrollbar flex h-full items-stretch overflow-x-auto ${compact ? 'snap-x gap-1.5 px-2 py-2' : 'gap-2 px-3 py-2.5'}`}>
        <AnimatePresence initial={false}>
          {positions.length > 1 && (
            <motion.div
              key="summary"
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={`flex shrink-0 snap-start flex-col justify-between rounded-xl bg-black/25 p-2 ring-1 ring-white/[.07] ${compact ? 'w-[92px]' : 'w-[118px]'}`}
            >
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-dim">
                Open {positions.length}/{MAX_OPEN}
              </div>
              <div className={`tnum font-black leading-none ${compact ? 'text-[14px]' : 'text-[17px]'} ${total >= 0 ? 'text-accent' : 'text-danger'}`}>{signed(total)}</div>
              <button onClick={onCloseAll} className="h-7 rounded-md bg-raised text-[11.5px] font-extrabold text-ink transition hover:bg-hover active:scale-95">
                Close all
              </button>
            </motion.div>
          )}
          {items.map((it) => (
            <motion.div
              key={it.key}
              layout
              initial={{ opacity: 0, y: 26, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.92, transition: { duration: 0.25 } }}
              transition={{ type: 'spring', stiffness: 460, damping: 30 }}
              className={`${cardW} shrink-0 snap-start`}
            >
              {it.p ? <Card p={it.p} compact={compact} focused={focus === it.p.id} onClose={onClose} onFocus={onFocus} /> : <GhostCard g={it.g!} compact={compact} />}
            </motion.div>
          ))}
          {!items.length && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-dashed border-white/10 px-3.5">
              <svg width={compact ? 26 : 32} height={compact ? 26 : 32} viewBox="0 0 32 32" aria-hidden className="shrink-0">
                <rect x="1" y="1" width="30" height="30" rx="9" fill="rgba(0,209,160,.1)" stroke="rgba(0,209,160,.35)" />
                <path d="M9 14.5 13 10.5l4 4M23 17.5 19 21.5l-4-4" fill="none" stroke="#00d1a0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="min-w-0 leading-snug">
                <div className={`font-extrabold text-ink ${compact ? 'text-[12.5px]' : 'text-[14px]'}`}>No open positions</div>
                <div className={`text-muted ${compact ? 'text-[11px]' : 'text-[12px]'} font-semibold`}>
                  {compact ? 'Up wins if the price rises, Down if it falls.' : 'Up wins when the price rises, Down when it falls. Close whenever you like to take what it is worth.'}
                </div>
              </div>
              {!compact && (
                <div className="ml-auto shrink-0 rounded-lg bg-black/25 px-3 py-2 text-right ring-1 ring-white/[.06]">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-dim">Next order</div>
                  <div className="tnum text-[12.5px] font-extrabold text-ink">
                    {fmt(bet)} at {leverage}× · liquidated by a {fmtPct(liqMove(leverage))} move
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
