import { Modal } from '../../components/Modal'
import { fmt } from '../../lib/format'
import { FEE, LEVERAGES, LIQ, MAX_MULT, MOODS, MOOD_CHANGE, TICK_MS } from './rules'
import { MAX_OPEN } from './desk'
import { fmtPct, liqMove } from './levels'
import { MOOD_LOOK } from './Ticker'

/* How Market Rush works: the market, a position's value, liquidation, auto close, leaving, and the return, honestly. */

const pct = (x: number) => `${+(x * 100).toFixed(2)}%`

export function HowItWorks({ onClose }: { onClose: () => void }) {
  const margin = 1 - FEE
  const ex = { stake: 10, lev: 25, move: 0.01 }
  const exValue = ex.stake * margin + ex.stake * ex.lev * ex.move
  return (
    <Modal onClose={onClose} title="How Market Rush works" width={580}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-muted">
        <p>
          BOJE/USD is a live price that ticks {1000 / TICK_MS} times a second. Each tick moves it up or down by a small random amount, and up is exactly as likely as down: the price is a fair coin-flip walk, so nothing on the chart
          can tell you where it goes next. Its <b className="text-ink">mood</b> sets how big the moves are, and changes about every {Math.round(1 / MOOD_CHANGE / (1000 / TICK_MS))} seconds:
        </p>
        <div className="grid grid-cols-3 gap-2">
          {MOODS.map((m, i) => (
            <div key={m.id} className="rounded-xl bg-stage px-3 py-2.5" style={{ boxShadow: `inset 0 0 0 1px ${MOOD_LOOK[i].ring}` }}>
              <div className="text-[12px] font-black uppercase tracking-[0.12em]" style={{ color: MOOD_LOOK[i].color }}>
                {m.name}
              </div>
              <div className="tnum text-[12px] text-dim">about ±{pct(m.sigma)} a tick</div>
            </div>
          ))}
        </div>
        <p>
          <b className="text-ink">Opening a position.</b> Pick a stake and a leverage, then press <b className="text-accent">Up</b> (you gain when the price rises) or <b className="text-danger">Down</b> (you gain when it falls). It opens at the
          price on screen. Opening costs a {pct(FEE)} fee; the rest of the stake is your margin. You can hold up to {MAX_OPEN} positions at once.
        </p>
        <div className="rounded-xl bg-stage px-3.5 py-3 text-[13px]">
          <div className="font-bold text-ink">Value = margin + stake × leverage × the price move</div>
          <div className="mt-1 text-dim">
            For example {ex.stake} coins at {ex.lev}×, and the price goes {pct(ex.move)} your way: {fmt(ex.stake * margin)} + {fmt(ex.stake * ex.lev * ex.move)} = <b className="text-accent">{fmt(exValue)}</b> ({(exValue / ex.stake).toFixed(2)}× the stake). A{' '}
            {pct(ex.move)} move the other way leaves {fmt(ex.stake * margin - ex.stake * ex.lev * ex.move)}.
          </div>
        </div>
        <p>
          <b className="text-ink">Closing.</b> Close whenever you like and you are paid what the position is worth at that price. Auto close can do it for you: <b className="text-ink">take profit</b> closes it once it is worth a multiple of
          its stake you choose, <b className="text-ink">stop loss</b> once it has fallen to one. Either fills at the first tick past its line, at that tick&rsquo;s value. A position worth {fmt(MAX_MULT, 0)}× its stake closes itself and
          pays {fmt(MAX_MULT, 0)}×.
        </p>
        <div>
          <p>
            <b className="text-danger">Liquidation.</b> When a position falls to {pct(LIQ)} of its stake it is closed and pays nothing. The higher the leverage, the smaller the move against you that does it:
          </p>
          <div className="mt-2 grid grid-cols-7 gap-1 sm:gap-1.5">
            {LEVERAGES.map((l) => (
              <div key={l} className="rounded-lg bg-stage px-0.5 py-2 text-center">
                <div className="text-[12px] font-black text-ink sm:text-[13px]">{l}×</div>
                <div className="tnum text-[10px] font-bold text-danger/90 sm:text-[11.5px]">{fmtPct(liqMove(l))}</div>
              </div>
            ))}
          </div>
        </div>
        <p>
          <b className="text-ink">Leaving.</b> Leaving the game or reloading the page closes your positions at the price on screen and pays them. While the tab is hidden the market pauses and your positions wait. If the page is lost
          some other way, your positions are paid at their last price the next time you open the game.
        </p>
        <div className="rounded-xl border border-white/[.07] bg-stage px-3.5 py-3 text-[12.5px] text-dim">
          <b className="text-ink">The return.</b> Because the price is fair, what a position is worth on average at any moment is exactly its margin: {pct(margin)} of the stake. No timing, leverage, target or stop changes that, and a
          liquidation only adds to the house&rsquo;s side (the position still had {pct(LIQ)} of its stake left when it was closed for nothing). So whatever way you play, you get back at most {pct(margin)} of what you stake over time:
          the {pct(FEE)} fee is the house edge, liquidations make it a little larger, and the more often you are liquidated the larger it gets.
        </div>
        <p className="text-[12px] text-dim">Keys: ↑ or W opens Up, ↓ or S opens Down, C closes your newest position, X closes them all.</p>
      </div>
    </Modal>
  )
}
