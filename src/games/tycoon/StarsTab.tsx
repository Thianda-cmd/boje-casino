import { memo } from 'react'
import { motion } from 'framer-motion'
import { CITIES, PERKS, STAR_BONUS, cityIndex, fmtCash, starsFor, starsOnSale, type Save } from './engine'
import { CityEmblem, StarIcon } from './art'
import { CITY_LINES, nextStarAt } from './words'

/*
  The Stars tab: the casino's reputation. Stars held and the pay they add; what selling now would bring (and how
  much more every attraction would pay for it), with the Sell button (the page asks again before it sells); the
  five cities, the one the casino stands in and how far the next one is; and the perks Stars unlock for good. (Drawn
  again only when one of those changes: the page draws a few times a second.)
*/

const pct = (stars: number) => `+${Math.round(stars * STAR_BONUS * 100).toLocaleString('en-US')}%`
const mult = (stars: number) => `×${(1 + stars * STAR_BONUS).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

/** each perk's little picture */
const PERK_ICONS = [
  // a price tag: managers for less
  <path key="0" d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0ZM8 8h.1" />,
  // the moon: the night shift
  <path key="1" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />,
  // a bigger vault
  <g key="2">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v5.5M12 15v5.5M3.5 12H9M15 12h5.5" />
  </g>,
  // a head start: a flag
  <path key="3" d="M5 21V4M5 4.5c4-2 6 2 10 0s4-.5 4-.5v9s-1 1.5-4 .5-6-2-10 0" />,
  // legendary: lightning
  <path key="4" d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12Z" />,
]

/** what the tab shows of a save: the Stars, a sale's, the Cash earned and how near the next Star is (in percent) */
const shown = (s: Save) => `${s.stars}|${s.sales}|${starsOnSale(s)}|${fmtCash(s.lifetime)}|${Math.round(Math.min(1, s.lifetime / nextStarAt(s)) * 100)}`

export const StarsTab = memo(function StarsTab({ s, onSell }: { s: Save; onSell: () => void }) {
  const add = starsOnSale(s)
  const city = cityIndex(s.stars)
  const next = CITIES[city + 1]
  const nextAt = nextStarAt(s)
  const toFirst = starsFor(s.lifetime) <= s.stars
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative overflow-hidden rounded-2xl p-3.5 ring-1 ring-gold/20" style={{ background: 'radial-gradient(120% 140% at 0% 0%, #3d2f10 0%, #1c2433 55%, #142131 100%)' }}>
        <div className="flex items-center gap-3">
          <StarIcon size={46} />
          <div className="min-w-0">
            <div className="tnum text-[26px] font-black leading-none text-white">{s.stars.toLocaleString('en-US')}</div>
            <div className="mt-1 text-[12.5px] font-bold text-gold">{s.stars ? `Stars: all pay ${pct(s.stars)}` : 'No Stars yet'}</div>
          </div>
          <div className="ml-auto text-right text-[11.5px] font-semibold leading-snug text-dim">
            {s.sales ? `Sold ${s.sales}×` : 'Never sold'}
            <br />
            <span className="tnum">{fmtCash(s.lifetime)} earned in all</span>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-black/30 p-3">
          {add > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-bold text-muted">Sell now for</span>
                <span className="tnum flex items-center gap-1 text-[20px] font-black text-gold">
                  +{add.toLocaleString('en-US')} <StarIcon size={18} />
                </span>
              </div>
              <div className="tnum mt-0.5 text-[12px] font-semibold text-dim">
                All pay {mult(s.stars)} → <b className="text-[#5fe39a]">{mult(s.stars + add)}</b> on your next casino · next Star at {fmtCash(nextAt)} earned
              </div>
            </>
          ) : (
            <>
              <div className="text-[12.5px] font-bold text-muted">{toFirst && !s.stars ? 'Your first Star' : 'The next Star'} comes once you have earned</div>
              <div className="tnum mt-0.5 text-[18px] font-black text-white">{fmtCash(nextAt)} Cash in all</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
                <div className="h-full origin-left rounded-full bg-gold transition-transform duration-500" style={{ transform: `scaleX(${Math.min(1, s.lifetime / nextAt)})` }} />
              </div>
            </>
          )}
          <motion.button
            whileTap={add > 0 ? { scale: 0.97 } : undefined}
            onClick={onSell}
            disabled={add <= 0}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] text-[15px] font-black text-[#3a2400] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] transition hover:brightness-105 disabled:from-white/[.06] disabled:to-white/[.04] disabled:text-white/40 disabled:shadow-none"
          >
            Sell the casino{add > 0 ? ` for ${add.toLocaleString('en-US')} Stars` : ''}
          </motion.button>
          <p className="mt-2 text-pretty text-[11.5px] leading-snug text-dim">Selling starts a new casino with your Stars. You keep the Coin Vault and your milestones (any waiting are paid as you sell); Cash, attractions, managers and upgrades start over.</p>
        </div>
      </div>

      <div className="px-0.5 pt-1 text-[12px] font-extrabold uppercase tracking-wider text-dim">Cities</div>
      <div className="flex flex-col gap-1.5">
        {CITIES.map((c, k) => {
          const here = k === city
          const reached = k <= city
          return (
            <div key={c.name} className={`flex items-center gap-3 rounded-2xl p-2.5 ${here ? 'bg-gold/[.08] shadow-[inset_0_0_0_1.5px_rgba(247,197,72,.5)]' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]'}`}>
              <CityEmblem k={k} size={44} off={!reached} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`truncate text-[13.5px] font-extrabold ${reached ? 'text-ink' : 'text-muted'}`}>{c.name}</span>
                  {here && <span className="rounded-full bg-gold px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-[#3a2400]">You are here</span>}
                </div>
                <div className="text-pretty text-[11.5px] leading-snug text-dim">{CITY_LINES[k]}</div>
                <div className="tnum mt-0.5 text-[11px] font-bold text-muted">
                  Coin Vault {k ? `+${3 * k} coins/h, ` : ''}holds {4 + k}h
                </div>
                {k === city + 1 && next && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/40">
                    <div className="h-full origin-left rounded-full bg-gold/80 transition-transform duration-500" style={{ transform: `scaleX(${Math.min(1, s.stars / next.stars)})` }} />
                  </div>
                )}
              </div>
              <span className={`tnum flex shrink-0 items-center gap-1 text-[12.5px] font-black ${reached ? 'text-gold' : 'text-dim'}`}>
                {c.stars ? c.stars.toLocaleString('en-US') : 'Start'}
                {c.stars > 0 && <StarIcon size={14} />}
              </span>
            </div>
          )
        })}
      </div>

      <div className="px-0.5 pt-1 text-[12px] font-extrabold uppercase tracking-wider text-dim">Perks</div>
      <div className="flex flex-col gap-1.5">
        {PERKS.map((p, k) => {
          const on = s.stars >= p.stars
          return (
            <div key={p.name} className={`flex items-center gap-3 rounded-2xl p-2.5 ${on ? 'bg-accent/[.07] shadow-[inset_0_0_0_1px_rgba(34,211,111,.25)]' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]'}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-accent/15 text-accent' : 'bg-black/30 text-dim'}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {PERK_ICONS[k]}
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[13.5px] font-extrabold ${on ? 'text-ink' : 'text-muted'}`}>{p.name}</div>
                <div className="text-pretty text-[12px] leading-snug text-dim">{p.text}</div>
              </div>
              <span className={`tnum flex shrink-0 items-center gap-1 text-[12.5px] font-black ${on ? 'text-accent' : 'text-dim'}`}>
                {on ? 'Unlocked' : p.stars.toLocaleString('en-US')}
                {!on && <StarIcon size={14} />}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}, (a, b) => a.onSell === b.onSell && shown(a.s) === shown(b.s))
