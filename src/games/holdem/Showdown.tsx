import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt, round2 } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { BLIND_PAYS, TRIPS_PAYS, type HandRank, type Showdown } from './rules'
import { handWords, isBigHand, oddsWords, shortName } from './words'

/*
  How a hand ended, on the felt: the verdict beside the player's cards (who won, what the hand came to over its stake,
  and the rules that decided anything unusual, like the dealer not qualifying, one to a line), and the moment a big
  hand gets. A flush or better that wins the hand has its name lettered over the board with what the Blind and Trips
  pay for it, and a royal flush the full celebration, rays turning behind it and the win counted up. A big hand that
  lost, pushed or was folded is never celebrated: if Trips paid on it, a smaller moment says just that.
*/

export type Verdict = 'win' | 'lose' | 'push' | 'fold'

export const verdictOf = (sd: Showdown): Verdict => (sd.folded ? 'fold' : sd.winner === 'player' ? 'win' : sd.winner === 'dealer' ? 'lose' : 'push')

const TITLE: Record<Verdict, string> = { win: 'You win', lose: 'Dealer wins', push: 'Push', fold: 'Folded' }

/** the lines under the verdict: what made this hand's payout what it was */
export function verdictNote(sd: Showdown): string[] {
  const v = verdictOf(sd)
  const trips = sd.results.find((r) => r.key === 'trips')
  const tripsText = trips?.outcome === 'win' ? `Trips pays ${oddsWords(TRIPS_PAYS[sd.player.rank]!)}` : null
  const noQualify = sd.qualifies ? null : "Dealer didn't qualify: Ante returned"
  const lines = (...xs: (string | null)[]) => xs.filter((x): x is string => !!x)
  if (v === 'fold') return lines('Ante and Blind lost', tripsText)
  if (v === 'push') return lines(trips ? 'Ante, Blind and Play returned' : 'Every bet returned', tripsText)
  if (v === 'win') {
    const blind = BLIND_PAYS[sd.player.rank]
    return lines(noQualify, blind !== undefined ? `Blind pays ${oddsWords(blind)}` : null, tripsText)
  }
  return lines(noQualify, tripsText)
}

const TONE: Record<Verdict, { bg: string; ink: string }> = {
  win: { bg: 'linear-gradient(180deg,#3fe68c,#16b35d)', ink: '#032412' },
  lose: { bg: 'linear-gradient(180deg,#36456a,#222d4a)', ink: '#e7edff' },
  push: { bg: 'linear-gradient(180deg,#ffffff,#d9e2f2)', ink: '#0b1730' },
  fold: { bg: 'linear-gradient(180deg,#4a2a3a,#331a28)', ink: '#ffc2ca' },
}

const signed = (net: number, digits?: number) => `${net > 0 ? '+' : net < 0 ? '−' : ''}${fmt(Math.abs(net), digits)}`

/** The verdict plaque; its right edge sits at x (beside the player's cards) */
export function VerdictPlaque({ sd, x, y, w }: { sd: Showdown; x: number; y: number; w: number }) {
  const v = verdictOf(sd)
  const net = round2(sd.ret - sd.stake)
  const note = verdictNote(sd)
  const t = TONE[v]
  return (
    <div className="pointer-events-none absolute z-30 flex -translate-x-full -translate-y-1/2 justify-end" style={{ left: x, top: y, width: w }}>
      <motion.div
        className="flex flex-col items-end gap-1.5 text-right"
        initial={{ opacity: 0, x: 14, scale: 0.92 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      >
        <span
          className="whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] font-black uppercase tracking-[.16em]"
          style={{ background: t.bg, color: t.ink, boxShadow: '0 10px 26px -10px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.3)' }}
        >
          {TITLE[v]}
        </span>
        <motion.span
          className={`tnum flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[22px] font-black ${
            net > 0 ? 'bg-[#071a33]/85 text-accent ring-2 ring-accent' : 'bg-[#071a33]/70 text-white/75 ring-1 ring-white/10'
          }`}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, type: 'spring', stiffness: 380, damping: 24 }}
        >
          {signed(net)} <Coin size={18} />
        </motion.span>
        {note.length > 0 && (
          <span className="flex flex-col items-end text-[11.5px] font-bold leading-snug text-white/65">
            {note.map((n) => (
              <span key={n} className="whitespace-nowrap">
                {n}
              </span>
            ))}
          </span>
        )}
      </motion.div>
    </div>
  )
}

/** The verdict in one row, for a phone's player line: "YOU WIN +95.00" */
export function VerdictInline({ sd }: { sd: Showdown }) {
  const v = verdictOf(sd)
  const net = round2(sd.ret - sd.stake)
  const t = TONE[v]
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="whitespace-nowrap rounded-full px-2 py-[3px] text-[10px] font-black uppercase tracking-[.1em]" style={{ background: t.bg, color: t.ink }}>
        {TITLE[v]}
      </span>
      <span className={`tnum flex items-center gap-1 whitespace-nowrap text-[13px] font-black ${net > 0 ? 'text-accent' : 'text-white/70'}`}>
        {signed(net, Math.abs(net) >= 1000 ? 0 : 2)} <Coin size={12} />
      </span>
    </span>
  )
}

