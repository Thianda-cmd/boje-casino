import type { ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { fmt } from '../../lib/format'
import { BATCH_SHOTS, BULLET_LIFE, CHAIN_MAX, RTP, SPECIES, WHEEL, WHEEL_MEAN, chanceLabel, multLabel, payoutFor, speciesOf, type FishId } from './rules'
import { INK, Portrait, chip } from './art'

/*
  The paytable: every creature as the stage draws it, with what it pays and its exact catch chance (97% ÷ its
  multiplier), what the three specials do, the treasure wheel's segments, and the few rules worth knowing. The coin
  amounts follow the cannon's current cost.
*/

const pct = Math.round(RTP * 100)

export function Paytable({ portraits, cost, onClose }: { portraits: Partial<Record<FishId, string>>; cost: number; onClose: () => void }) {
  const creatures = SPECIES.filter((s) => s.kind === 'fish' || s.kind === 'boss')
  return (
    <Modal onClose={onClose} title="Reef Raid paytable" width={540}>
      <p className="text-[13px] leading-relaxed text-muted">
        Each torpedo costs the cannon&apos;s shot cost (1 to 100 coins) and bursts into a net on the first creature it touches. That creature is caught with a chance of exactly {pct}% divided by its
        multiplier, and a catch pays its multiplier × the shot. So every shot returns {pct}% on average, whatever you aim at: big creatures pay more but are caught less often.
      </p>

      <Section title="Creatures" right={`at ${fmt(cost, 0)} a shot`}>
        <div className="grid grid-cols-[54px_1fr_auto_auto] items-center gap-x-3 px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-dim">
          <span />
          <span>Creature</span>
          <span className="text-right">Chance</span>
          <span className="w-[64px] text-right sm:w-[118px]">Pays</span>
        </div>
        <div className="flex flex-col gap-1">
          {creatures.map((s) => (
            <div key={s.id} className={`grid grid-cols-[54px_1fr_auto_auto] items-center gap-x-3 rounded-lg px-2 py-0.5 ${s.kind === 'boss' ? 'bg-[linear-gradient(90deg,rgba(255,201,60,.16),rgba(255,201,60,.04))] ring-1 ring-gold/30' : 'bg-stage'}`}>
              <Portrait id={s.id} src={portraits[s.id]} size={54} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-extrabold">{s.name}</span>
                <span className="block truncate text-[11px] font-semibold text-dim">{s.blurb}</span>
              </span>
              <span className="tnum text-right text-[13px] font-extrabold text-gold">{chanceLabel(s.mult)}</span>
              <span className="tnum flex w-[64px] items-center justify-end gap-1.5 whitespace-nowrap text-right text-[13px] font-extrabold sm:w-[118px]">
                <MultPill label={multLabel(s.mult)} color={s.color} />
                <span className="hidden sm:inline">{fmt(payoutFor(cost, s.mult), payoutFor(cost, s.mult) >= 1000 ? 0 : 2)}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Specials">
        <div className="flex flex-col gap-1.5">
          <Special id="crab" portrait={portraits.crab} chance={`${chanceLabel(10)} on its own`}>
            Caught, it blows up and nets every creature in the blast too, each paying its own multiplier on top of the crab&apos;s 10×. It is all one catch: its chance is {pct}% ÷ the
            whole value, so a crowded blast is rarer and pays more.
          </Special>
          <Special id="jelly" portrait={portraits.jelly} chance={`${chanceLabel(5)} on its own`}>
            Caught, its lightning jumps to up to {CHAIN_MAX} creatures nearby, nearest first, and nets them all: 5× plus each one&apos;s multiplier, at {pct}% ÷ that total.
          </Special>
          <Special id="chest" portrait={portraits.chest} chance={chanceLabel(WHEEL_MEAN)}>
            Caught, it opens and spins the treasure wheel for 20× to 150×. Its chance is {pct}% ÷ the wheel&apos;s average ({multLabel(WHEEL_MEAN)}), so it returns {pct}% too.
          </Special>
        </div>
      </Section>

      <Section title="Treasure wheel" right="each 1 in 8">
        <div className="flex flex-wrap gap-1.5">
          {WHEEL.map((m, i) => (
            <span key={i} className="tnum rounded-full border-2 px-2.5 py-0.5 text-[12.5px] font-black" style={{ borderColor: INK, background: m >= 80 ? '#ffd23a' : '#fff4d6', color: INK }}>
              {m}×
            </span>
          ))}
        </div>
      </Section>

      <Section title="Good to know">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12.5px] leading-relaxed text-muted marker:text-dim">
          <li>The Golden Whale surfaces every couple of minutes (a banner warns you first) and crosses slowly. It pays 200× at {chanceLabel(200)}.</li>
          <li>Now and then a tide sweeps the reef clear and a formation swims in. It changes the show, never the odds.</li>
          <li>Lock a creature and your torpedoes home in on it and touch nothing else.</li>
          <li>A torpedo that touches nothing for {BULLET_LIFE} seconds fizzles, and its cost comes back.</li>
          <li>Catches are paid the moment the net closes (a chest&apos;s as its wheel lands). Your shots go into your bet history in batches of {BATCH_SHOTS}, or once you stop firing.</li>
          <li>Leave or close the page with torpedoes in the water and their cost comes back (and a chest&apos;s win, if its wheel was still spinning).</li>
        </ul>
      </Section>

      <Section title="Controls">
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] text-muted sm:grid-cols-2">
          <Key k="Click / hold">Fire at the pointer</Key>
          <Key k="Space">Hold to fire</Key>
          <Key k="A">Auto fire</Key>
          <Key k="L">Lock mode (Esc lets go)</Key>
          <Key k="1 – 7">Cannon level</Key>
          <Key k="Q / E · wheel">Level down / up</Key>
        </div>
        <p className="mt-2 text-[12px] text-dim">On a phone: tap or hold the reef to fire, and use the buttons by the cannon.</p>
      </Section>
    </Modal>
  )
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-extrabold">{title}</h3>
        {right && <span className="tnum text-[11.5px] font-semibold text-dim">{right}</span>}
      </div>
      {children}
    </section>
  )
}

function MultPill({ label, color }: { label: string; color: string }) {
  return (
    <span className="rounded-full border-2 px-1.5 text-[11.5px] font-black leading-[16px]" style={{ ...chip(color), borderColor: INK }}>
      {label}
    </span>
  )
}

function Special({ id, portrait, chance, children }: { id: FishId; portrait?: string; chance: string; children: ReactNode }) {
  const s = speciesOf(id)
  return (
    <div className="flex gap-3 rounded-lg bg-stage px-2 py-2">
      <Portrait id={id} src={portrait} size={56} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-extrabold">{s.name}</span>
          <MultPill label={id === 'chest' ? '20–150×' : multLabel(s.mult)} color={s.color} />
          <span className="tnum ml-auto text-[11.5px] font-extrabold text-gold">{chance}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  )
}

function Key({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="tnum min-w-[2.2rem] font-sans rounded-md border border-line bg-raised px-1.5 py-0.5 text-center text-[11px] font-bold text-ink">{k}</kbd>
      <span>{children}</span>
    </div>
  )
}
