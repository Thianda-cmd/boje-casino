import { useState, type ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { Segmented } from '../../components/ui'
import { fmt } from '../../lib/format'
import { CREAM, GOLD, RED, RedDie } from './art'
import { FIRE_PAYS, LAY_MAX_WIN, LIMIT_FIRE, LIMIT_FLAT, LIMIT_PROP, ODDS_MAX, betReturn, type BetKey, type Die } from './rules'
import { edgeText, payText } from './words'

/*
  How to play craps, for someone who never has: the hand in plain words with a little diagram (the come-out, the
  point, made or sevened out), the best bets to start with, then every bet: when it wins, what it pays and the house
  edge (1 minus its return, straight from rules.ts so it can't drift from the maths), the odds and lay limits, the
  table limits and the keys. Opens on 'learn', or on 'bets' from the house edges link. The bet list is a grid: four
  columns where there is room, and on a phone each bet's name, pays and edge on one line with when it wins under it.
*/

export type PaytableTab = 'learn' | 'bets'

/** the bet list's columns: the bet, when it wins, what it pays, the house edge (on a phone: bet, pays, edge) */
const GRID = 'grid grid-cols-[minmax(0,1fr)_auto_58px] items-baseline gap-x-3 sm:grid-cols-[150px_minmax(0,1fr)_auto_64px]'

const dice = (a: Die, b: Die) => (
  <span className="inline-flex gap-[2px] align-middle">
    <RedDie n={a} size={15} />
    <RedDie n={b} size={15} />
  </span>
)

function Row({ name, k, wins, pay, edge }: { name: ReactNode; k: BetKey; wins: string; pay?: string; edge?: string }) {
  const e = edge ?? edgeText(betReturn(k))
  return (
    <div className={`${GRID} tnum border-t border-white/[0.05] py-1.5 text-[12.5px]`} role="row">
      <div className="font-extrabold text-ink sm:pr-1" role="cell">
        {name}
      </div>
      {/* (under the name on a phone) */}
      <div className="order-last col-span-3 mt-0.5 text-[12px] font-semibold leading-snug text-muted sm:order-none sm:col-span-1 sm:mt-0 sm:text-[12.5px]" role="cell">
        {wins}
      </div>
      <div className="max-w-[44vw] justify-self-end text-right font-extrabold leading-snug text-gold sm:max-w-[190px]" role="cell">
        {pay ?? payText(k)}
      </div>
      <div className={`whitespace-nowrap text-right ${e === '0%' ? 'font-extrabold text-accent' : 'font-semibold text-muted'}`} role="cell">
        {e}
      </div>
    </div>
  )
}

/** the hand as a little flow: come-out → natural / craps / point → made / seven-out */
function HandDiagram() {
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, color: string) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={9} fill="rgba(0,0,0,.25)" stroke={color} strokeOpacity=".75" strokeWidth={1.4} />
      <text x={x + w / 2} y={y + 17} textAnchor="middle" fontSize="12" fontWeight="900" fill={color} fontFamily="Manrope, system-ui, sans-serif">
        {title}
      </text>
      <text x={x + w / 2} y={y + 33} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={CREAM} fillOpacity=".8" fontFamily="Manrope, system-ui, sans-serif">
        {sub}
      </text>
    </g>
  )
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <path d={`M${x1} ${y1} L${x2} ${y2}`} stroke={CREAM} strokeOpacity=".45" strokeWidth={1.5} markerEnd="url(#crapsArrow)" />
  return (
    <svg viewBox="0 0 560 190" className="w-full" role="img" aria-label="A hand of craps: the come-out roll, then the point">
      <defs>
        <marker id="crapsArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10Z" fill={CREAM} fillOpacity=".6" />
        </marker>
      </defs>
      <rect x="0" y="0" width="560" height="190" rx="14" fill="#0c5b3c" />
      {box(14, 70, 120, 46, 'COME-OUT', 'the first roll', CREAM)}
      {arrow(136, 82, 186, 36)}
      {arrow(136, 93, 186, 93)}
      {arrow(136, 104, 186, 150)}
      {box(190, 14, 150, 46, '7 or 11', 'Pass Line wins', '#7cf0b0')}
      {box(190, 70, 150, 46, '4 5 6 8 9 10', 'becomes the point', GOLD)}
      {box(190, 126, 150, 46, '2, 3 or 12', 'craps: Pass loses', '#ff9d94')}
      {arrow(342, 86, 392, 58)}
      {arrow(342, 100, 392, 128)}
      {box(396, 34, 150, 46, 'the point again', 'Pass wins, again', '#7cf0b0')}
      {box(396, 106, 150, 46, 'a 7 first', 'seven out: Pass loses', '#ff9d94')}
    </svg>
  )
}

