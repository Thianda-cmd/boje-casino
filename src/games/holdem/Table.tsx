import { memo } from 'react'
import { motion } from 'framer-motion'
import { useUid } from '../../art/ids'
import { Shoe as HouseShoe } from '../blackjack/table'
import { BLIND_PAYS, TRIPS_PAYS, type HandRank } from './rules'
import type { Box, Geo } from './layout'
import { GOLD } from './Cards'
import { PAY_ROWS, oddsWords } from './words'

/*
  The table itself: deep midnight-blue felt with a fine weave and a soft lamp over the board, printed in gold like a
  casino layout (the dealer's qualifying rule arched over the board, the rail line round the player's circles, and on
  a wide stage the Blind and Trips paytables either side of the circles, the row a hand hits lighting up at the
  showdown), and the shoe peeking in from the top-right corner.
*/

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")"

function FeltView({ G, hit, print: printOn }: { G: Geo; hit: { blind: HandRank | null; trips: HandRank | null }; print: boolean }) {
  const u = useUid()
  const { W, H, print, circles, phone } = G
  // the qualifying line arches gently over the board (a wide circle whose top runs through the print point)
  const r = W * 1.6
  const half = Math.min(W * 0.36, phone ? 170 : 300)
  const sag = r - Math.sqrt(r * r - half * half)
  const arc = print && `M${print.x - half} ${print.y + sag} A${r} ${r} 0 0 1 ${print.x + half} ${print.y + sag}`
  // the rail line round the player's circles, curved like the dealer's arc: its middle just over the circles, its
  // ends rising over the paytables
  const railY = circles.y - circles.d / 2 - (phone ? 8 : 12)
  const railHalf = W / 2 - (phone ? 4 : 10)
  const railR = W * 2.2
  const railSag = railR - Math.sqrt(railR * railR - railHalf * railHalf)
  const rail = `M${W / 2 - railHalf} ${railY - railSag} A${railR} ${railR} 0 0 0 ${W / 2 + railHalf} ${railY - railSag}`
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_65%_at_50%_42%,#2550a8_0%,#173679_40%,#0c1f4f_74%,#071437_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[.16] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_140px_36px_rgba(2,6,22,.55)]" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" width={W} height={H} aria-hidden>
        <path d={rail} fill="none" stroke={GOLD} strokeOpacity=".42" strokeWidth={phone ? 1.2 : 1.6} />
        <path d={rail} fill="none" stroke={GOLD} strokeOpacity=".18" strokeWidth="1" transform={`translate(0 ${phone ? -4 : -6})`} />
        {arc && (
          <>
            <defs>
              <path id={`${u}q`} d={arc} />
            </defs>
            <text
              fontSize={phone ? 8.5 : 11.5}
              fontWeight={900}
              letterSpacing={phone ? 1.6 : 3}
              fill={GOLD}
              fillOpacity={printOn ? 0.62 : 0}
              style={{ transition: 'fill-opacity .35s' }}
              fontFamily="Manrope, system-ui, sans-serif"
            >
              <textPath href={`#${u}q`} startOffset="50%" textAnchor="middle">
                DEALER QUALIFIES WITH A PAIR OR BETTER
              </textPath>
            </text>
          </>
        )}
      </svg>
      {G.pays && (
        <>
          <PayPrint box={G.pays.left} title="Blind pays" pays={BLIND_PAYS} hit={hit.blind} note="Under a straight: returned" />
          <PayPrint box={G.pays.right} title="Trips pays" pays={TRIPS_PAYS} hit={hit.trips} note="Win, lose or fold" />
        </>
      )}
    </>
  )
}

/** a paytable printed on the felt; the row the player's hand hits lights up */
function PayPrint({ box, title, pays, hit, note }: { box: Box; title: string; pays: Readonly<Partial<Record<HandRank, number>>>; hit: HandRank | null; note: string }) {
  const rows = PAY_ROWS.filter((r) => pays[r.rank] !== undefined)
  return (
    <div className="pointer-events-none absolute flex flex-col justify-center" style={{ left: box.x, top: box.y, width: box.w, height: box.h, color: GOLD }}>
      <div className="mb-1 text-center text-[10.5px] font-black uppercase tracking-[.2em] opacity-80">{title}</div>
      {rows.map((r) => {
        const on = hit === r.rank
        return (
          <motion.div
            key={r.rank}
            className="tnum flex items-baseline justify-between gap-1 rounded-[4px] px-1.5 text-[10.5px] font-extrabold leading-[1.38]"
            initial={false}
            animate={{ opacity: on ? 1 : 0.62, backgroundColor: on ? 'rgba(247,197,72,.95)' : 'rgba(247,197,72,0)', color: on ? '#1d1200' : GOLD }}
            transition={{ duration: 0.3 }}
          >
            <span className="whitespace-nowrap">{r.name}</span>
            <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dotted border-current opacity-40" />
            <span className="whitespace-nowrap">{oddsWords(pays[r.rank]!, ':')}</span>
          </motion.div>
        )
      })}
      <div className="mt-0.5 whitespace-nowrap text-center text-[9.5px] font-bold opacity-50">{note}</div>
    </div>
  )
}

export const Felt = memo(FeltView)

/** The shoe in the top-right corner, the size of the cards it deals (smaller on the felt's edge) */
export function Shoe({ G }: { G: Geo }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 h-0"
      style={{ top: G.shoe.h * 0.3 - 6, ['--card-w' as string]: `${G.shoe.w}px`, ['--card-h' as string]: `${G.shoe.h}px` }}
    >
      <HouseShoe />
    </div>
  )
}
