import { Modal } from '../../components/Modal'
import { fmt } from '../../lib/format'
import { DRAW, OUTCOMES, PAYTABLE, RTP, oddsLabel, multOf } from './rules'
import { ItemGlyph } from './art'
import { NAME, isPrize, multText } from './words'

/*
  How Coin Cascade works: the machine and what pays, then the fairness stated as it is. Every drop's result is drawn
  first, with the browser's cryptographic random generator, from a table of outcomes whose odds add up to exactly 97%
  returned; the machine then acts out exactly that result. So where the player aims, and where the prizes happen to
  sit, change how a drop looks and never what it pays. The paytable with each thing's chance of going over in a drop
  (at least one), the features and the top win, and what happens to a drop when the page is left.
*/

const pct = (p: number, d = 2) => `${(p * 100).toFixed(d)}%`

export function InfoModal({ bet, onClose }: { bet: number; onClose: () => void }) {
  const plain = OUTCOMES.filter((o) => o.feature === 'none').length
  const nothing = OUTCOMES.find((o) => multOf(o.wins) === 0)?.ways ?? 0
  return (
    <Modal onClose={onClose} title="How Coin Cascade works" width={600}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-ink/90">
        <p>
          A neon coin pusher with two tiers. Each <b>Drop</b> puts one coin in, at your stake: it falls through the slot onto the upper tier, the pushers shove the field forward,
          and whatever tips over the front edge falls into the tray and is yours. Coins that slide off the open sides go down the gutters and pay nothing (that's the show,
          not the payout). The field is your own machine: it is kept on this device and is exactly as you left it next time.
        </p>

        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-panel2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              <tr>
                <th className="px-2.5 py-2">Over the edge</th>
                <th className="px-2 py-2 text-right">Pays</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">At {fmt(bet)}</th>
                <th className="px-2.5 py-2 text-right">At least one, a drop</th>
              </tr>
            </thead>
            <tbody>
              {[...PAYTABLE.rows].reverse().map((r) => (
                <tr key={r.kind} className="border-t border-line">
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-2">
                      <ItemGlyph kind={r.kind} size={24} />
                      <b className={isPrize(r.kind) ? '' : 'font-semibold'}>{NAME[r.kind]}</b>
                    </span>
                  </td>
                  <td className="tnum px-2 py-1.5 text-right font-black text-gold">{multText(r.value)}</td>
                  <td className="tnum hidden px-2 py-1.5 text-right font-bold sm:table-cell">{fmt(bet * r.value)}</td>
                  <td className="tnum px-2.5 py-1.5 text-right font-bold">{oddsLabel(r.chance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="flex flex-col gap-1.5 pl-1 text-[13px]">
          <li>
            <b>Any win</b> comes {pct(PAYTABLE.anyWin)} of drops: most are a few silver coins, a gold coin about one drop in four. A drop pays everything that falls in it added
            up, times your stake, rounded down to the cent.
          </li>
          <li>
            <b>Coin Shower</b> ({oddsLabel(PAYTABLE.shower)} drops): the hopper over the lower tier tips and pours, and a crowd of coins goes over, sometimes with a prize.
          </li>
          <li>
            <b>Quake</b> ({oddsLabel(PAYTABLE.quake)} drops): the machine shudders, both pushers surge past their usual reach and a lot goes over, often with a prize.
          </li>
          <li>
            <b>Top win:</b> {multText(PAYTABLE.top)}, the Crown and the Golden Idol together in a Quake. A prize that falls is replaced straight away, so the field always holds two
            gems, a gold bar, the Idol and the Crown.
          </li>
        </ul>

        <div className="rounded-xl border border-line bg-panel2 p-3">
          <div className="mb-1 text-[12px] font-bold text-muted">Fair play</div>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            <li>
              Each drop's result (what goes over the edge, and whether it brings a Shower or a Quake) is <b>drawn first</b>, with your browser's cryptographic random generator,
              from a table of {OUTCOMES.length} outcomes ({plain} plain, the rest Showers and Quakes) with exact whole-number odds out of {fmt(DRAW, 0)}. Nothing goes over in{' '}
              {pct(nothing / DRAW)} of drops. The table returns exactly <b>{pct(RTP, 0)}</b> of every stake on average (a hair less, as payouts are rounded down to the cent).
            </li>
            <li>
              Then the machine <b>acts it out</b>: the coins and prizes are played by physics, and exactly the drawn things go over the front edge. Nothing else ever does.
            </li>
            <li>
              <b>Aim doesn't change the odds.</b> It moves where your coin lands, never what a drop pays. Where the prizes sit doesn't either: one hanging over the edge is no more
              likely to fall than one at the back.
            </li>
          </ul>
        </div>

        <p className="text-[12px] leading-snug text-dim">
          A drop is saved on this device before it plays and paid exactly once: when its last thing lands in the tray, or straight away if you hide or leave the page mid-drop
          (you'll be told what it paid); one whose page closed unexpectedly is paid on your next visit. Turbo plays drops two and a half times as fast; Space or a tap on the
          machine hurries the drop in play. Auto drops again and again, and can stop after a big win or on a prize. Keys: Space drops, ← → aim.
        </p>
      </div>
    </Modal>
  )
}
