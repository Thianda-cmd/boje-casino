import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CardBack, CardFace } from '../../art/Card'
import { Chip } from '../../art/Chip'
import { fmt } from '../../lib/format'

/* The blackjack table shared by single-player Blackjack and Live Blackjack: card rules, the felt,
   cards, chips and the pills and badges around a hand. Sizes come from --card-w / --card-h. */

/* ------------------------------------------------------------------ */
/*  Cards & rules: 6 decks, S17, BJ 3:2, double any two, one split      */
/* ------------------------------------------------------------------ */

export const SUITS = ['♠', '♥', '♦', '♣'] as const
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export type Card = { rank: (typeof RANKS)[number]; suit: (typeof SUITS)[number]; id: number }
export type Outcome = 'win' | 'lose' | 'push' | 'blackjack' | 'bust'

export const cardValue = (c: Card) => (c.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank))
export function score(cards: Card[]) {
  let total = 0
  let aces = 0
  for (const c of cards) {
    total += cardValue(c)
    if (c.rank === 'A') aces++
  }
  while (total > 21 && aces) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 && total <= 21 }
}
export const isBJ = (cards: Card[]) => cards.length === 2 && score(cards).total === 21

export function fmtScore(cards: Card[]) {
  const s = score(cards)
  if (isBJ(cards)) return 'BJ'
  return s.soft && s.total < 21 ? `${s.total - 10}/${s.total}` : `${s.total}`
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="ml-1 hidden rounded border border-white/15 px-1 text-[10px] font-bold text-white/40 lg:inline">{children}</span>
}

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** Green baize with a soft spotlight, a fine weave and the dealer's arc. */
export function Felt() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_28%,#1f7a5c_0%,#125240_42%,#0a3027_80%,#08251f_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[.18] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path d="M 4 40 Q 50 80 96 40" fill="none" stroke="rgba(247,197,72,.35)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d="M 9 45 Q 50 84 91 45" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1.5" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_30px_rgba(0,0,0,.45)]" />
    </>
  )
}

export function ScorePill({ value, active }: { value: string | null; active?: boolean }) {
  return (
    <div className="flex h-8 items-center">
      <AnimatePresence mode="popLayout">
        {value && (
          <motion.span
            key={value}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            className={`tnum min-w-11 rounded-full px-3 py-1.5 text-center text-[14px] font-extrabold leading-none shadow-[0_4px_12px_-4px_rgba(0,0,0,.6)] ${
              active ? 'bg-accent text-[#032412]' : 'bg-[#071a14]/75 text-white ring-1 ring-white/10'
            }`}
          >
            {value}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ChipStack({ amount, doubled }: { amount: number; doubled: boolean }) {
  const n = doubled ? 2 : 1
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-[#071a14]/75 py-1 pl-1 pr-3 text-[13px] font-bold text-white/90 ring-1 ring-white/10">
      <span className="relative h-6 w-6">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
            <Chip value={amount / n} size={24} />
          </span>
        ))}
      </span>
      <span className="tnum">{fmt(amount)}</span>
    </span>
  )
}

export function OutcomeBadge({ outcome, payout, bet }: { outcome: Outcome; payout: number; bet: number }) {
  const map: Record<Outcome, [string, string]> = {
    win: ['Win', 'bg-accent text-[#032412]'],
    blackjack: ['Blackjack', 'bg-gold text-[#2a1c00]'],
    push: ['Push', 'bg-white text-[#0b1520]'],
    lose: ['Lose', 'bg-danger text-white'],
    bust: ['Bust', 'bg-danger text-white'],
  }
  const [text, cls] = map[outcome]
  return (
    <motion.div
      initial={{ scale: 0.4, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      className={`absolute -bottom-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-extrabold leading-none shadow-[0_6px_16px_-4px_rgba(0,0,0,.6)] ${cls}`}
    >
      {text}
      {payout > bet && <span className="tnum ml-1.5">+{fmt(payout - bet)}</span>}
    </motion.div>
  )
}

/** Outline where the next hand lands, so the empty table isn't blank. */
export function CardSlot() {
  return <div className="h-[var(--card-h)] w-[var(--card-w)] rounded-[10px] border-2 border-dashed border-white/20 bg-white/[.03]" />
}

/** The shoe, peeking in from the corner the cards are dealt from. */
export function Shoe() {
  return (
    <div className="pointer-events-none absolute -right-[calc(var(--card-w)*0.35)] -top-[calc(var(--card-h)*0.3)] rotate-[-18deg]">
      {[3, 2, 1, 0].map((i) => (
        <CardBack
          key={i}
          className="absolute right-0 top-0 h-[var(--card-h)] w-[var(--card-w)]"
          style={{ transform: `translate(${-i * 2}px, ${i * 2}px)`, filter: i === 3 ? 'drop-shadow(0 8px 16px rgba(0,0,0,.45))' : undefined }}
        />
      ))}
      <div className="h-[var(--card-h)] w-[var(--card-w)]" />
    </div>
  )
}

/**
 * A card in a hand, dealt from the shoe. Live Blackjack aims each flight with `from` (the shoe's offset
 * from the card's place, or null for a card already on the table), staggers several with `delay`,
 * tightens the fan with `overlap` and lets a card move between split hands through `layoutId`.
 */
export function PlayingCard({
  card,
  index,
  hidden,
  fromBottom,
  from,
  delay = 0,
  overlap = 0.5,
  layoutId,
}: {
  card: Card
  index: number
  hidden?: boolean
  fromBottom?: boolean
  from?: { x: number; y: number } | null
  delay?: number
  overlap?: number
  layoutId?: string
}) {
  const start = from === undefined ? { x: 420, y: fromBottom ? -360 : -80 } : from
  return (
    <motion.div
      layout
      layoutId={layoutId}
      initial={start ? { ...start, rotate: -16, opacity: 0 } : false}
      animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
      exit={from ? { x: from.x * 0.4, y: from.y * 0.4, opacity: 0, transition: { duration: 0.3 } } : { y: -40, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 240, damping: 26, delay }}
      className="relative h-[var(--card-h)] w-[var(--card-w)] [perspective:900px]"
      style={{ marginLeft: index ? `calc(var(--card-w) * -${overlap})` : 0, zIndex: index, filter: 'drop-shadow(0 8px 14px rgba(0,0,0,.4))' }}
    >
      <motion.div
        className="absolute inset-0 [transform-style:preserve-3d]"
        initial={false}
        animate={{ rotateY: hidden ? 180 : 0 }}
        transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
      >
        <CardFace rank={card.rank} suit={card.suit} className="absolute inset-0 h-full w-full [backface-visibility:hidden]" />
        <CardBack className="absolute inset-0 h-full w-full [backface-visibility:hidden] [transform:rotateY(180deg)]" />
      </motion.div>
    </motion.div>
  )
}
