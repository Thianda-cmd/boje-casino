import type { ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { CITIES, PERKS, STAR_BONUS, offlineLimit, type Save } from './engine'
import { CashIcon, ManagerFace, StarIcon } from './art'
import { VaultDoorIcon } from './door'
import { MILESTONE_COINS } from './words'

/*
  "How it works": Cash against coins (the one thing to understand: coins only ever come from the vault, the
  milestones and golden chips), rounds and managers, time away, count steps and upgrades, Stars and cities, perks,
  and the whale and the golden chip.
*/

/** small drawn badges for the parts that have no art of their own */
const glyph = (children: ReactNode) => (
  <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
    <g stroke="#25183a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      {children}
    </g>
  </svg>
)
const PADLOCK = glyph(
  <>
    <path d="M10 14V9.5a6 6 0 0 1 11.6-2.2" fill="none" stroke="#c9d3e0" strokeWidth="3" />
    <rect x="6.5" y="14" width="19" height="14" rx="3" fill="#ffd23f" />
    <circle cx="16" cy="20.2" r="2" fill="#25183a" />
  </>,
)
const TOP_HAT = glyph(
  <>
    <path d="M4 23.5c6-2.4 18-2.4 24 0" fill="none" strokeWidth="2.6" />
    <path d="M9.5 22.6V7.5h13v15.1Z" fill="#2a2233" />
    <path d="M9.5 18h13" stroke="#ffd23f" strokeWidth="2.6" />
    <circle cx="24.5" cy="11" r="2.6" fill="#fff6cf" />
  </>,
)
const TROPHY = glyph(
  <>
    <path d="M10 5h12v7a6 6 0 0 1-12 0Z" fill="#ffd23f" />
    <path d="M10 7.5H6.5c0 3.4 1.6 5.4 4.2 5.8M22 7.5h3.5c0 3.4-1.6 5.4-4.2 5.8" fill="none" />
    <path d="M16 18v4.5M11 27h10l-1.2-4.5h-7.6Z" fill="#e8a42a" />
  </>,
)

function Part({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl bg-stage px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-extrabold text-ink">{title}</div>
        <div className="mt-0.5 text-pretty text-[12.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  )
}

export function HowItWorks({ s, onClose }: { s: Save; onClose: () => void }) {
  const hours = offlineLimit(s) / 3_600_000
  return (
    <Modal onClose={onClose} title="How Casino Tycoon works" width={520}>
      <p className="text-[13px] leading-relaxed text-muted">Build a casino from a single claw machine to penthouse suites, and let it make money while you're away. Two kinds of money:</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-[#3fc96a]/[.08] px-3 py-2.5 ring-1 ring-[#3fc96a]/25">
          <div className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-[#5fe39a]">
            <CashIcon size={18} /> Cash
          </div>
          <div className="mt-1 text-[12.5px] leading-snug text-muted">The casino's own money. It grows to huge numbers and buys everything here. It never turns into coins.</div>
        </div>
        <div className="rounded-xl bg-gold/[.08] px-3 py-2.5 ring-1 ring-gold/25">
          <div className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-gold">
            <Coin size={16} /> Coins
          </div>
          <div className="mt-1 text-[12.5px] leading-snug text-muted">Your real balance on the site. Only the Coin Vault, milestones and golden chips pay them.</div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <Part icon={<VaultDoorIcon size={36} />} title="The Coin Vault">
          It fills with coins every hour, faster the more attractions you have open, the more Stars you hold and the bigger your city. It holds a few hours' worth, then stops: come back and collect it.
        </Part>
        <Part icon={<ManagerFace i={1} size={36} />} title="Rounds and managers">
          Each attraction plays rounds, and every round pays Cash. Without a manager it only plays when you tap Run (hold it to keep playing, or tap the attraction on the floor). Hire its manager and it runs on its own, also while you're away, for up to {hours} hours.
        </Part>
        <Part icon={<span className="text-[20px] font-black text-[#5fe39a]">×2</span>} title="Buying more">
          Every one you buy adds to what a round pays. Own 25, 50 and 100 of one and it runs twice as fast each time; from 200, every 100 more doubles its pay. When every attraction reaches 25, 50, 100 and 200, all pay doubles. Upgrades double pay too.
        </Part>
        <Part icon={<StarIcon size={30} />} title="Stars and cities">
          The more Cash you earn in all, the more Stars selling the casino brings. Each Star adds {Math.round(STAR_BONUS * 100)}% to all pay, for good. Selling starts a new casino (you keep the Stars, the vault and your milestones; any waiting to be claimed are paid as you sell), and enough Stars move it to a bigger city: {CITIES.slice(1)
            .map((c) => `${c.name} (${c.stars.toLocaleString('en-US')})`)
            .join(', ')}
          . Each city fills the vault faster and lets it hold more.
        </Part>
        <Part icon={PADLOCK} title="Perks">
          Stars also unlock perks for good: {PERKS.map((p) => `${p.name} at ${p.stars.toLocaleString('en-US')}`).join(', ')}.
        </Part>
        <Part icon={TOP_HAT} title="Whales and golden chips">
          Now and then, while you play, a whale in a gold suit walks in and waits by the vault for 20 seconds: tap him and all pay is ×5 for 45 seconds. Golden chips turn up on the floor too: catch one for a few real coins.
        </Part>
        <Part icon={TROPHY} title="Milestones">
          One-time goals, from opening each attraction to reaching Monaco Heights, worth {MILESTONE_COINS.toLocaleString('en-US')} coins in all. Claim them in the Milestones tab.
        </Part>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-dim">Drag the floor to look around, scroll or pinch to zoom, and tap an attraction to find it in the panel. Your casino is saved as you play, with your wallet.</p>
    </Modal>
  )
}
