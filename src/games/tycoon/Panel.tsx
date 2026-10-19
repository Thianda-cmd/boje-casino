import { memo, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Badge } from './kit'

/*
  The panel's frame: five tabs (Floor, Managers, Upgrades, Stars, Milestones), each with a count of what is ready
  in it, over one scrolling body that holds the open tab. On a wide screen it sits right of the floor; on a phone
  it is the sheet under it. The tabs stack icon over word, so all five fit from 360 px up.
*/

export type TabId = 'floor' | 'managers' | 'upgrades' | 'stars' | 'milestones'

const TABS: { id: TabId; name: string; icon: ReactNode }[] = [
  { id: 'floor', name: 'Floor', icon: <path d="M12 3.5 21 9l-9 5.5L3 9Zm-9 9 9 5.5 9-5.5" /> },
  {
    id: 'managers',
    name: 'Managers',
    icon: (
      <>
        <circle cx="12" cy="7.5" r="3.8" />
        <path d="M4.5 21c0-4.4 3.4-7.2 7.5-7.2s7.5 2.8 7.5 7.2M12 14v4.5m-1.5-4.5h3" />
      </>
    ),
  },
  { id: 'upgrades', name: 'Upgrades', icon: <path d="m6 11.5 6-6 6 6M6 18.5l6-6 6 6" /> },
  { id: 'stars', name: 'Stars', icon: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /> },
  { id: 'milestones', name: 'Milestones', icon: <path d="M6 21V4m0 .5c3.5-1.8 6 1.8 9.5 0l2.5-.8v8.8l-2.5.8c-3.5 1.8-6-1.8-9.5 0" /> },
]

export type Badges = Partial<Record<TabId, { n: number | string; tone: 'gold' | 'green' | 'sky' | 'violet' }>>

export function Panel({
  tab,
  onTab,
  badges,
  phone,
  children,
}: {
  tab: TabId
  onTab: (t: TabId) => void
  /** what is ready in each tab: a count (gold for coins, green for the rest), or nothing */
  badges: Badges
  phone: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/[.04]">
      <Tabs tab={tab} onTab={onTab} badges={badges} phone={phone} />
      <div className="ty-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">{children}</div>
    </div>
  )
}

/** the five tabs; drawn again only when the tab or a badge changes (the page draws a few times a second) */
const Tabs = memo(
  function Tabs({ tab, onTab, badges, phone }: { tab: TabId; onTab: (t: TabId) => void; badges: Badges; phone: boolean }) {
    return (
      <div role="tablist" aria-label="Casino Tycoon" className="flex shrink-0 gap-0.5 border-b border-line/80 p-1.5">
        {TABS.map((t) => {
          const on = t.id === tab
          const b = badges[t.id]
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => onTab(t.id)}
              className={`relative flex h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl font-extrabold transition-colors ${phone ? 'text-[10.5px]' : 'text-[11.5px]'} ${on ? 'text-ink' : 'text-dim hover:text-muted'}`}
            >
              {on && <motion.span layoutId="ty-tab" layoutDependency={tab} className="absolute inset-0 rounded-xl bg-raised shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="relative shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {t.icon}
                </svg>
                {b && (
                  <motion.span key={String(b.n)} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 16 }} className="absolute -top-2 left-3">
                    <Badge n={b.n} tone={b.tone} />
                  </motion.span>
                )}
              </span>
              <span className="relative truncate">{t.name}</span>
            </button>
          )
        })}
      </div>
    )
  },
  (a, b) => a.tab === b.tab && a.phone === b.phone && a.onTab === b.onTab && JSON.stringify(a.badges) === JSON.stringify(b.badges),
)
