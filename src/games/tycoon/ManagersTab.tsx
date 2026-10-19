import { memo } from 'react'
import { motion } from 'framer-motion'
import { ATTRACTIONS, N_ATTR, fmtCash, hasPerk, managerCost, offlineLimit, type Save } from './engine'
import { AttractionIcon, CashIcon, ManagerFace } from './art'
import { MANAGERS } from './words'

/*
  The Managers tab: one manager for each attraction. Hiring one runs it on its own from then on, round after round,
  also while the player is away (up to the offline limit). Each shows who they are, what they run and their price;
  one whose attraction isn't open yet waits for it. (Drawn again only when one of those changes: the page draws a
  few times a second.)
*/

/** what the tab shows of a save: each manager hired, hireable, waiting or not open; the perks */
const shown = (s: Save) => `${offlineLimit(s)}|${hasPerk(s.stars, 0)}|${s.managers.map((m, i) => (!s.owned[i] ? 'x' : m ? 'h' : managerCost(s, i) <= s.cash ? 'c' : 'w')).join('')}`

export const ManagersTab = memo(function ManagersTab({ s, onHire }: { s: Save; onHire: (i: number) => void }) {
  const hours = offlineLimit(s) / 3_600_000
  const hired = s.managers.filter((m, i) => m && s.owned[i] > 0).length
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl bg-sky/[.07] px-3 py-2.5 text-[12.5px] font-semibold leading-snug text-muted ring-1 ring-sky/15">
        A manager runs their attraction round after round, <b className="text-white">also while you're away</b> (up to {hours} hours).
        {hasPerk(s.stars, 0) && <span className="text-sky"> Trusted name: managers cost 25% less.</span>}
        <span className="mt-1 block text-[11.5px] text-dim">
          {hired} of {N_ATTR} hired
        </span>
      </div>
      {MANAGERS.map((m, i) => {
        const open = s.owned[i] > 0
        const on = s.managers[i] && open
        const cost = managerCost(s, i)
        const can = open && !on && cost <= s.cash
        return (
          <div key={i} className={`flex items-center gap-3 rounded-2xl p-2.5 ${on ? 'bg-sky/[.07] shadow-[inset_0_0_0_1px_rgba(76,180,255,.2)]' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]'}`}>
            <div className="relative shrink-0">
              <div className={`flex h-[52px] w-[52px] items-end justify-center overflow-hidden rounded-[14px] ${on ? 'bg-sky/20' : 'bg-black/30'}`}>
                <ManagerFace i={i} size={50} off={!open} />
              </div>
              <span className="absolute -bottom-1 -right-1">
                <AttractionIcon i={i} size={24} dim={!open} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-extrabold text-ink">{m.name}</div>
              <div className="text-[12px] font-semibold leading-snug text-muted">Runs the {ATTRACTIONS[i].name}</div>
              <div className="truncate text-[11.5px] italic text-dim">{m.line}</div>
            </div>
            {on ? (
              <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky/15 px-3 text-[12.5px] font-black text-sky">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
                Hired
              </span>
            ) : open ? (
              <motion.button
                whileTap={can ? { scale: 0.95 } : undefined}
                onClick={() => onHire(i)}
                disabled={!can}
                className="flex h-9 shrink-0 flex-col items-center justify-center rounded-lg bg-sky px-3 text-[12.5px] font-black leading-none text-[#03233a] shadow-[inset_0_-2px_0_rgba(0,0,0,.15)] transition hover:brightness-110 disabled:bg-white/[.05] disabled:text-white/40 disabled:shadow-none"
              >
                <span>Hire</span>
                <span className="tnum mt-0.5 flex items-center gap-1 text-[11px] opacity-80">
                  <CashIcon size={11} />
                  {fmtCash(cost)}
                </span>
              </motion.button>
            ) : (
              <span className="shrink-0 text-right text-[11.5px] font-bold leading-tight text-dim">
                Open the
                <br />
                {ATTRACTIONS[i].name.split(' ')[0]} first
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}, (a, b) => a.onHire === b.onHire && shown(a.s) === shown(b.s))
