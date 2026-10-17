import { useState } from 'react'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { fmt, round2 } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { CARDS, CARD_IDS, RTP, bonusChance, chanceLabel, chanceOf, coinLabel, hitChance, multLabel, oddsLabel, type CardId, type Outcome } from './rules'
import { CARD_H, CARD_R, CARD_W, cellCenter, hasBonus } from './layout'
import { CardFace, THEMES } from './cardart'
import { BonusValue, Cell, Stamp, loopPath } from './ScratchCard'
import { RiskMeter, SHORT } from './rack'
import { SymbolArt } from './symbols'

/*
  Two dialogs: a finished ticket from the history, drawn again as it ended (every cell out, the win circled and the
  stamp on), and the prize tables with a short "how it works" and the fairness detail folded away under it.
*/

export interface TicketData {
  key: number
  id: CardId
  serial: string
  outcome: Outcome
  bet: number
  payout: number
  /** paid while the player was away */
  away?: boolean
}

/** a finished ticket, all of it out, at `scale` */
export function TicketView({ t, scale }: { t: TicketData; scale: number }) {
  const o = t.outcome
  const won = o.prize >= 0
  const th = THEMES[t.id]
  return (
    <div className="relative" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})`, borderRadius: CARD_R, overflow: 'hidden' }}>
        <CardFace id={t.id} serial={t.serial} win={o.prize} price={t.bet} />
        {o.board.map((s, i) => (
          <Cell key={i} id={t.id} i={i} sym={s} price={t.bet} state={!won ? 'idle' : o.line.includes(i) ? 'win' : 'lose'} popKey={0} hop={0} hot={false} />
        ))}
        {hasBonus(t.id) && <BonusValue mult={o.bonus} pop={0} hot={won && o.bonus > 1} />}
        {won && (
          <svg className="pointer-events-none absolute inset-0" width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`} aria-hidden>
            {o.line.map((i, k) => {
              const c = cellCenter(i)
              const d = loopPath(c.x, c.y, k + i)
              return (
                <g key={i}>
                  <path d={d} fill="none" stroke={th.ink} strokeOpacity=".45" strokeWidth="9" strokeLinecap="round" />
                  <path d={d} fill="none" stroke={th.win} strokeWidth="5" strokeLinecap="round" />
                </g>
              )
            })}
          </svg>
        )}
        <div className="pointer-events-none absolute left-[10px] top-[10px] h-[134px] w-[340px] rounded-[16px] opacity-[.84]" style={{ background: `linear-gradient(${th.paper[0]}, ${th.paper[1]})` }} />
        <Stamp id={t.id} outcome={o} amount={t.payout} away={!!t.away} onLand={() => {}} />
      </div>
    </div>
  )
}

