import { motion, useTransform, type MotionValue } from 'framer-motion'
import { CardBack, CardFace } from '../../art/Card'
import type { Card } from './rules'

/*
  A baccarat card on the felt. It glides out of the shoe to its place (third cards lie sideways), and is either face
  up, face down, or being squeezed: the back peels away from the bottom-left corner, a rolled lip of card stock
  travelling across it, until the face is uncovered.

  The peel only moves transforms. The back sits in a rotated window whose edge is the fold line: the window slides
  along the peel direction while the back inside slides the opposite way, so the back stays put on screen and only
  the window's edge moves across it. The rolled lip and its shadows are one gradient strip riding the same edge.
*/

export type CardMode = 'down' | 'up' | 'squeeze'

/**
 * The peel runs from the bottom-left corner towards the top-right, at this angle above the horizontal. Shallow
 * enough that the first thing to show is the corner pip (or the edge of a court card's frame), never an index:
 * the squeeze's pause at about 36% (Baccarat.tsx) stops just before the bottom index comes into view.
 */
const ALPHA = 35
const PHI = 270 - ALPHA
const COS = Math.cos((ALPHA * Math.PI) / 180)
const SIN = Math.sin((ALPHA * Math.PI) / 180)

export const EASE_GLIDE = [0.16, 1, 0.3, 1] as const

export function TableCard({
  card,
  left,
  top,
  w,
  sideways,
  z,
  from,
  flight,
  mode,
  flipInFlight,
  peel,
  lifted,
  dim,
}: {
  card: Card
  left: number
  top: number
  w: number
  sideways: boolean
  z: number
  /** where the card starts, as an offset from its place */
  from: { x: number; y: number; rotate: number }
  flight: number
  mode: CardMode
  /** dealt face up: it turns over on its way */
  flipInFlight: boolean
  peel: MotionValue<number>
  lifted: boolean
  dim: boolean
}) {
  const h = Math.round(w * 1.4)
  const radius = w * 0.09
  const turn = sideways ? 90 : 0
  // Every move is a whole `transform` (not x / y / rotate), which framer hands to the browser as a Web Animation: the
  // flights, lifts and flips then run on the compositor and keep gliding while React renders the next card.
  return (
    <motion.div
      className="pointer-events-none absolute will-change-transform"
      style={{ left, top, width: w, height: h, zIndex: z }}
      initial={{ transform: `translate(${from.x.toFixed(1)}px, ${from.y.toFixed(1)}px) rotate(${from.rotate}deg)`, opacity: 0 }}
      animate={{ transform: `translate(0px, 0px) rotate(${turn}deg)`, opacity: 1 }}
      exit={{ transform: `translate(-26px, -20px) rotate(${turn}deg)`, opacity: 0, transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: flight, ease: EASE_GLIDE, opacity: { duration: 0.14 } }}
    >
      <motion.div
        className="absolute inset-0 [perspective:1100px]"
        // a card's face stays out of the accessibility tree until it is turned over
        aria-hidden={mode !== 'up'}
        initial={false}
        animate={{ transform: lifted ? 'translateY(-4px) scale(1.07)' : 'translateY(0px) scale(1)' }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <div
          className="absolute inset-0 transition-shadow duration-300"
          style={{
            borderRadius: radius,
            boxShadow: lifted ? '0 22px 30px -10px rgba(0,0,0,.6), 0 0 0 1px rgba(247,197,72,.35)' : '0 10px 18px -8px rgba(0,0,0,.6)',
          }}
        />
        {mode === 'squeeze' ? (
          <Peel card={card} w={w} h={h} radius={radius} peel={peel} />
        ) : (
          <motion.div
            className="absolute inset-0 [transform-style:preserve-3d]"
            initial={{ transform: `rotateY(${flipInFlight || mode === 'down' ? 180 : 0}deg)` }}
            animate={{ transform: `rotateY(${mode === 'up' ? 0 : 180}deg)` }}
            transition={{ duration: flipInFlight ? flight * 0.9 : 0.4, ease: [0.45, 0, 0.2, 1], delay: flipInFlight ? flight * 0.08 : 0 }}
          >
            <CardFace rank={card.rank} suit={card.suit} className="absolute inset-0 h-full w-full [backface-visibility:hidden]" />
            <CardBack className="absolute inset-0 h-full w-full [backface-visibility:hidden] [transform:rotateY(180deg)]" />
          </motion.div>
        )}
        {/* the losing hand settles into the felt's shade */}
        <motion.div
          className="absolute inset-0 bg-[#03130e]"
          style={{ borderRadius: radius }}
          initial={false}
          animate={{ opacity: dim ? 0.36 : 0 }}
          transition={{ duration: 0.5 }}
        />
      </motion.div>
    </motion.div>
  )
}

function Peel({ card, w, h, radius, peel }: { card: Card; w: number; h: number; radius: number; peel: MotionValue<number> }) {
  // distance from the bottom-left corner to the far corner, measured along the peel direction
  const span = w * COS + h * SIN
  const behind = w * 0.06
  const roll = w * 0.12
  const ahead = w * 0.08
  const start = -(roll + ahead)
  const end = span + behind + 2
  const D = 2 * (w + h)
  const s = useTransform(peel, (p) => start + (end - start) * p)
  const windowT = useTransform(s, (v) => `rotate(${PHI}deg) translateY(${v}px)`)
  const backT = useTransform(s, (v) => `translateY(${-v}px) rotate(${-PHI}deg)`)
  const lipT = useTransform(s, (v) => `rotate(${PHI}deg) translateY(${v - behind}px)`)
  const strip = behind + roll + ahead
  const at = (px: number) => `${px.toFixed(1)}px`
  const lip = `linear-gradient(to bottom, rgba(4,20,14,0) 0, rgba(4,20,14,.28) ${at(behind)}, #8995a3 ${at(behind)}, #e9edf2 ${at(behind + roll * 0.28)}, #ffffff ${at(
    behind + roll * 0.5,
  )}, #dfe4ea ${at(behind + roll * 0.78)}, #97a2ae ${at(behind + roll)}, rgba(0,0,0,.42) ${at(behind + roll)}, rgba(0,0,0,0) ${at(strip)})`
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
      <CardFace rank={card.rank} suit={card.suit} className="absolute inset-0 h-full w-full" />
      <motion.div className="absolute overflow-hidden will-change-transform" style={{ left: -D / 2, top: h, width: D, height: D, transformOrigin: `${D / 2}px 0px`, transform: windowT }}>
        <motion.div className="absolute will-change-transform" style={{ left: D / 2, top: -h, width: w, height: h, transformOrigin: `0px ${h}px`, transform: backT }}>
          <CardBack className="h-full w-full" />
        </motion.div>
      </motion.div>
      <motion.div className="absolute will-change-transform" style={{ left: -D / 2, top: h, width: D, height: strip, transformOrigin: `${D / 2}px 0px`, transform: lipT, background: lip }} />
    </div>
  )
}

/** A dashed outline where a card will land, so the empty table isn't blank. */
export function Slot({ left, top, w }: { left: number; top: number; w: number }) {
  return (
    <div
      className="pointer-events-none absolute border-2 border-dashed border-white/[.16] bg-white/[.025]"
      style={{ left, top, width: w, height: Math.round(w * 1.4), borderRadius: w * 0.09 }}
    />
  )
}
