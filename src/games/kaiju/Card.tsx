import { useEffect, useState } from 'react'
import { fighter } from './rules'
import { KaijuPortrait } from './portraits'
import { CORNER } from './art'
import type { NextFight } from './live'
import type { Side } from './types'

/*
  The fight card: the next three fights in Neon Bay with their prices to win (worked out from the round ids alone,
  rules.ts matchupOf, so they are known ahead), the Main Event marked in gold, and when each one's betting opens.
*/

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** re-renders every `ms` */
function useTick(ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => !document.hidden && set((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

export function FightCard({ next, now }: { next: NextFight[]; now: () => number }) {
  useTick(1000)
  const t = now()
  return (
    <div className="rounded-xl bg-stage p-3">
      <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-muted">
        <span>Fight card</span>
        <span className="text-dim">Coming up in Neon Bay</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {next.map((n, i) => (
          <div key={n.id} className={`rounded-lg px-2 py-2 ring-1 ${n.matchup.main ? 'bg-gold/[.07] ring-gold/35' : 'bg-panel2 ring-white/[.03]'}`} data-next={n.id}>
            <div className="mb-1.5 flex items-center justify-between text-[10.5px] font-bold">
              <span className={n.matchup.main ? 'font-black uppercase tracking-[.14em] text-gold' : 'text-dim'}>{n.matchup.main ? '★ Main Event' : i === 0 ? 'Next up' : `Fight #${n.id}`}</span>
              <span className="tnum text-dim">{i === 0 ? 'bets open in ' : 'in '}{mmss(n.times.opensAt - t)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              {(['a', 'b'] as Side[]).map((x) => {
                const id = x === 'a' ? n.matchup.a : n.matchup.b
                const price = n.odds.mult[`win:${x}`]
                const fav = n.odds.p[`win:${x}`] > 0.5
                return (
                  <div key={x} className={`flex min-w-0 items-center gap-2 ${x === 'b' ? 'order-3 flex-row-reverse text-right' : ''}`}>
                    <span className="shrink-0 rounded-[10px] p-[1.5px]" style={{ background: CORNER[x].color }}>
                      <KaijuPortrait id={id} size={34} mirror={x === 'b'} bg className="rounded-[9px]" />
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[13px] font-extrabold text-ink">{fighter(id).name}</span>
                      <span className={`tnum text-[11.5px] font-black ${fav ? 'text-accent' : 'text-muted'}`}>{price.toFixed(2)}×</span>
                    </span>
                  </div>
                )
              })}
              <span className="order-2 text-[11px] font-black italic text-dim">vs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
