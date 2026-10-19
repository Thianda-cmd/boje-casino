/*
  The reward history: what the player has collected lately (the wallet keeps the latest 40, newest first). A bar split
  by kind shows where the coins came from, with the biggest kinds' totals under it (the rest behind "+ more", so the
  list keeps its room), and the timeline lists the rewards with when they came in. Each row says what it was for
  once: a mission by its own title where the day's missions tell, and the kind only when the title doesn't already
  name it. Beside the daily bonus on a wide screen the card takes that card's height and its list scrolls; stacked on
  a phone the list scrolls within a fixed height.
*/
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { RewardKind } from '../../store/rewards'
import { useWallet } from '../../store/wallet'
import { IconHistory } from '../../components/icons'
import { fmt } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import { sfx } from '../../lib/sound'
import { Coins, EASE, Eyebrow, KINDS, KindTile, Panel, timeAgo } from './kit'
import { historyTitle } from './ready'

/** kinds named under the bar before the rest fold into "+ more" */
const LEGEND = 4

export function RewardLog() {
  const now = useNow(30_000)
  const log = useWallet((s) => s.rewardLog) ?? []
  const [allKinds, setAllKinds] = useState(false)
  const totals = new Map<RewardKind, number>()
  for (const e of log) totals.set(e.kind, (totals.get(e.kind) ?? 0) + e.amount)
  const byKind = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const sum = byKind.reduce((a, [, v]) => a + v, 0)
  // keys that stay put as new rewards arrive on top: several claimed in the same instant (Claim all) can share a time,
  // kind and label, so identical ones are numbered from the oldest up
  const seen = new Map<string, number>()
  const keys = log.map(() => '')
  for (let i = log.length - 1; i >= 0; i--) {
    const base = `${log[i].time}${log[i].kind}${log[i].label}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    keys[i] = `${base}#${n}`
  }

  return (
    <Panel className="flex flex-col lg:h-0 lg:min-h-full">
      {/* a compact head: this card is for reading, so the list gets the room */}
      <div className="flex items-center justify-between gap-3">
        <Eyebrow className="text-muted">
          <IconHistory size={18} /> Reward history
        </Eyebrow>
        {log.length > 0 && (
          <span className="tnum flex shrink-0 items-center gap-1.5 text-[12px] font-bold text-dim">
            Last {log.length}
            <Coins amount={sum} digits={sum % 1 ? 2 : 0} size={14} className="text-[15px] font-black text-gold" />
          </span>
        )}
      </div>

      {log.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-line px-4 py-8 text-center">
          <div className="flex -space-x-2">
            {(['daily', 'mission', 'wheel'] as const).map((k) => (
              <KindTile key={k} color={KINDS[k].color} size={36} className="bg-panel ring-2 ring-panel">
                {KINDS[k].icon(18)}
              </KindTile>
            ))}
          </div>
          <p className="mt-3 max-w-[260px] text-pretty text-[13px] text-muted">Every reward you collect shows up here: the daily bonus, missions, the wheel, rakeback and more.</p>
        </div>
      ) : (
        <>
          {/* where the coins came from */}
          <div className="mt-3.5 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-stage">
            {byKind.map(([k, v], i) => (
              <motion.span
                key={k}
                className="h-full min-w-[3px] origin-left"
                style={{ flex: `${v} 1 0`, background: KINDS[k].color }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: EASE }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {(allKinds ? byKind : byKind.slice(0, LEGEND)).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5 text-[11.5px] font-bold text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: KINDS[k].color }} />
                {KINDS[k].name}
                <span className="tnum text-ink">{fmt(v, v % 1 ? 2 : 0)}</span>
              </span>
            ))}
            {byKind.length > LEGEND && (
              <button
                onClick={() => (sfx.click(), setAllKinds((a) => !a))}
                aria-expanded={allKinds}
                className="-my-[7px] flex h-[34px] items-center rounded-full px-2.5 text-[11.5px] font-bold text-dim transition hover:bg-raised hover:text-ink"
              >
                {allKinds ? 'Less' : `+ ${byKind.length - LEGEND} more`}
              </button>
            )}
          </div>

          {/* the list fades out at the bottom; the padding lets the last row scroll clear of the fade */}
          <div className="no-scrollbar mt-3 flex max-h-[340px] min-h-0 flex-1 flex-col overflow-y-auto pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)] lg:max-h-none">
            <AnimatePresence initial={false}>
              {log.map((e, i) => {
                const title = historyTitle(e)
                const kind = KINDS[e.kind]
                return (
                  <motion.div
                    key={keys[i]}
                    layout="position"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="flex shrink-0 items-center gap-3 border-b border-white/[.04] py-2 last:border-0"
                  >
                    <KindTile color={kind.color} size={34} className="rounded-[10px]">
                      {kind.icon(17)}
                    </KindTile>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate text-[13.5px] font-bold">{title}</div>
                      <div className="mt-0.5 truncate text-[11.5px] text-dim">
                        {title.toLowerCase().includes(kind.one.toLowerCase()) ? '' : `${kind.one} · `}
                        {timeAgo(e.time, now)}
                      </div>
                    </div>
                    <span className="tnum shrink-0 text-[14px] font-extrabold text-accent">+{fmt(e.amount, e.amount % 1 ? 2 : 0)}</span>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </>
      )}
    </Panel>
  )
}
