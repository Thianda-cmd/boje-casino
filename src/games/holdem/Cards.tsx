import { memo, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CardBack, CardFace } from '../../art/Card'
import { rankLabel, suitSymbol, type Card } from './rules'
import type { Box, Offset } from './layout'
import type { HandWords } from './words'

/*
  The cards on the felt and the tags that name the hands; before a deal, the dashed places the cards will land in,
  each group named on the felt (Dealer, Board, Your hand).

  A card glides out of the shoe to its place (or simply is there, on a resumed hand), lies face down or face up, and
  turns over with a small lift as it does. At the showdown the cards say whose hand they make: a gold tab under each
  card in the player's best five, a blue tab over each card in the dealer's (a board card can carry both), and the
  winner's five rise a little and glow while the cards in neither hand settle into the felt's shade.

  Every move is a whole `transform` string, which framer hands to the browser as a Web Animation: the flights and
  flips run on the compositor and keep gliding while React renders the next card.
*/

export const EASE_GLIDE = [0.16, 1, 0.3, 1] as const
export const GOLD = '#f7c548'
export const DEALER_TONE = '#8fbaff'

export const HoldemCard = memo(function HoldemCard({
  card,
  box,
  from,
  flight,
  up,
  flipTime,
  markP,
  markD,
  lift,
  liftTone,
  dim,
  out,
  z,
}: {
  card: Card
  box: Box
  /** where it starts, as an offset from its place (null: already on the table) */
  from: Offset | null
  /** seconds from the shoe to its place */
  flight: number
  up: boolean
  /** seconds a turn takes */
  flipTime: number
  /** in the player's best five (a gold tab under it), in the dealer's (a blue tab over it) */
  markP: boolean
  markD: boolean
  /** the winner's best five: raised and glowing in the winner's colour */
  lift: boolean
  liftTone: string
  dim: boolean
  /** where it goes when the table is cleared: an offset from its place */
  out: Offset
  z: number
}) {
  const { w, h } = box
  const radius = w * 0.09
  const rise = Math.round(w * 0.08)
  const tabW = w * 0.46
  const tabH = Math.max(4, Math.round(w * 0.055))
  return (
    <motion.div
      className="pointer-events-none absolute will-change-transform"
      style={{ left: box.x, top: box.y, width: w, height: h, zIndex: z }}
      initial={from ? { transform: `translate(${from.x}px, ${from.y}px) rotate(${from.rotate}deg)`, opacity: 0 } : false}
      animate={{ transform: `translate(0px, ${lift ? -rise : 0}px) rotate(0deg)`, opacity: 1 }}
      exit={{ transform: `translate(${out.x}px, ${out.y}px) rotate(${out.rotate}deg)`, opacity: 0, transition: { duration: 0.34, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: from ? flight : 0.4, ease: EASE_GLIDE, opacity: { duration: 0.12 } }}
    >
      {/* the dealer's tab, over the card */}
      <AnimatePresence>
        {markD && (
          <motion.span
            key="d"
            className="absolute left-1/2 rounded-full"
            style={{ width: tabW, height: tabH, marginLeft: -tabW / 2, top: -tabH - Math.max(3, w * 0.04), background: DEALER_TONE, boxShadow: `0 0 10px ${DEALER_TONE}` }}
            initial={{ opacity: 0, scaleX: 0.2 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_GLIDE }}
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 [perspective:1000px]" aria-hidden={!up}>
        {/* the shadow under the card (and the glow of a winning card) */}
        <div
          className="absolute inset-0 transition-shadow duration-500"
          style={{
            borderRadius: radius,
            boxShadow: lift ? `0 18px 26px -10px rgba(0,0,0,.7), 0 0 0 2px ${liftTone}, 0 0 22px 2px ${liftTone}88` : '0 10px 18px -8px rgba(0,0,0,.65)',
          }}
        />
        <motion.div
          className="absolute inset-0 [transform-style:preserve-3d]"
          initial={from ? { transform: 'rotateY(180deg) scale(1)' } : false}
          animate={{ transform: up ? ['rotateY(180deg) scale(1)', 'rotateY(90deg) scale(1.07)', 'rotateY(0deg) scale(1)'] : 'rotateY(180deg) scale(1)' }}
          transition={{ duration: flipTime, ease: [0.45, 0, 0.2, 1], times: [0, 0.5, 1] }}
        >
          <CardFace rank={rankLabel(card)} suit={suitSymbol(card)} className="absolute inset-0 h-full w-full [backface-visibility:hidden]" />
          <CardBack className="absolute inset-0 h-full w-full [backface-visibility:hidden] [transform:rotateY(180deg)]" />
        </motion.div>
        {/* the cards in neither hand settle into the felt's shade */}
        <motion.div className="absolute inset-0 bg-[#050b1f]" style={{ borderRadius: radius }} initial={false} animate={{ opacity: dim ? 0.5 : 0 }} transition={{ duration: 0.45 }} />
      </div>
      {/* the player's tab, under the card */}
      <AnimatePresence>
        {markP && (
          <motion.span
            key="p"
            className="absolute left-1/2 rounded-full"
            style={{ width: tabW, height: tabH, marginLeft: -tabW / 2, bottom: -tabH - Math.max(3, w * 0.04), background: GOLD, boxShadow: `0 0 10px ${GOLD}` }}
            initial={{ opacity: 0, scaleX: 0.2 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_GLIDE }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
})

/** A dashed outline where a card will land, so the empty table isn't blank. */
export function Slot({ box }: { box: Box }) {
  return (
    <div
      className="pointer-events-none absolute border-2 border-dashed border-[#9fb8ff]/[.16] bg-white/[.02]"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: box.w * 0.09 }}
    />
  )
}

/** The empty table's print over a group of slots ("Dealer", "Board", "Your hand"), as a layout names its places */
export function SlotLabel({ boxes, text, small }: { boxes: Box[]; text: string; small: boolean }) {
  const left = Math.min(...boxes.map((b) => b.x))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const b = boxes[0]
  return (
    <span
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#050c26]/60 px-3 py-1 font-black uppercase ring-1 ring-[#f7c548]/15"
      style={{ left: (left + right) / 2, top: b.y + b.h / 2, color: GOLD, opacity: 0.8, fontSize: small ? 9.5 : 11, letterSpacing: small ? '.2em' : '.26em' }}
    >
      {text}
    </span>
  )
}

/**
 * A hand's name by its cards: who it is, the hand ("Two pair" / "kings and sevens"), and a status (the dealer's
 * qualifying). 'side' hangs beside the cards in two lines, its edge at x (`align` says which edge); 'line' runs in
 * one row centred on x, for a phone, where `lead` (the verdict) can take the place of the name of who it is.
 */
export function HandTag({
  who,
  words,
  tone,
  status,
  variant,
  align,
  x,
  y,
  w,
  glow,
  lead,
}: {
  who: string
  words: HandWords | null
  tone: string
  status?: { text: string; good: boolean } | null
  variant: 'side' | 'line'
  align: 'left' | 'right'
  x: number
  y: number
  w: number
  /** the hand has just been decided: the tag lights up in its side's colour */
  glow: boolean
  lead?: ReactNode
}) {
  const line = variant === 'line'
  const chip = status && (
    <span
      className={`whitespace-nowrap rounded-full font-extrabold ${line ? 'px-1.5 py-[2px] text-[10px]' : 'mt-1 px-2 py-0.5 text-[11px]'}`}
      style={status.good ? { background: 'rgba(34,211,111,.16)', color: '#7dffb3' } : { background: 'rgba(247,197,72,.16)', color: '#ffd77a' }}
    >
      {status.text}
    </span>
  )
  const label = (
    <span className={`flex shrink-0 items-center gap-1.5 font-black uppercase ${line ? 'text-[9px] tracking-[.14em]' : 'text-[10px] tracking-[.18em]'}`} style={{ color: tone }}>
      <span className="inline-block rounded-full" style={{ width: line ? 8 : 12, height: line ? 2.5 : 3, background: tone }} />
      {who}
    </span>
  )
  return (
    <div
      className={`pointer-events-none absolute z-30 flex -translate-y-1/2 ${line ? '-translate-x-1/2 justify-center' : align === 'right' ? '-translate-x-full justify-end' : 'justify-start'}`}
      style={{ left: x, top: y, width: w }}
    >
      <AnimatePresence mode="popLayout">
        {words && (
          <motion.div
            key={`${words.full}${lead ? '+' : ''}`}
            className={`flex min-w-0 ring-1 backdrop-blur-[2px] ${
              line ? 'max-w-full items-center gap-2 whitespace-nowrap rounded-full py-1 pl-2.5 pr-1.5' : `flex-col rounded-xl px-3 py-2 ${align === 'right' ? 'items-end text-right' : 'items-start text-left'}`
            }`}
            style={{ background: 'rgba(4,10,28,.74)', boxShadow: glow ? `0 0 0 1.5px ${tone}, 0 10px 26px -10px ${tone}` : '0 8px 20px -10px rgba(0,0,0,.7)', ['--tw-ring-color' as string]: 'rgba(255,255,255,.1)' }}
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 30 }}
          >
            {line ? (
              <>
                {lead ?? label}
                <span className="min-w-0 truncate text-[12.5px] font-extrabold text-white">{words.full}</span>
                {chip ?? <span className="w-1" />}
              </>
            ) : (
              <>
                {label}
                <span className="mt-0.5 max-w-full truncate text-[16px] font-extrabold leading-tight text-white">{words.title}</span>
                {words.detail && <span className="max-w-full truncate text-[13px] font-bold leading-tight text-white/60">{words.detail}</span>}
                {chip}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
