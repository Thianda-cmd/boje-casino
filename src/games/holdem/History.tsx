import { HistoryPills, type PillTone } from '../../components/ui'
import { fmt, round2 } from '../../lib/format'
import type { History as Hist, PastHand } from './storage'
import { isBigHand, shortName } from './words'

/*
  The player's recent hands as a strip of pills, newest first ("+125 Flush", "−50 Pair", "Fold −20"), coloured by what
  each came to, and three simple stats: hands played, hands won, and the best hand made. Kept per player
  (storage.ts), so they survive a reload.
*/

const money = (v: number) => fmt(Math.abs(v), Math.abs(v) % 1 ? 2 : 0)

function pill(h: PastHand): { key: number; label: string; tone: PillTone } {
  const net = round2(h.ret - h.stake)
  const sign = net > 0 ? '+' : net < 0 ? '−' : ''
  // coloured by what the hand came to (a won hand can still lose on Trips; a fold can win on it)
  const tone: PillTone = net > 0 ? (isBigHand(h.rank) && h.outcome !== 'fold' ? 'gold' : 'win') : net < 0 ? 'loss' : 'neutral'
  if (h.outcome === 'fold') return { key: h.id, label: `Fold ${sign}${money(net)}`, tone }
  if (h.outcome === 'push' && !net) return { key: h.id, label: `Push · ${shortName(h.rank)}`, tone }
  return { key: h.id, label: `${sign}${money(net)} ${shortName(h.rank)}`, tone }
}

export function HistoryPanel({ hist }: { hist: Hist }) {
  const s = hist.stats
  return (
    <div className="rounded-lg bg-stage px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-muted">
        <span>Recent hands</span>
        {s.hands > 0 && <span className="tnum text-dim">{s.hands} played</span>}
      </div>
      {hist.list.length ? (
        <HistoryPills items={hist.list.slice(0, 10).map(pill)} />
      ) : (
        <div className="text-[12px] font-semibold text-dim">No hands yet. Your results show here.</div>
      )}
      {s.hands > 0 && (
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          <Stat label="Hands" value={fmt(s.hands, 0)} />
          <Stat label="Won" value={`${fmt(s.won, 0)} · ${Math.round((s.won / s.hands) * 100)}%`} />
          <Stat label="Best hand" value={s.best ? shortName(s.best) : '–'} gold={!!s.best && isBigHand(s.best)} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold text-dim">{label}</div>
      <div className={`tnum truncate text-[13px] font-extrabold ${gold ? 'text-gold' : 'text-ink'}`}>{value}</div>
    </div>
  )
}
