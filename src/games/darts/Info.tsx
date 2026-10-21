import { useMemo, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Segmented } from '../../components/ui'
import { MAX_MULT, TARGETS, THROWERS, throwing, type TargetId, type ThrowerId } from './rules'
import { MiniBoard } from './art'
import { breakEven, chanceText, multText, runsOf } from './table'

/*
  How Bullseye works: the rules, the board's scoring, the targets and throwers, and the paytable of any pair in
  full (every total from par up, what it pays and how often it comes up), with each pair's exact return. Nothing is
  rounded up: the numbers are the tables rules.ts works out and the round is paid from.
*/

const pct = (p: number) => `${(p * 100).toFixed(2)}%`

export function InfoModal({ target: t0, thrower: h0, onClose }: { target: TargetId; thrower: ThrowerId; onClose: () => void }) {
  const [target, setTarget] = useState(t0)
  const [thrower, setThrower] = useState(h0)
  const t = throwing(target, thrower)
  const runs = useMemo(() => runsOf(t), [t])
  const be = breakEven(t)
  const sigma = THROWERS.find((x) => x.id === thrower)!.sigma
  return (
    <Modal onClose={onClose} title="How Bullseye works" width={560}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-ink/90">
        <p>
          Three darts at a regulation dartboard, paid on their total. Set your bet, pick a <b>target</b> and a <b>thrower</b>, and press Throw (or Space). The whole round is decided the moment you
          throw: each dart lands around the aim with a round scatter as wide as the thrower's, and scores where it sticks.
        </p>
        <div className="grid grid-cols-2 gap-2 text-center text-[12px] sm:grid-cols-4">
          {[
            ['Single', 'the number'],
            ['Double ×2', 'the thin outer ring'],
            ['Treble ×3', 'the thin inner ring'],
            ['25 · Bull 50', 'off the board: 0'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-panel2 px-2 py-2.5">
              <div className="font-black text-ink">{k}</div>
              <div className="text-muted">{v}</div>
            </div>
          ))}
        </div>
        <ul className="flex flex-col gap-1.5">
          <li>
            <b>Targets:</b> Treble 20 and Treble 19 aim at the middle of that treble bed; the Bull aims at the centre. Three treble 20s make the 180; Treble 19 tops out at 171, the Bull at 150.
          </li>
          <li>
            <b>Throwers:</b> Pro scatters 14 mm, Regular 26 mm, Wild 42 mm (the spread of each dart about the aim). The dashed ring on the board holds about 86% of darts. A tighter thrower scores more
            often, so their table pays less for a total.
          </li>
          <li>
            <b>Pays:</b> a total under par pays nothing; from par up every total pays its own amount, rarer totals more (up to {MAX_MULT.toLocaleString('en-US')}×). The ladder beside the board shows the
            steps and, live, the chance of reaching each one from where the round stands.
          </li>
        </ul>

        <div className="rounded-2xl border border-line bg-panel2 p-3">
          <div className="mb-3 flex items-center gap-3">
            <MiniBoard target={target} size={54} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Segmented value={target} onChange={setTarget} options={TARGETS.map((x) => ({ value: x.id, label: x.short }))} />
              <Segmented value={thrower} onChange={setThrower} options={THROWERS.map((x) => ({ value: x.id, label: x.name }))} />
            </div>
          </div>
          <div className="mb-2 grid grid-cols-4 gap-1.5 text-center">
            {[
              ['Par', String(t.par)],
              ['Stake back', `${be}+`],
              ['Wins 1×+', pct(t.tail[be])],
              ['Return', pct(t.rtp)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-stage px-1 py-1.5">
                <div className="text-[10.5px] font-bold text-dim">{k}</div>
                <div className="tnum text-[14px] font-black">{v}</div>
              </div>
            ))}
          </div>
          <div className="max-h-[260px] overflow-y-auto rounded-lg bg-stage">
            <table className="tnum w-full text-[12.5px]">
              <thead className="sticky top-0 bg-stage text-[11px] text-dim">
                <tr>
                  <th className="px-3 py-1.5 text-left font-bold">Total</th>
                  <th className="px-3 py-1.5 text-right font-bold">Pays</th>
                  <th className="px-3 py-1.5 text-right font-bold">Chance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line/60 text-dim">
                  <td className="px-3 py-1">0 – {t.par - 1}</td>
                  <td className="px-3 py-1 text-right">0×</td>
                  <td className="px-3 py-1 text-right">{chanceText(1 - t.tail[t.par])}</td>
                </tr>
                {runs.map((r) => (
                  <tr key={r.from} className="border-t border-line/60">
                    <td className="px-3 py-1 font-bold">{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</td>
                    <td className={`px-3 py-1 text-right font-black ${r.pays >= 10 ? 'text-gold' : r.pays >= 1 ? 'text-accent' : 'text-muted'}`}>{multText(r.pays)}</td>
                    <td className="px-3 py-1 text-right text-muted">{chanceText(r.chance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-dim">
            {t.top < 180 ? `Totals over ${t.top} come up less than once in ten million rounds and are left off. ` : ''}Spread {sigma} mm. The chances and the return are worked out exactly from the board's
            geometry, not simulated.
          </p>
        </div>

        <div>
          <div className="mb-1.5 text-[12px] font-bold text-muted">Every pair at a glance</div>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="tnum w-full text-[12px]">
              <thead className="bg-panel2 text-[11px] text-dim">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-bold">Pair</th>
                  <th className="px-2 py-1.5 text-right font-bold">Par</th>
                  <th className="px-2 py-1.5 text-right font-bold">Top pay</th>
                  <th className="px-2 py-1.5 text-right font-bold">Wins 1×+</th>
                  <th className="px-2.5 py-1.5 text-right font-bold">Return</th>
                </tr>
              </thead>
              <tbody>
                {TARGETS.flatMap((tg) =>
                  THROWERS.map((th) => {
                    const x = throwing(tg.id, th.id)
                    const on = tg.id === target && th.id === thrower
                    return (
                      <tr key={`${tg.id}${th.id}`} onClick={() => (setTarget(tg.id), setThrower(th.id))} className={`cursor-pointer border-t border-line/60 transition ${on ? 'bg-raised' : 'hover:bg-panel2'}`}>
                        <td className="px-2.5 py-1 font-bold">
                          {tg.short} · {th.name}
                        </td>
                        <td className="px-2 py-1 text-right">{x.par}</td>
                        <td className="px-2 py-1 text-right font-black text-gold">{multText(x.pays[x.top])}</td>
                        <td className="px-2 py-1 text-right text-muted">{pct(x.tail[breakEven(x)])}</td>
                        <td className="px-2.5 py-1 text-right text-muted">{pct(x.rtp)}</td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[12px] leading-snug text-dim">
          Every dart is drawn with your browser's cryptographic random generator. If you leave mid-round, the round is already decided: it is paid straight away and the next visit tells you what it came
          to. Keys: Space or Enter throws.
        </p>
      </div>
    </Modal>
  )
}