export function Paytable({ onClose, tab: initial = 'learn' }: { onClose: () => void; tab?: PaytableTab }) {
  const [tab, setTab] = useState<PaytableTab>(initial)
  return (
    <Modal onClose={onClose} title="How to play craps" width={660}>
      <div className="mb-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'learn', label: 'How to play' },
            { value: 'bets', label: 'Every bet · house edge' },
          ]}
        />
      </div>
      {tab === 'learn' ? (
        <>
          <div className="flex items-center gap-3 rounded-xl bg-stage p-3">
            {dice(5, 6)}
            <p className="text-[13px] leading-relaxed text-muted">
              The shooter throws two dice down the table. Bets go on the felt before each roll and many of them stay up for several rolls, until the dice decide them. You can put chips down before any
              roll.
            </p>
          </div>
          <h3 className="mt-4 text-[14px] font-extrabold text-gold">A hand in a minute</h3>
          <div className="mt-2 overflow-hidden rounded-xl">
            <HandDiagram />
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
            <li>
              The first roll of a hand is the <b className="text-ink">come-out</b> (the puck says <b className="text-ink">OFF</b>). A <b className="text-ink">7 or 11</b> wins the Pass Line straight away;{' '}
              <b className="text-ink">2, 3 or 12</b> (craps) loses it.
            </li>
            <li>
              Any other number (4, 5, 6, 8, 9 or 10) becomes <b className="text-ink">the point</b>: the dealer turns the puck <b className="text-ink">ON</b> and sets it on that number.
            </li>
            <li>
              Now the shooter rolls until the point comes again (the Pass Line wins, and a new come-out follows) or a <b className="text-ink">7</b> comes first: <b className="text-ink">seven out</b>, the Pass
              Line loses and the dice pass to a new shooter. Other numbers in between don't matter to the Pass Line, but they pay place bets, the Field and the rest.
            </li>
          </ol>

          <h3 className="mt-4 text-[14px] font-extrabold text-gold">The best bets to start with</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              { t: 'Pass Line', s: `Even money, house edge only ${edgeText(betReturn('pass'))}. The bet nearly everyone at a real table makes.` },
              { t: '+ Odds', s: 'Once a point is set, add odds behind your Pass Line: true odds, 0% house edge, the best bet in the casino.' },
              { t: 'Place 6 and 8', s: `Win each time a 6 or 8 rolls before a 7, at 7 to 6, edge ${edgeText(betReturn('place6'))}. They stay up after a win.` },
            ].map((x) => (
              <div key={x.t} className="rounded-lg bg-stage px-3 py-2.5">
                <div className="text-[13px] font-extrabold text-ink">{x.t}</div>
                <div className="mt-0.5 text-[12px] leading-snug text-muted">{x.s}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            The props in the middle of the table (Any 7, the hardways, the horn bets) pay big but carry the steepest house edges. The <b className="text-muted">Basic</b> view hides them, and Come / Don't
            Come, so the board shows only the line bets, odds, the Field and the place numbers (any of the others still on the table are listed over the board).
          </p>

          <h3 className="mt-4 text-[14px] font-extrabold text-gold">Playing here</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted">
            <li>
              Pick a chip, then click (tap) a spot to put it there; right-click (long-press) takes one off, if that bet may come down. Hover a spot (or long-press an empty one) to see what it
              is, how it pays and its house edge.
            </li>
            <li>
              Your bets stay on the table between rolls, and between visits: come back later and they're still there. A Pass Line bet can't be taken down once the point is set, and come bets on a number
              stay until decided, as in a casino.
            </li>
            <li>
              Place bets and hardways are <b className="text-ink">off</b> on the come-out roll (they wear an OFF button) unless you switch <b className="text-ink">Working</b> on.
            </li>
            <li>Come bets travel to their number when it rolls; tap the dashed ring beside one to give it odds.</li>
            <li>
              Keys: 1 to 8 pick a chip, Space rolls, Z undoes your last chip, C clears what can come down, R rebets the last come-out's bets, W turns Working on or off. Turbo plays the throw quicker.
            </li>
            <li>If you leave mid-roll, the roll is settled at once and you're told what it came to.</li>
          </ul>
        </>
      ) : (
        <>
          <div role="table" aria-label="Every bet: when it wins, what it pays and its house edge">
            <div className={`${GRID} pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-dim`} role="row">
              <div role="columnheader">Bet</div>
              <div className="hidden sm:block" role="columnheader">
                Wins when
              </div>
              <div className="text-right" role="columnheader">
                Pays
              </div>
              <div className="text-right" role="columnheader">
                Edge
              </div>
            </div>
            <div role="rowgroup">
                <Row name="Pass Line" k="pass" wins="7 or 11 on the come-out; the point before a 7 after" />
                <Row name="Don't Pass" k="dontPass" wins="2 or 3 on the come-out (12 ties); a 7 before the point after" />
                <Row name="Come" k="come" wins="As Pass, made with a point on; travels to its number" />
                <Row name="Don't Come" k="dontCome" wins="As Don't Pass, made with a point on" />
                <Row name="Odds behind Pass / Come" k="passOdds" wins="Its number before a 7" pay="2:1 on 4, 10 · 3:2 on 5, 9 · 6:5 on 6, 8" />
                <Row name="Lay odds behind Don't" k="dontPassOdds" wins="A 7 before its number" pay="1:2 on 4, 10 · 2:3 on 5, 9 · 5:6 on 6, 8" />
                <Row name="Place 6 or 8" k="place6" wins="Its number before a 7; stays up" />
                <Row name="Place 5 or 9" k="place5" wins="Its number before a 7; stays up" />
                <Row name="Place 4 or 10" k="place4" wins="Its number before a 7; stays up" />
                <Row name="Field" k="field" wins="One roll: 2, 3, 4, 9, 10, 11 or 12" pay="1:1 · 2 pays 2:1 · 12 pays 3:1" />
                <Row name={<>Hard 6 or 8 {dice(3, 3)}</>} k="hard6" wins="The pair before a 7 or the easy way" />
                <Row name={<>Hard 4 or 10 {dice(2, 2)}</>} k="hard4" wins="The pair before a 7 or the easy way" />
                <Row name="Any 7" k="any7" wins="One roll: 7" />
                <Row name="Any Craps" k="anyCraps" wins="One roll: 2, 3 or 12" />
                <Row name={<>Aces {dice(1, 1)}</>} k="aces" wins="One roll: 2" />
                <Row name={<>Boxcars {dice(6, 6)}</>} k="boxcars" wins="One roll: 12" />
                <Row name={<>Ace-Deuce {dice(1, 2)}</>} k="aceDeuce" wins="One roll: 3" />
                <Row name={<>Yo {dice(5, 6)}</>} k="yo" wins="One roll: 11" />
                <Row name="Fire Bet" k="fire" wins="The shooter makes 4, 5 or 6 different points" pay={`${FIRE_PAYS[4]} / ${FIRE_PAYS[5]} / ${FIRE_PAYS[6]} to 1`} />
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            House edge is per bet decided (place bets and hardways counted while they work). Odds pay exactly true odds, so they carry no edge at all: the more of your bet sits in odds, the lower the edge
            on the whole.
          </p>
          <h3 className="mt-4 text-[14px] font-extrabold text-gold">Limits</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted">
            <li>
              Odds behind Pass and Come: up to {ODDS_MAX[4]}× the bet on 4 and 10, {ODDS_MAX[5]}× on 5 and 9, {ODDS_MAX[6]}× on 6 and 8. Lay odds may win up to {LAY_MAX_WIN}× the bet they back.
            </li>
            <li>
              Line, place, Field and hardway bets up to {fmt(LIMIT_FLAT, 0)} each; one-roll props up to {fmt(LIMIT_PROP, 0)}; the Fire Bet up to {fmt(LIMIT_FIRE, 0)}, before the shooter's first roll,
              and it rides the whole hand (the sixth point pays the moment it's made).
            </li>
            <li>
              Come odds are off on the come-out roll (returned if their come bet is decided then); don't come odds always work. A 12 on the come-out ties Don't Pass and Don't Come (
              <span style={{ color: RED }}>bar 12</span>).
            </li>
          </ul>
        </>
      )}
    </Modal>
  )
}
