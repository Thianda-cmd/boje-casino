import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Chip, chipLabel } from '../../art/Chip'
import { IconUsers } from '../../components/icons'
import { SPOTS, type Booster, type Spot, type Stakes } from './rules'
import { SpotBadge } from './art'
import { LOOK } from './words'

/*
  The betting board: the eight spots, the four numbers then the four bonus rounds. A tap puts the chip on a spot. Each
  spot shows how many players are on it this round; the Booster's spot wears its multiplier; at the result the winning
  spot glows and the rest dim.
*/

export const Board = memo(function Board({
  stakes,
  onBet,
  open,
  boost,
  winner,
  totals,
}: {
  stakes: Stakes
  onBet: (s: Spot) => void
  open: boolean
  boost: Booster | null
  winner: Spot | null
  /** everyone's chips on each spot this round */
  totals?: Record<Spot, { total: number; players: number }>
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:gap-2 xl:grid-cols-8">
      {SPOTS.map((s) => {
        const L = LOOK[s]
        const on = stakes[s] ?? 0
        const boosted = boost?.spot === s
        const won = winner === s
        const dim = !!winner && !won
        const crowd = totals?.[s]
        return (
          <button
            key={s}
            onClick={() => onBet(s)}
            disabled={!open}
            aria-label={`${L.name}: ${L.line}${on ? `, ${on} on it` : ''}`}
            title={crowd?.players ? `${crowd.players} ${crowd.players === 1 ? 'player' : 'players'}, ${Math.round(crowd.total).toLocaleString('en-US')} on ${L.name}` : undefined}
            className={`group relative flex h-[76px] min-w-0 flex-col justify-between overflow-hidden rounded-xl p-2 text-left transition sm:h-[92px] sm:p-2.5 ${
              open ? 'hover:-translate-y-0.5 active:translate-y-0' : 'cursor-default'
            } ${dim ? 'opacity-45' : ''}`}
            style={{
              background: `linear-gradient(160deg, ${L.face}33, ${L.deep}22 55%, #0d0a24 100%)`,
              boxShadow: won ? `0 0 0 2px ${L.face}, 0 0 28px -4px ${L.face}` : `inset 0 0 0 1px ${L.face}40`,
            }}
          >
            <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: L.face }} />
            {won && <motion.span className="absolute inset-0" style={{ background: L.face }} initial={{ opacity: 0.35 }} animate={{ opacity: [0.35, 0.12, 0.35] }} transition={{ duration: 1.1, repeat: Infinity }} />}
            <span className="relative flex min-w-0 items-center gap-1.5">
              <SpotBadge spot={s} size={24} className="shrink-0 sm:h-7 sm:w-7" />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-black leading-tight text-white sm:text-[14px]">
                  <span className="sm:hidden">{s.length <= 2 ? `Pays ${s}:1` : L.short}</span>
                  <span className="max-sm:hidden">{s.length <= 2 ? `Number ${s}` : L.name}</span>
                </span>
                <span className="hidden truncate text-[10.5px] font-semibold leading-tight text-white/55 sm:block">{L.line}</span>
              </span>
            </span>
            <span className="relative flex items-end justify-between gap-1">
              <AnimatePresence>
                {boosted && (
                  <motion.span
                    key="boost"
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    className="tnum rounded-md bg-[linear-gradient(180deg,#fff1b8,#f7c548_55%,#c98d14)] px-1.5 py-0.5 text-[12px] font-black text-[#3a2400] shadow-[0_4px_12px_-4px_rgba(247,197,72,.8)] sm:text-[13px]"
                  >
                    ×{boost!.mult}
                  </motion.span>
                )}
              </AnimatePresence>
              {!!crowd?.players && !boosted && (
                <span className="tnum flex items-center gap-0.5 rounded-full bg-black/35 px-1.5 py-px text-[10.5px] font-bold text-white/70">
                  <IconUsers size={11} />
                  {crowd.players}
                </span>
              )}
              <span className="ml-auto flex items-center">
                <AnimatePresence mode="popLayout">
                  {on > 0 && (
                    <motion.span key="chip" initial={{ scale: 0.4, y: -18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 26 }}>
                      <motion.span key={on} initial={{ y: -5 }} animate={{ y: 0 }} className="block">
                        <Chip value={on} size={34} label={chipLabel(on)} className="drop-shadow-[0_4px_6px_rgba(0,0,0,.5)] sm:h-10 sm:w-10" />
                      </motion.span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
})
