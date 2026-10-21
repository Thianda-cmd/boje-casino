import { Modal } from '../../components/Modal'
import { BETA, BOARDS, MOOD, ROUNDS, RTP, returnToEnd } from './rules'
import { TierBadge } from './art'
import { multText, oneIn, pct } from './words'

/*
  How Banker's Deal works: the course of a game, the three boards with their chances and every prize, and the
  return stated as it is: playing every game to the end returns RTP exactly; every offer is at most the average of
  the prizes still unopened, so taking a deal never returns more on average than playing on (it trades a chance for
  certainty); swapping changes nothing. Also what happens to a game left mid-way.
*/

export function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="How Banker's Deal works" width={580}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-ink/90">
        <p>
          Sixteen briefcases, sixteen prizes, and a Banker who wants to buy yours. Set your stake and press <b>Start</b>: the stake is taken and tonight's board is drawn. Every prize is a multiple of your
          stake, and the prize board shows them in coins.
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5">
          <li>
            <b>Pick your case.</b> It goes on the podium, unopened, and is yours to keep.
          </li>
          <li>
            <b>Open the others</b> in rounds of {ROUNDS.join(', ')}. Each prize revealed goes dark on the board, so the board always shows what could still be in your case.
          </li>
          <li>
            <b>The Banker calls</b> after every round with an offer for your case. <b className="text-accent">Deal</b> (D) takes it and ends the game; <b className="text-danger">No Deal</b> (N) plays on.
          </li>
          <li>
            <b>The final two:</b> with your case and one other left, he makes a last offer. Take it, keep your case, or <b>Swap</b> (S) for the other one. Then your case is opened and pays what is inside.
          </li>
        </ol>
        <p className="text-[12.5px] text-muted">After a deal your case is opened anyway, so you see what you would have won.</p>

        <div>
          <div className="mb-1.5 text-[12px] font-bold text-muted">The boards</div>
          <div className="flex flex-col gap-2">
            {BOARDS.map((b) => (
              <div key={b.id} className="rounded-xl border border-line bg-panel2 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <TierBadge board={b.id} size="sm" />
                  <span className="tnum text-[12px] font-bold text-muted">
                    {b.id === 'classic' ? pct(b.chance) : `${pct(b.chance, 3)} · ${oneIn(b.chance)}`} of games · top {multText(b.prizes[b.prizes.length - 1])}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {b.prizes.map((p, i) => (
                    <span key={i} className={`tnum rounded-md px-1.5 py-0.5 text-[11.5px] font-extrabold ${i >= 8 ? 'bg-gold/15 text-gold' : 'bg-sky/15 text-sky'}`}>
                      {multText(p)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel2 p-3">
          <div className="mb-1 text-[12px] font-bold text-muted">The return</div>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            <li>
              Playing every game to the end (No Deal every time) returns <b>{pct(returnToEnd())}</b> of what you stake, on average: the board chances are set so the average prize comes to exactly {pct(RTP, 0)}.
            </li>
            <li>
              Every offer is the Banker's share of the average of the prizes still unopened (what your case is worth on average at that moment): {BETA.map((b) => pct(b, 0)).join(', ')} after rounds 1 to 5 and at the final two, less up to{' '}
              {pct(MOOD, 0)} for his mood, rounded down to the cent. So a deal never returns more than playing on, on average: it swaps a chance at a big prize for a sure amount. No way of playing returns more
              than {pct(RTP, 0)}.
            </li>
            <li>Swapping at the final two changes nothing: the two cases left are alike.</li>
          </ul>
        </div>

        <p className="text-[12px] leading-snug text-dim">
          Nothing is decided ahead: each case's prize is drawn with your browser's cryptographic random generator, from the prizes not yet seen, the moment you open it, and your own case is filled at
          the end. A game in progress is saved on this device after every move and picks up where you left it, even after a reload; each case and offer is saved before it is shown, so nothing can be
          re-rolled. A game left untouched for 7 days is finished for you as if you had refused every offer (the best value on average), and paid. Keys: D Deal, N No Deal, S Swap, Space opens a case
          for you.
        </p>
      </div>
    </Modal>
  )
}
