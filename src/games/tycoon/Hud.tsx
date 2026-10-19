import { memo, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CITIES, STAR_BONUS, fmtCash } from './engine'
import { CashIcon, StarIcon } from './art'
import { Rolling } from './kit'

/*
  What sits over the floor: the Cash counter with what the casino makes a second, the Stars and the city, the
  whale's boost running down and the whale waiting for his tip, the banners that celebrate a moment (an opening, a
  count step, a manager, a milestone, the whale), and the Cash numbers that pop over an attraction as it pays.

  The pops come several a second from a busy floor, so they live in a little store of their own (popCash): a pop
  draws the pops layer and nothing else of the page.
*/

const rate = (n: number) => `+${fmtCash(n)}/s`

/** the Cash counter: big, rolling, with the income under it (or what to do first) */
export const CashCard = memo(function CashCard({ cash, income, boost, open, compact }: { cash: number; income: number; boost: number; /** any attraction open yet */ open: boolean; compact: boolean }) {
  // (a phone's card shares its row with the vault: it keeps to the number, and the panel under it says what to do)
  const idle = compact ? '+0/s' : open ? 'Hire a manager to earn on your own' : 'Open a Claw Machine to start'
  return (
    <div className={`pointer-events-auto min-w-0 rounded-2xl bg-[#0b1621]/80 shadow-[0_10px_30px_-12px_rgba(0,0,0,.8)] ring-1 ring-white/10 backdrop-blur-sm ${compact ? 'px-2.5 py-1.5' : 'px-3.5 py-2.5'}`}>
      <div className="flex items-center gap-2">
        <CashIcon size={compact ? 22 : 30} />
        <Rolling value={cash} className={`font-black leading-none tracking-tight text-white ${compact ? 'text-[21px]' : 'text-[30px]'}`} />
      </div>
      <div className={`mt-1 flex items-center gap-1.5 whitespace-nowrap font-extrabold ${compact ? 'text-[11.5px]' : 'text-[13px]'}`}>
        <span className={`tnum ${income > 0 ? 'text-[#5fe39a]' : 'text-white/45'}`}>{income > 0 ? rate(income) : idle}</span>
        {boost > 1 && <span className="rounded-full bg-gold px-1.5 py-px text-[10.5px] font-black text-[#2a1c00]">×{boost}</span>}
      </div>
    </div>
  )
})

/** Stars held (each +2% pay) and the city the casino stands in */
export const RepChip = memo(function RepChip({ stars, city, onClick, compact }: { stars: number; city: number; onClick: () => void; compact: boolean }) {
  return (
    <button
      onClick={onClick}
      title={`${stars} Stars: all pay +${Math.round(stars * STAR_BONUS * 100)}%`}
      className={`pointer-events-auto flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#0b1621]/80 font-extrabold text-white shadow-[0_8px_22px_-12px_rgba(0,0,0,.8)] ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-[#0b1621]/90 ${compact ? 'px-2.5 text-[12px]' : 'px-3 text-[13px]'}`}
    >
      <StarIcon size={compact ? 15 : 17} />
      <span className="tnum">{stars.toLocaleString('en-US')}</span>
      <span className="text-white/35">·</span>
      <span className="text-white/80">{CITIES[city].name}</span>
    </button>
  )
})

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** the whale's boost, running down */
export function BoostChip({ left, mult, compact }: { left: number; mult: number; compact: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      className={`pointer-events-auto relative flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] font-black text-[#3a2400] shadow-[0_8px_22px_-8px_rgba(247,197,72,.8),inset_0_-2px_0_rgba(0,0,0,.15)] ${compact ? 'h-8 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[14px]'}`}
    >
      <span className="ty-motion pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/40" style={{ animation: 'ty-shine 2.2s ease-in-out infinite' }} />
      <span className="relative">×{mult} Cash</span>
      <span className="tnum relative opacity-75">{clock(left)}</span>
    </motion.div>
  )
}

