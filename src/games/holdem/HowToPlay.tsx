import type { ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { CardFace } from '../../art/Card'
import { BLIND_PAYS, MAX_ANTE, MAX_TRIPS, TRIPS_PAYS } from './rules'
import { fmt } from '../../lib/format'
import { PAY_ROWS, oddsWords } from './words'

/*
  How Hold'em Showdown works, in plain words: the bets, the three decisions, the dealer's qualifying, what each bet
  pays (both paytables come straight from rules.ts), the advice the game gives as a table, the house edges honestly
  (measured by tools/holdem-test.ts playing hundreds of thousands of hands by the advice), and the keys.
*/

const H = ({ children }: { children: ReactNode }) => <h3 className="mt-4 text-[14px] font-extrabold text-gold">{children}</h3>
const P = ({ children }: { children: ReactNode }) => <p className="mt-1 text-[13px] leading-relaxed text-muted">{children}</p>
const B = ({ children }: { children: ReactNode }) => <span className="font-bold text-ink">{children}</span>

function Key({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted">
      <kbd className="min-w-[52px] rounded-md border border-line bg-stage px-1.5 py-0.5 text-center text-[11.5px] font-bold text-ink">{k}</kbd>
      {children}
    </div>
  )
}

function Advice({ when, bet, rule }: { when: string; bet: string; rule: ReactNode }) {
  return (
    <tr className="border-t border-white/[0.05] align-top">
      <td className="py-1.5 pr-2 text-[12.5px] font-extrabold text-ink">{when}</td>
      <td className="tnum whitespace-nowrap py-1.5 pr-2 text-[12.5px] font-extrabold text-gold">{bet}</td>
      <td className="py-1.5 text-[12.5px] leading-snug text-muted">{rule}</td>
    </tr>
  )
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="How Hold'em Showdown works" width={600}>
      <div className="flex items-center gap-3 rounded-xl bg-stage p-3">
        <span className="flex shrink-0">
          <CardFace rank="A" suit="♠" width={34} height={48} className="drop-shadow" />
          <CardFace rank="A" suit="♥" width={34} height={48} className="-ml-3 rotate-[8deg] drop-shadow" />
        </span>
        <p className="text-[13px] leading-relaxed text-muted">
          Texas Hold'em, heads up against the dealer. You both get two cards and share five on the board; the best five-card hand from your two and the board's five wins. You only ever make one
          Play bet, so the question is <B>when</B>: early and big, or late and small.
        </p>
      </div>

      <H>A hand</H>
      <P>
        Put chips on the <B>Ante</B>; the <B>Blind</B> always matches it. The <B>Trips</B> side bet is optional. Deal, and look at your two cards:
      </P>
      <ol className="mt-1.5 flex flex-col gap-1 pl-1 text-[13px] leading-relaxed text-muted">
        <li>
          <B>Before the flop</B>: bet <B>4×</B> or <B>3×</B> your ante on Play, or check.
        </li>
        <li>
          <B>After the flop</B> (three board cards), if you checked: bet <B>2×</B>, or check again.
        </li>
        <li>
          <B>After the turn and river</B> (the last two), if you checked twice: bet <B>1×</B>, or fold (and lose the Ante and Blind).
        </li>
      </ol>
      <P>
        Once you bet, the rest of the board is turned over and the dealer shows their cards. The dealer <B>qualifies</B> with a pair or better.
      </P>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-stage px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">You win</div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-muted">Play pays 1 to 1. Ante pays 1 to 1 (returned if the dealer didn't qualify). Blind pays by your hand below.</div>
        </div>
        <div className="rounded-lg bg-stage px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[#9fb8ff]">Dealer wins</div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-muted">Play and Blind lose. Ante loses too, unless the dealer didn't qualify: then it comes back.</div>
        </div>
        <div className="rounded-lg bg-stage px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink">A tie</div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-muted">Play, Ante and Blind all come back.</div>
        </div>
      </div>

      <H>What pays</H>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {[
          { title: 'Blind (when you win)', pays: BLIND_PAYS, note: 'Less than a straight: the Blind is returned.' },
          { title: 'Trips (win, lose or fold)', pays: TRIPS_PAYS, note: 'Less than three of a kind loses.' },
        ].map((t) => (
          <div key={t.title} className="rounded-lg bg-stage px-3 py-2">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-dim">{t.title}</div>
            {PAY_ROWS.filter((r) => t.pays[r.rank] !== undefined).map((r) => (
              <div key={r.rank} className="tnum flex justify-between py-[1px] text-[12.5px]">
                <span className="font-semibold text-muted">{r.name}</span>
                <span className="font-extrabold text-gold">{oddsWords(t.pays[r.rank]!)}</span>
              </div>
            ))}
            <div className="mt-1 text-[11.5px] text-dim">{t.note}</div>
          </div>
        ))}
      </div>
      <P>
        Trips is paid on your final hand whatever happens to the rest: even if the dealer wins, even if you fold. Ante from 1 to {fmt(MAX_ANTE, 0)}, Trips up to {fmt(MAX_TRIPS, 0)}.
      </P>

      <H>The advice</H>
      <P>Turn on Show advice and the best move glows, with the reason. It plays like this:</P>
      <div className="-mx-1 mt-1 overflow-x-auto px-1">
        <table className="w-full min-w-[440px] border-collapse">
          <tbody>
            <Advice
              when="Before the flop"
              bet="Bet 4×"
              rule={
                <>
                  Any ace · a pair of threes or better · king with a suited card or a five or better · queen with a suited six or better, or an eight or better · jack with a suited eight or
                  better, or a ten. Anything else: check.
                </>
              }
            />
            <Advice
              when="After the flop"
              bet="Bet 2×"
              rule={<>Two pair or better that your cards make · a pair that uses a hole card (not pocket twos) · four to a flush with a ten or better of that suit in your hand. Otherwise check.</>}
            />
            <Advice
              when="At the river"
              bet="1× or fold"
              rule={<>The game counts every hand the dealer could still hold (990 of them) and tells you the exact value of betting against folding, which always costs 2 antes.</>}
            />
          </tbody>
        </table>
      </div>

      <H>The house edge, honestly</H>
      <P>
        Played by the advice, the main game keeps about <B>2.5% of your ante</B> per hand. Because good hands bet up to 4× more, that is about <B>0.6% of everything you wager</B>: the game returns
        about 99.4%. Trips returns <B>98.1%</B> on its own. Every mistake (checking a 4× hand, folding a hand worth calling) costs more than that, which is what the advice is for.
      </P>

      <H>Keys</H>
      <div className="mt-1.5 flex flex-col gap-1.5">
        <Key k="Space">Deal (the same bets again after a hand); in a hand, check. The river is yours to call: 1 or F</Key>
        <Key k="4 · 3">Bet 4× or 3× before the flop</Key>
        <Key k="2">Bet 2× on the flop</Key>
        <Key k="1">Bet 1× at the river</Key>
        <Key k="C · F">Check · fold</Key>
        <Key k="A · T">Add a chip to the Ante or to Trips</Key>
        <Key k="H">Show advice on or off</Key>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-dim">
        Every hand is dealt from a freshly shuffled deck the moment you press Deal, and saved after every step: close the page mid-hand and it is waiting, exactly as it was, when you come back. A hand
        that has finished is paid even if you leave as the cards turn over.
      </p>
    </Modal>
  )
}
