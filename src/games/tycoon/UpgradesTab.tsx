import { memo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ATTRACTIONS, UPGRADES, fmtCash, type Save, type Upgrade } from './engine'
import { AttractionIcon, CashIcon } from './art'

/*
  The Upgrades tab: 33 upgrades, each doubling what one attraction pays (the last of each round doubles the whole
  floor). The ones still to buy come in price order, so the next affordable ones are on top, a few at a time with
  how close the Cash is to the rest; the ones owned fold away underneath. (Drawn again only when one of those
  changes: the page draws a few times a second.)
*/

/** how many still-to-buy upgrades show before "Show more" */
const SHOWN = 6

/** the round's name ("Gold trim") and what it doubles */
const parts = (u: Upgrade) => ({ title: u.name.split(':')[0], what: u.target < 0 ? 'The whole floor' : ATTRACTIONS[u.target].name })

/** the whole floor's upgrade: a burst of light in gold */
function FloorBadge({ size }: { size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#ffe08a55] to-[#f2a93b22] shadow-[inset_0_0_0_1px_rgba(247,197,72,.4)]" style={{ width: size, height: size }}>
      <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2Z" fill="#ffd23f" stroke="#25183a" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="19" cy="18.5" r="1.8" fill="#fff6cf" stroke="#25183a" strokeWidth="1" />
        <circle cx="5" cy="4.8" r="1.3" fill="#fff6cf" stroke="#25183a" strokeWidth="1" />
      </svg>
    </span>
  )
}

const Target = ({ u, size, dim }: { u: Upgrade; size: number; dim?: boolean }) => (u.target < 0 ? <FloorBadge size={size} /> : <AttractionIcon i={u.target} size={size} dim={dim} />)

/** what the tab shows of a save: each upgrade owned, affordable or how near (in tenths), and the attractions open */
const shown = (s: Save) => `${s.owned.map((n) => (n ? 1 : 0)).join('')}|${UPGRADES.map((u) => (s.upgrades.includes(u.id) ? 'o' : u.cost <= s.cash ? 'c' : Math.floor((s.cash / u.cost) * 10))).join('')}`

export const UpgradesTab = memo(function UpgradesTab({ s, onUpgrade }: { s: Save; onUpgrade: (id: string) => void }) {
  const [more, setMore] = useState(false)
  const [showOwned, setShowOwned] = useState(false)
  const left = UPGRADES.filter((u) => !s.upgrades.includes(u.id))
  const owned = UPGRADES.filter((u) => s.upgrades.includes(u.id))
  const shown = more ? left : left.slice(0, SHOWN)
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl bg-violet/[.08] px-3 py-2.5 text-[12.5px] font-semibold leading-snug text-muted ring-1 ring-violet/20">
        Each upgrade <b className="text-white">doubles</b> what an attraction pays, for good (until you sell the casino). {owned.length} of {UPGRADES.length} bought.
      </div>
      {shown.map((u) => {
        const { title, what } = parts(u)
        const can = u.cost <= s.cash
        const useless = u.target >= 0 && s.owned[u.target] === 0
        return (
          <div key={u.id} className={`flex items-center gap-3 rounded-2xl p-2.5 ${can ? 'bg-violet/[.08] shadow-[inset_0_0_0_1px_rgba(155,123,255,.28)]' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]'}`}>
            <Target u={u} size={44} dim={useless} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-extrabold text-ink">{title}</div>
              <div className="truncate text-[12px] font-semibold text-muted">
                {what} pays <b className="text-[#c4b0ff]">×2</b>
                {useless && <span className="text-dim"> · not open yet</span>}
              </div>
              {!can && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/40">
                  <div className="h-full origin-left rounded-full bg-violet/70 transition-transform duration-500" style={{ transform: `scaleX(${Math.min(1, s.cash / u.cost)})` }} />
                </div>
              )}
            </div>
            <motion.button
              whileTap={can ? { scale: 0.95 } : undefined}
              onClick={() => onUpgrade(u.id)}
              disabled={!can}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#b49dff] to-[#8a66ff] px-3 text-[12.5px] font-black text-white shadow-[inset_0_-2px_0_rgba(0,0,0,.18)] transition hover:brightness-110 disabled:from-white/[.06] disabled:to-white/[.04] disabled:text-white/40 disabled:shadow-none"
            >
              <span className="tnum flex items-center gap-1">
                <CashIcon size={13} />
                {fmtCash(u.cost)}
              </span>
            </motion.button>
          </div>
        )
      })}
      {left.length > SHOWN && (
        <button onClick={() => setMore((m) => !m)} className="h-9 rounded-xl bg-white/[.04] text-[12.5px] font-bold text-muted transition hover:bg-white/[.07] hover:text-ink">
          {more ? 'Show fewer' : `Show ${left.length - SHOWN} more`}
        </button>
      )}
      {!left.length && <div className="rounded-xl bg-violet/[.08] px-3 py-4 text-center text-[13px] font-bold text-[#c4b0ff]">Every upgrade bought. Spared no expense!</div>}
      {owned.length > 0 && (
        <div className="mt-1">
          <button onClick={() => setShowOwned((o) => !o)} className="flex w-full items-center justify-between rounded-xl px-1 py-1.5 text-[12px] font-extrabold uppercase tracking-wider text-dim hover:text-muted">
            Owned · {owned.length}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className={`transition-transform ${showOwned ? 'rotate-180' : ''}`} aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {showOwned && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {owned.map((u) => {
                    const { title, what } = parts(u)
                    return (
                      <span key={u.id} className="flex items-center gap-1.5 rounded-full bg-white/[.04] py-0.5 pl-0.5 pr-2.5 text-[11.5px] font-bold text-muted" title={`${title}: ${what} ×2`}>
                        <Target u={u} size={22} />
                        {title} · {what}
                      </span>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}, (a, b) => a.onUpgrade === b.onUpgrade && shown(a.s) === shown(b.s))