/** the whale is on the floor waiting for a tip, and for how long more: a press takes the camera to him */
export function WhaleChip({ left, compact, onClick }: { left: number; compact: boolean; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: [1, 1.06, 1] }}
      // (its own transition: the pulse repeats for ever, and an exit that took it over would never end and keep the
      // chip's room in the row)
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
      transition={{ scale: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.2 } }}
      title="Show me the whale"
      className={`pointer-events-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#2a2233] font-black text-gold shadow-[0_8px_22px_-8px_rgba(0,0,0,.8)] ring-2 ring-gold/80 ${compact ? 'h-8 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[13px]'}`}
    >
      <svg width={compact ? 15 : 18} height={compact ? 15 : 18} viewBox="0 0 32 32" aria-hidden>
        <path d="M9.5 22.6V7.5h13v15.1Z M4 23.5c6-2.4 18-2.4 24 0" fill="#ffd23f" stroke="#ffd23f" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      {compact ? 'Tip the whale ×5' : 'A whale is here: tip him for ×5'}
      {left > 0 && <span className="tnum text-white/70">{Math.ceil(left / 1000)}s</span>}
    </motion.button>
  )
}

export type BannerTone = 'gold' | 'green' | 'sky' | 'violet' | 'pink'
export interface BannerData {
  key: number
  tone: BannerTone
  icon: ReactNode
  title: string
  sub?: string
}
const BANNER_TONE: Record<BannerTone, string> = {
  gold: 'from-[#ffe08a] to-[#f2a93b] text-[#3a2400]',
  green: 'from-[#5fe39a] to-[#1fbf63] text-[#032412]',
  sky: 'from-[#8fd2ff] to-[#3aa6f5] text-[#03233a]',
  violet: 'from-[#c4b0ff] to-[#8a66ff] text-[#170a3a]',
  pink: 'from-[#ffb0d3] to-[#f0509a] text-[#3a0620]',
}

/** a moment's banner: a ribbon dropping in under the HUD (`top`), or rising over the bottom row (`bottom`), in px */
export const Banner = memo(function Banner({ banner, top, bottom }: { banner: BannerData | null; top?: number; bottom?: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3" style={{ top, bottom }} aria-live="polite">
      {/* (one after the other: a banner popped out of the flow to make way would lose its place over the floor) */}
      <AnimatePresence mode="wait">
        {banner && (
          <motion.div
            key={banner.key}
            initial={{ opacity: 0, y: -18, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            className={`flex max-w-[min(440px,100%)] items-center gap-2.5 rounded-2xl bg-gradient-to-b py-2 pl-2 pr-4 shadow-[0_14px_34px_-12px_rgba(0,0,0,.75),inset_0_-3px_0_rgba(0,0,0,.14),inset_0_1px_0_rgba(255,255,255,.45)] ${BANNER_TONE[banner.tone]}`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/45">{banner.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-black leading-tight">{banner.title}</span>
              {banner.sub && <span className="block truncate text-[12px] font-bold leading-tight opacity-75">{banner.sub}</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

/* ---------------- the Cash pops ---------------- */

interface Pop {
  key: number
  x: number
  y: number
  text: string
  gold: boolean
}
let pops: Pop[] = []
let popKey = 0
const popSubs = new Set<() => void>()
const putPops = (next: Pop[]) => {
  pops = next
  popSubs.forEach((f) => f())
}

/** the Cash an attraction just paid, rising from (x, y) in the floor's px */
export function popCash(x: number, y: number, text: string, gold: boolean) {
  const p = { key: ++popKey, x, y, text, gold }
  putPops([...pops.slice(-7), p])
  setTimeout(() => putPops(pops.filter((q) => q !== p)), 1300)
}

/** the layer the pops rise in, over the floor */
export function Pops() {
  const list = useSyncExternalStore(
    (f) => {
      popSubs.add(f)
      return () => popSubs.delete(f)
    },
    () => pops,
  )
  // (a page opened again starts with none of the last one's)
  useEffect(
    () => () => {
      pops = []
    },
    [],
  )
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {list.map((p) => (
        <PopItem key={p.key} p={p} />
      ))}
    </div>
  )
}

/** one pop: it rises and fades out by itself, before the store lets it go (so it needs no exit animation, and the
 *  ones already rising aren't drawn again as another comes) */
const PopItem = memo(function PopItem({ p }: { p: Pop }) {
  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={{ x: p.x, y: p.y, opacity: 0, scale: 0.6 }}
      animate={{ x: p.x, y: p.y - 46, opacity: [0, 1, 1, 0], scale: [0.6, 1.08, 1, 0.95] }}
      transition={{ duration: 1.25, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
    >
      <span
        className={`tnum inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-black shadow-[0_6px_14px_-6px_rgba(0,0,0,.7)] ${p.gold ? 'bg-gold text-[#3a2400]' : 'bg-[#0b1621]/85 text-[#5fe39a] ring-1 ring-[#5fe39a]/30'}`}
      >
        <CashIcon size={13} />+{p.text}
      </span>
    </motion.div>
  )
})