/** a past ticket, from the history */
export function TicketModal({ t, onClose }: { t: TicketData; onClose: () => void }) {
  const c = CARDS[t.id]
  const scale = Math.min(0.78, (Math.min(window.innerWidth, 520) - 48) / CARD_W, (window.innerHeight * 0.92 - 150) / CARD_H)
  const won = t.outcome.prize >= 0
  return (
    <Modal onClose={onClose} title={`${c.name} · Nº ${t.serial}`} width={Math.max(320, CARD_W * scale + 48)}>
      <div className="flex flex-col items-center gap-3 pb-1">
        <TicketView t={t} scale={scale} />
        <div className="tnum flex items-center gap-1.5 text-[13.5px] font-bold text-muted">
          {won ? (
            <>
              Paid <span className="text-gold">{fmt(t.payout)}</span> <Coin size={13} /> ({multLabel(t.outcome.mult)}) on a {fmt(t.bet)} card
            </>
          ) : (
            <>No win on a {fmt(t.bet)} card</>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** every card's prizes with their chances, at the current price, under a short "how it works" */
export function PrizeModal({ initial, bet, onClose }: { initial: CardId; bet: number; onClose: () => void }) {
  const [id, setId] = useState(initial)
  const c = CARDS[id]
  const t = THEMES[id]
  return (
    <Modal onClose={onClose} title="How to play" width={540}>
      <div className="flex flex-col gap-3">
        <ul className="grid gap-1.5 rounded-xl bg-panel2 px-3.5 py-3 text-[13px] font-semibold leading-snug text-ink/90">
          <li className="flex gap-2">
            <span className="text-gold">1</span> Pick a card and buy it: its price is your bet.
          </li>
          <li className="flex gap-2">
            <span className="text-gold">2</span> Scratch the foil. Three of the same symbol win the prize on its badge.
          </li>
          <li className="flex gap-2">
            <span className="text-gold">3</span> One prize per card at most. Symbols with no badge are blanks.
          </li>
          <li className="flex gap-2 text-muted">
            <span className="text-gold">★</span> Every card pays back {Math.round(RTP * 100)}% of what it costs, on average over many cards.
          </li>
        </ul>
        <div className="grid grid-cols-4 gap-1.5">
          {CARD_IDS.map((k) => (
            <button
              key={k}
              onClick={() => (sfx.click(), setId(k))}
              aria-pressed={k === id}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition ${k === id ? 'bg-raised' : 'bg-panel2 hover:bg-raised/60'}`}
              style={{ boxShadow: k === id ? `inset 0 0 0 2px ${THEMES[k].table.edge}` : undefined }}
            >
              <SymbolArt sym={CARDS[k].prizes[7].sym} size={30} />
              <span className="text-[11px] font-bold text-muted">{SHORT[k]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-panel2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold">{c.name}</div>
            <div className="tnum mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
              <RiskMeter id={id} size="sm" /> {c.risk} risk · wins {oddsLabel(hitChance(c))} ({chanceLabel(hitChance(c))})
            </div>
          </div>
          <div className="tnum text-right text-[11.5px] font-bold text-dim">
            at a price of
            <div className="flex items-center justify-end gap-1 text-[14px] font-extrabold text-ink">
              {fmt(bet)} <Coin size={12} />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[34px_1fr_auto_auto] items-center gap-x-3 px-2 text-[10.5px] font-bold uppercase tracking-wider text-dim">
            <span />
            <span>Match 3</span>
            <span className="text-right">Chance</span>
            <span className="w-[96px] text-right">Pays</span>
          </div>
          {[...c.prizes].reverse().map((p) => (
            <div key={p.sym} className="grid grid-cols-[34px_1fr_auto_auto] items-center gap-x-3 rounded-lg bg-panel2/70 px-2 py-1" style={{ boxShadow: `inset 3px 0 0 ${t.table.edge}` }}>
              <SymbolArt sym={p.sym} size={32} />
              <span className="min-w-0 truncate text-[13px] font-bold">{p.name}</span>
              <span className="tnum text-right leading-tight">
                <span className="block text-[12.5px] font-bold text-ink/90">{oddsLabel(chanceOf(p))}</span>
                <span className="block text-[10.5px] font-semibold text-dim">{chanceLabel(chanceOf(p))}</span>
              </span>
              <span className="tnum w-[96px] text-right leading-tight">
                <span className="flex items-center justify-end gap-1 text-[14px] font-extrabold text-gold">
                  {coinLabel(round2(bet * p.mult))} <Coin size={11} />
                </span>
                <span className="block text-[11px] font-semibold text-dim">{multLabel(p.mult)}</span>
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-center gap-2 rounded-lg bg-panel2/40 px-2 py-1.5">
            <div className="flex shrink-0 gap-0.5">
              {c.blanks.map((b) => (
                <SymbolArt key={b.sym} sym={b.sym} size={24} />
              ))}
            </div>
            <span className="text-[12px] font-semibold text-muted">Blanks: never pay, only fill the card</span>
          </div>
        </div>
        {id === 'gold' && (
          <div className="flex items-center gap-3 rounded-xl bg-panel2 px-3 py-2.5">
            <SymbolArt sym="dynamite" size={34} />
            <div>
              <div className="text-[13px] font-extrabold">Dynamite</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">A dynamite that comes out goes off and blasts the foil off the rest of its row. It pays like any other symbol: three of them win {multLabel(25)}.</p>
            </div>
          </div>
        )}
        {c.bonus && (
          <div className="rounded-xl bg-panel2 px-3 py-2.5">
            <div className="text-[13px] font-extrabold">Frenzy spot</div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">Scratch the starburst: it multiplies whatever the grid pays, up to ×10.</p>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {c.bonus.map((b) => (
                <div key={b.mult} className="rounded-lg bg-stage py-1.5 text-center">
                  <div className="tnum text-[15px] font-extrabold text-gold">×{b.mult}</div>
                  <div className="tnum text-[10.5px] font-semibold text-dim">{chanceLabel(bonusChance(b))}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <details className="group rounded-xl bg-panel2/60 px-3 py-2 text-[12px] font-medium leading-relaxed text-dim">
          <summary className="cursor-pointer select-none font-bold text-muted transition group-open:text-ink">Fairness details</summary>
          <p className="mt-1.5">
            The prize is drawn the moment you buy the card, from a table of whole weights out of 1,000,000 that returns exactly {Math.round(RTP * 100)}%; only then are the nine symbols laid out to show it. A winning card shows its symbol three times on three cells picked at random; every other cell is filled at random from the card's other symbols (prizes and blanks: all twelve on a losing card) with no symbol more than twice, so a card never shows two wins and the top symbol turns up as a pair exactly as often as a blank does.
          </p>
          {c.bonus && <p className="mt-1.5">The Frenzy spot is drawn on its own, out of 1,000, and is the same whatever the grid shows.</p>}
          {id === 'gold' && <p className="mt-1.5">A dynamite's blast only takes foil off: what the cells hold was fixed when the card was bought.</p>}
          <p className="mt-1.5">Reveal all and autoplay only choose the order the coin works in. When two of a top-three prize are showing, the coin keeps one cell back for last; the result was fixed when the card was bought.</p>
        </details>
      </div>
    </Modal>
  )
}
