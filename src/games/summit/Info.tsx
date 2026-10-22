import { Modal } from '../../components/Modal'
import { MAX_MULT, PITCHES, ROUTES, RTP, multiplierOf, stepOf, type RouteId } from './rules'
import { RouteGlyph } from './art'
import { LOOK, altText, multText, oneIn, pct, uncapped } from './words'

/*
  How Summit works: the climb, the four routes with their chances and what each pitch multiplies the climb by, what
  climbing all ten pitches on one route would make (and how often), and the return stated as it is: every route is
  priced at its own odds, so whatever routes are taken and whenever the climb is banked it returns 97% on average,
  until the 10,000× cap, which only the boldest climbs reach and which makes those climbs return less. Also what
  happens to a climb left on a ledge.
*/

/** the fewest pitches in a row on a route that pass the cap (null: ten never do) */
function toCap(r: RouteId): number | null {
  for (let n = 1; n <= PITCHES; n++) if (uncapped(Array<RouteId>(n).fill(r)) > MAX_MULT) return n
  return null
}

export function InfoModal({ onClose }: { onClose: () => void }) {
  const wallCap = toCap('wall')
  return (
    <Modal onClose={onClose} title="How Summit works" width={600}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-ink/90">
        <p>
          Ten pitches stand between Base Camp ({altText(0)}) and the summit ({altText(PITCHES)}). Set your stake and press <b>Start climb</b>: the stake is taken and your climber waits at Base Camp. Then it is your call, one pitch at a time.
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5">
          <li>
            <b>Pick a route</b> to the next camp (keys 1 to 4). Each route holds with its own chance; if it holds, your climber reaches the camp and the climb's multiplier grows by that route's step. If it gives way, your climber falls and the climb pays nothing.
          </li>
          <li>
            <b>Bank</b> (B) at any camp after the first pitch: the climb pays your stake times its multiplier and ends.
          </li>
          <li>
            <b>The summit</b> banks itself: make all ten pitches and the climb is paid there.
          </li>
        </ol>

        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-panel2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              <tr>
                <th className="px-2.5 py-2">Route</th>
                <th className="px-2 py-2 text-right">Holds</th>
                <th className="px-2 py-2 text-right">Each pitch</th>
                <th className="px-2.5 py-2 text-right">All ten</th>
              </tr>
            </thead>
            <tbody>
              {ROUTES.map((r) => {
                const all = Array<RouteId>(PITCHES).fill(r.id)
                const capped = uncapped(all) > MAX_MULT
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-2.5 py-2">
                      <span className="flex items-center gap-2">
                        <RouteGlyph id={r.id} size={26} />
                        <span>
                          <b style={{ color: LOOK[r.id].a }}>{r.name}</b>
                          <span className="block text-[11px] text-dim">{r.line}</span>
                        </span>
                      </span>
                    </td>
                    <td className="tnum px-2 py-2 text-right font-bold">{pct(r.p)}</td>
                    <td className="tnum px-2 py-2 text-right font-bold">×{stepOf(r.id).toFixed(2)}</td>
                    <td className="tnum px-2.5 py-2 text-right">
                      <b className="whitespace-nowrap">
                        {multText(multiplierOf(all))}
                        {capped && <span className="text-gold"> cap</span>}
                      </b>
                      <span className="block whitespace-nowrap text-[11px] text-dim">{oneIn(r.p ** PITCHES)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[12.5px] text-muted">
          The multiplier is {pct(RTP)} of every step climbed multiplied together, rounded down to the cent: one pitch on the Trail banks {multText(multiplierOf(['trail']))}, one on the Sheer Wall {multText(multiplierOf(['wall']))}. Mix routes as you like: a Ridge then a Cliff makes {multText(multiplierOf(['ridge', 'cliff']))}. Each route card shows the multiplier its pitch would make and what that would bank.
        </p>

        <div className="rounded-xl border border-line bg-panel2 p-3">
          <div className="mb-1 text-[12px] font-bold text-muted">The return</div>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            <li>
              Every route is priced at its own odds: a route that holds with chance p steps the multiplier up by exactly 1/p. So whatever routes you choose, and wherever you bank, a climb returns <b>{pct(RTP)}</b> of its stake on average (a hair less, as each multiplier is rounded down to the cent). No way of climbing does better or worse than that, short of the cap.
            </li>
            <li>
              <b>The cap:</b> a climb pays at most <b>{multText(MAX_MULT)}</b>. Only the boldest climbs get there ({wallCap ? `${wallCap} Sheer Walls in a row already pass it` : 'a long run of Sheer Walls'}), and past the cap the extra risk earns nothing more, so a climb that passes it returns less than {pct(RTP)}. The route cards warn when a pitch would pass the cap.
            </li>
          </ul>
        </div>

        <p className="text-[12px] leading-snug text-dim">
          Nothing is decided ahead: each pitch is drawn with your browser's cryptographic random generator at the moment you commit to a route. A climb in progress is saved on this device after every pitch, before the pitch is shown, so it picks up exactly where you left it after a reload or a visit later, and nothing can be re-rolled. A climb left untouched for 7 days is banked for you where it stands (or, if it never left Base Camp, your stake is returned). Auto climbs one route every pitch and banks at the first camp that reaches your target. Keys: 1 Trail, 2 Ridge, 3 Cliff, 4 Sheer Wall, B bank, Space starts a climb.
        </p>
      </div>
    </Modal>
  )
}
