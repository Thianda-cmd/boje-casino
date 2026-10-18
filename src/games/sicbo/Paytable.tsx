import type { ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { fmt } from '../../lib/format'
import { MAX_BET } from '../../store/wallet'
import { DieFace } from './art'
import { LIMITS, LUCKY_MULTS, MEAN_STRIKES, SINGLE_ODDS, STRUCK_CHANCE, spotOf, spotRtp, winChance, type BetKey, type Die, type LuckyKind } from './rules'
import { oddsText, pct, rtpText, topMult } from './words'

/*
  How Sic Bo works: the rules in plain words, the lucky strikes and their multiplier tables, every bet's odds, chance,
  strike chance and return, the limits, and the keys. Every number comes from rules.ts, so it can't drift from the
  maths.
*/

const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <th className={`pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-dim ${right ? 'text-right' : 'text-left'}`}>{children}</th>
)
const Td = ({ children, right, strong }: { children: ReactNode; right?: boolean; strong?: boolean }) => (
  <td className={`tnum py-1 text-[12.5px] ${right ? 'text-right' : ''} ${strong ? 'font-extrabold text-ink' : 'font-semibold text-muted'}`}>{children}</td>
)

/** a paytable row: one bet (or a pair of mirror bets that share every number) */
function Row({ name, art, k }: { name: string; art?: ReactNode; k: BetKey }) {
  const s = spotOf(k)
  return (
    <tr className="border-t border-white/[0.05]">
      <Td strong>
        <span className="flex items-center gap-1.5">
          {art}
          {name}
        </span>
      </Td>
      <Td right strong>
        <span className="text-gold">{s.kind === 'single' ? `${SINGLE_ODDS[1]} / ${SINGLE_ODDS[2]} / ${SINGLE_ODDS[3]}:1` : oddsText(s.odds)}</span>
      </Td>
      <Td right>{pct(winChance(k))}</Td>
      <Td right>{s.lucky ? `${pct(STRUCK_CHANCE[k])} · ×${topMult(k)}` : '–'}</Td>
      <Td right>{rtpText(spotRtp(k))}</Td>
    </tr>
  )
}

const dice = (...n: Die[]) => (
  <span className="flex gap-[2px]">
    {n.map((f, i) => (
      <DieFace key={i} n={f} size={15} />
    ))}
  </span>
)

const KIND_NAME: Record<LuckyKind, string> = { total: 'Totals', double: 'Doubles', triple: 'Specific triples', anyTriple: 'Any triple', combo: 'Combinations' }

export function Paytable({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="How Sic Bo works" width={620}>
      <div className="flex items-center gap-3 rounded-xl bg-stage p-3">
        {dice(2, 4, 4)}
        <p className="text-[13px] leading-relaxed text-muted">Three dice are shaken under the glass dome. Put chips on what you think they will show, then roll: every bet the dice agree with pays.</p>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        <span className="font-bold text-ink">Small</span> is a total of 4 to 10 and <span className="font-bold text-ink">Big</span> 11 to 17; they and <span className="font-bold text-ink">Odd</span> /{' '}
        <span className="font-bold text-ink">Even</span> pay 1 to 1 but lose on any triple. A <span className="font-bold text-ink">total</span> pays by how rare it is. A{' '}
        <span className="font-bold text-ink">double</span> wins when two dice (or three) show its number, a <span className="font-bold text-ink">specific triple</span> when all three do, and{' '}
        <span className="font-bold text-ink">Any triple</span> on any of the six. A <span className="font-bold text-ink">combination</span> wins when its two numbers both show. A{' '}
        <span className="font-bold text-ink">single</span> number pays 1 to 1 for each die showing it (2 to 1 on two dice, 14 to 1 on all three). Your stake comes back on every win.
      </p>

      <h3 className="mt-4 text-[14px] font-extrabold text-gold">Lucky strikes</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        When you roll, golden lightning strikes a few spots on the table first (about {MEAN_STRIKES.toFixed(1)} a roll, never none): a winning bet on a struck spot is paid its odds times the
        multiplier, so a 5 to 1 combination struck ×10 pays 50 to 1. Totals, doubles, triples and combinations can be struck; Small, Big, Odd, Even and the singles never are. The strikes are drawn
        first and the dice on their own, so where the lightning falls says nothing about the roll.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(Object.keys(LUCKY_MULTS) as LuckyKind[]).map((kind) => (
          <div key={kind} className="rounded-lg bg-stage px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-dim">{KIND_NAME[kind]}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {LUCKY_MULTS[kind].map((m) => (
                <span key={m.mult} className="tnum rounded-md bg-black/25 px-1.5 py-0.5 text-[12px] font-bold text-muted">
                  <span className="font-black text-gold">×{m.mult}</span> {m.weight}%
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-dim">The percentages are how often a struck spot gets each multiplier.</p>

      <h3 className="mt-4 text-[14px] font-extrabold text-gold">Paytable</h3>
      <div className="-mx-1 mt-1 overflow-x-auto px-1">
        <table className="w-full min-w-[460px] border-collapse">
          <thead>
            <tr>
              <Th>Bet</Th>
              <Th right>Pays</Th>
              <Th right>Wins</Th>
              <Th right>Struck · up to</Th>
              <Th right>Returns</Th>
            </tr>
          </thead>
          <tbody>
            <Row name="Small / Big" k="small" />
            <Row name="Odd / Even" k="odd" />
            {[4, 5, 6, 7, 8, 9, 10].map((t) => (
              <Row key={t} name={`Total ${t} or ${21 - t}`} k={`total${t}` as BetKey} />
            ))}
            <Row name="Double" art={dice(3, 3)} k="double3" />
            <Row name="Specific triple" art={dice(5, 5, 5)} k="triple5" />
            <Row name="Any triple" k="anyTriple" />
            <Row name="Combination" art={dice(2, 6)} k="combo26" />
            <Row name="Single" art={dice(4)} k="single4" />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-dim">
        Every lucky spot returns {rtpText(spotRtp('total4'))} over time (the strikes are tuned so); Small, Big, Odd, Even and the singles return {rtpText(spotRtp('small'))}.
      </p>

      <h3 className="mt-4 text-[14px] font-extrabold text-gold">Limits</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Per spot: Small, Big, Odd and Even {fmt(LIMITS.small, 0)}; singles {fmt(LIMITS.single, 0)}; totals, doubles and combinations {fmt(LIMITS.total, 0)}; triples and Any triple{' '}
        {fmt(LIMITS.triple, 0)}. The whole table: {fmt(MAX_BET, 0)} a roll.
      </p>

      <p className="mt-3 text-[12px] leading-relaxed text-dim">
        Keys: 1 to 8 pick a chip, Space or Enter rolls, Z or Backspace undoes, C clears, R puts your last bets back, D doubles them. Right-click (or long-press) a spot to take a chip off. After a roll your bets stay on the
        table, so Space rolls the same again. Turbo plays the strikes and the shake quicker. If you leave mid-roll, the roll is paid at once and you are told what it came to.
      </p>
    </Modal>
  )
}
