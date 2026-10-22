import { memo } from 'react'
import { motion } from 'framer-motion'
import { fighter, sideId } from './rules'
import { KaijuPortrait } from './portraits'
import { BuildingMark, METHOD_COLOR, MethodMark } from './art'
import type { PastFight, Standing } from './live'

/*
  The record book. The history strip: the last results, newest first, each the winner's portrait with how it won (a
  fist, a wave, a scorecard), the round it ended in and the buildings it flattened; a tap opens that round's fairness
  check. The standings: every kaiju over the last 50 fights, best record first, with its wins by knockout, Splash
  and decision and its last five.
*/

const how = (p: PastFight) => (p.result.method === 'dec' ? 'on points' : `by ${p.result.method === 'ko' ? 'KO' : 'Splash'} in round ${p.result.round}`)
const describe = (p: PastFight) => {
  const w = fighter(sideId(p.matchup, p.result.winner)).name
  const l = fighter(sideId(p.matchup, p.result.winner === 'a' ? 'b' : 'a')).name
  return `Fight #${p.id}: ${w} beat ${l} ${how(p)}, ${p.result.damage} building${p.result.damage === 1 ? '' : 's'} flattened`
}

export const HistoryStrip = memo(function HistoryStrip({ items, onPick, limit = 24 }: { items: PastFight[]; onPick: (id: number) => void; limit?: number }) {
  const list = items.slice(0, limit)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-dim">Last</span>
      <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1" data-history>
        {!list.length && <span className="py-1.5 text-[12px] text-dim">The first results of the night will show here.</span>}
        {list.map((p, i) => {
          const w = sideId(p.matchup, p.result.winner)
          return (
            <motion.button
              key={p.id}
              onClick={() => onPick(p.id)}
              title={describe(p)}
              aria-label={describe(p)}
              initial={i === 0 ? { opacity: 0, scale: 0.6 } : false}
              animate={{ opacity: 1, scale: 1 }}
              className="group flex shrink-0 items-center gap-1 rounded-full bg-black/30 py-0.5 pl-0.5 pr-2 ring-1 ring-white/[.04] transition hover:bg-black/50"
            >
              <span className="relative">
                <KaijuPortrait id={w} size={26} mood="win" bg className="rounded-full" />
                <span className="absolute -bottom-1 -right-1 rounded-full bg-[#0a1620] p-[1px]">
                  <MethodMark method={p.result.method} size={12} />
                </span>
              </span>
              <span className="tnum ml-0.5 text-[11px] font-black" style={{ color: METHOD_COLOR[p.result.method] }}>
                {p.result.method === 'dec' ? 'DEC' : `R${p.result.round}`}
              </span>
              <span className="tnum flex items-center gap-0.5 text-[10.5px] font-bold text-white/55">
                <BuildingMark size={10} />
                {p.result.damage}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
})

export const Standings = memo(function Standings({ rows, fights }: { rows: Standing[]; fights: number }) {
  return (
    <div className="overflow-hidden rounded-xl bg-stage">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5 text-[12px] font-bold text-muted">
        <span>Standings</span>
        <span className="text-dim">last {fights} fights</span>
      </div>
      <table className="w-full text-[12px]">
        <thead className="text-[10px] font-black uppercase tracking-[.08em] text-dim">
          <tr>
            <th className="px-3 py-1 text-left font-black">Kaiju</th>
            <th className="px-1 py-1 text-right font-black">W–L</th>
            <th className="px-1 py-1 text-right font-black" title="Wins by knockout">KO</th>
            <th className="px-1 py-1 text-right font-black" title="Wins by Splash">Spl</th>
            <th className="px-1 py-1 text-right font-black" title="Wins on the judges' cards">Dec</th>
            <th className="hidden px-3 py-1 text-right font-black sm:table-cell">Form</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-t border-line/70" data-standing={r.id}>
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <span className="tnum w-3 text-right text-[10.5px] font-bold text-dim">{i + 1}</span>
                  <KaijuPortrait id={r.id} size={22} bg className="rounded-md" />
                  <span className="truncate font-extrabold text-ink">{fighter(r.id).name}</span>
                </span>
              </td>
              <td className="tnum px-1 py-1.5 text-right font-bold text-ink">
                {r.wins}–{r.losses}
              </td>
              <td className="tnum px-1 py-1.5 text-right font-semibold" style={{ color: r.ko ? METHOD_COLOR.ko : undefined }}>
                {r.ko}
              </td>
              <td className="tnum px-1 py-1.5 text-right font-semibold" style={{ color: r.splash ? METHOD_COLOR.splash : undefined }}>
                {r.splash}
              </td>
              <td className="tnum px-1 py-1.5 text-right font-semibold" style={{ color: r.dec ? METHOD_COLOR.dec : undefined }}>
                {r.dec}
              </td>
              <td className="hidden px-3 py-1.5 sm:table-cell">
                <span className="flex justify-end gap-0.5">
                  {r.form.map((x, k) => (
                    <span key={k} className={`flex h-4 w-4 items-center justify-center rounded-[4px] text-[9px] font-black ${x === 'W' ? 'bg-accent text-[#032412]' : 'bg-danger/75 text-white'}`}>
                      {x}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