/** The verdict's note on a phone, where the plaque has no room: one quiet line (two at most) above the bar */
export function VerdictNoteLine({ sd }: { sd: Showdown | null }) {
  const note = sd ? verdictNote(sd).join(' · ') : ''
  return (
    <AnimatePresence initial={false}>
      {note && (
        <motion.div
          key={note}
          className="rounded-lg bg-[#040a1c]/70 px-2.5 py-1 text-center text-[11px] font-bold leading-snug text-white/70 ring-1 ring-white/[.08]"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ delay: 0.3, duration: 0.25 }}
        >
          {note}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ---------------- the big-hand moment ---------------- */

export interface BigHandData {
  id: number
  rank: HandRank
  /** 'hand': the hand was won with it (its name lettered, the fanfare); 'trips': the hand was lost, pushed or folded
   *  and only the Trips bet paid on it (a smaller moment, no fanfare) */
  kind: 'hand' | 'trips'
  /** the hand in words: "Flush, ace high" */
  words: string
  /** the odds the Blind and Trips paid on it (0: that bet didn't win) */
  blind: number
  trips: number
  /** what the Trips bet won over its stake */
  tripsWin: number
  /** what the whole hand won over its stake (a royal counts it up) */
  net: number
}

/** The moment a finished hand gets, or null. Only a win is celebrated: see the note at the top. */
export function bigMomentOf(sd: Showdown, id: number): BigHandData | null {
  if (!isBigHand(sd.player.rank)) return null
  const won = (k: string) => sd.results.find((r) => r.key === k && r.outcome === 'win')
  const mainWon = !sd.folded && sd.winner === 'player'
  const trips = won('trips')
  if (!mainWon && !trips) return null
  return {
    id,
    rank: sd.player.rank,
    kind: mainWon ? 'hand' : 'trips',
    words: handWords(sd.player).full,
    blind: won('blind') ? (BLIND_PAYS[sd.player.rank] ?? 0) : 0,
    trips: trips ? (TRIPS_PAYS[sd.player.rank] ?? 0) : 0,
    tripsWin: trips ? round2(trips.ret - trips.stake) : 0,
    net: round2(sd.ret - sd.stake),
  }
}

const LETTERS: Partial<Record<HandRank, string>> = {
  royal: 'ROYAL FLUSH!',
  straightFlush: 'STRAIGHT FLUSH!',
  quads: 'FOUR OF A KIND!',
  fullHouse: 'FULL HOUSE!',
  flush: 'FLUSH!',
}

/** the lettering of a big moment: a gold (or, for a royal, a jewelled) face over a dark ink outline */
function Lettering({ text, royal, size }: { text: string; royal: boolean; size: number }) {
  const face = royal
    ? 'bg-[linear-gradient(100deg,#fff6cf_0%,#ffd45c_22%,#9fd0ff_48%,#ffffff_60%,#ffd45c_80%,#f39b12_100%)]'
    : 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]'
  return (
    <span className="relative inline-block whitespace-nowrap font-black italic leading-none tracking-tight" style={{ fontSize: size }}>
      <span aria-hidden className="absolute inset-0 pl-[0.06em] pr-[0.16em] text-[#06102b] [-webkit-text-stroke:0.16em_#06102b] [filter:drop-shadow(0_0.07em_0_#06102b)]">
        {text}
      </span>
      <span className={`relative block bg-clip-text pl-[0.06em] pr-[0.16em] text-transparent ${face}`}>{text}</span>
    </span>
  )
}

/** a number counted up to `to` over `ms` */
function useCount(to: number, ms: number) {
  const [v, setV] = useState(ms > 0 ? 0 : to)
  useEffect(() => {
    if (ms <= 0) return setV(to)
    const c = animate(0, to, { duration: ms / 1000, ease: [0.2, 0.7, 0.3, 1], onUpdate: setV })
    return () => c.stop()
  }, [to, ms])
  return v
}

/** A big hand's moment over the board (see BigHandData's kinds); a royal gets rays and the win counted up. A tap closes it. */
export function BigHand({ data, x, y, narrow, onDone }: { data: BigHandData; x: number; y: number; narrow: boolean; onDone: () => void }) {
  const full = data.kind === 'hand'
  const royal = full && data.rank === 'royal'
  const counted = useCount(Math.max(0, data.net), royal ? 2400 : 0)
  useEffect(() => {
    if (!royal) return
    // the count ticks as it climbs
    let last = 0
    const t = window.setInterval(() => {
      const now = performance.now()
      if (now - last > 90) {
        last = now
        sfx.holdem.count()
      }
    }, 95)
    const stop = window.setTimeout(() => clearInterval(t), 2400)
    return () => {
      clearInterval(t)
      clearTimeout(stop)
    }
  }, [royal])
  const pays = full
    ? [data.blind > 0 ? `Blind pays ${oddsWords(data.blind)}` : null, data.trips > 0 ? `Trips pays ${oddsWords(data.trips)}` : null].filter(Boolean).join(' · ')
    : `${data.words} · ${oddsWords(data.trips)} · +${fmt(data.tripsWin, data.tripsWin % 1 ? 2 : 0)}`
  const n = royal ? 14 : full ? 6 : 4
  const sparkles = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + i * 0.7
        const r = (narrow ? 90 : 170) * (full ? 1 : 0.7) * (0.75 + ((i * 37) % 10) / 22)
        return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.55, s: 8 + ((i * 13) % 9), d: (i % 5) * 0.12 }
      }),
    [n, narrow, full],
  )
  const size = royal ? (narrow ? 34 : 68) : full ? (narrow ? 30 : 56) : narrow ? 22 : 34
  return (
    <motion.div
      className="absolute inset-0 z-40 cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      onClick={onDone}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse ${narrow ? '85% 30%' : full ? '55% 32%' : '42% 24%'} at ${x}px ${y}px, rgba(3,8,26,${full ? 0.78 : 0.66}) 0%, rgba(3,8,26,.4) 55%, transparent 88%)`,
        }}
      />
      <div className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: x, top: y }}>
        {royal && (
          <motion.div
            className="absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full opacity-35 [mask-image:radial-gradient(circle,black_12%,transparent_55%)]"
            style={{ width: narrow ? 520 : 900, background: 'repeating-conic-gradient(from 0deg, #ffd45c 0deg 8deg, transparent 8deg 18deg, #9fd0ff 18deg 24deg, transparent 24deg 36deg)' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          />
        )}
        {sparkles.map((s, i) => (
          <motion.svg
            key={i}
            className="absolute"
            width={s.s * 2}
            height={s.s * 2}
            viewBox="-10 -10 20 20"
            style={{ left: s.x - s.s, top: s.y - s.s }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.2, 0.8, 1], opacity: [0, 1, 0.7, 0] }}
            transition={{ duration: 1.6, delay: 0.2 + s.d, repeat: royal ? Infinity : 0, repeatDelay: 0.4 }}
          >
            <path d="M0 -10 Q1.6 -1.6 10 0 Q1.6 1.6 0 10 Q-1.6 1.6 -10 0 Q-1.6 -1.6 0 -10Z" fill={i % 3 ? '#fff3c4' : '#bfe0ff'} />
          </motion.svg>
        ))}
        <motion.div
          className="relative flex flex-col items-center"
          initial={{ scale: full ? 0.4 : 0.7, y: 16 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: full ? 14 : 18 }}
        >
          <motion.div animate={full ? { scale: [1, 1.04, 1], rotate: [-1, 1, -1] } : undefined} transition={{ duration: 1.6, repeat: Infinity }}>
            <Lettering text={full ? (LETTERS[data.rank] ?? `${shortName(data.rank).toUpperCase()}!`) : 'TRIPS PAYS!'} royal={royal} size={size} />
          </motion.div>
          {pays && (
            <motion.div
              className={`mt-2 whitespace-nowrap rounded-full bg-[#06102b] font-black tracking-[.08em] text-gold ${narrow ? 'px-3 py-0.5 text-[10.5px]' : 'px-3.5 py-1 text-[13px]'}`}
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.12, 1] }}
              transition={{ delay: 0.3, duration: 0.4 }}
            >
              {pays}
            </motion.div>
          )}
          {royal && (
            <div className={`flex items-center gap-2 rounded-full border-[3px] border-[#06102b] bg-white shadow-[0_6px_0_rgba(6,16,43,.45)] ${narrow ? 'mt-2 px-3 py-1' : 'mt-3 px-4 py-1.5'}`}>
              <span className={`font-black uppercase tracking-[.14em] text-[#06102b]/55 ${narrow ? 'text-[10px]' : 'text-[12px]'}`}>Won</span>
              <span className={`tnum flex items-center gap-1.5 font-black text-[#06102b] ${narrow ? 'text-[19px]' : 'text-[28px]'}`}>
                +{fmt(counted)} <Coin size={narrow ? 18 : 24} />
              </span>
            </div>
          )}
          {/* (a tap anywhere closes it; on a phone the line would sit on the verdict, so it says nothing there) */}
          {!narrow && (
            <motion.div className="mt-2 text-[11px] font-bold text-white/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
              Tap to continue
            </motion.div>
          )}
        </motion.div>
      </div>
    </motion.div>
  )
}
