import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { CardBack, CardFace } from '../../art/Card'
import { Chip } from '../../art/Chip'
import { IconCheck } from '../../components/icons'
import { PlayerName } from '../../components/profile/PlayerName'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { ChipStack, OutcomeBadge, PlayingCard, ScorePill, type Card, type Outcome } from '../blackjack/table'
import { ReactionBubble } from './stickers'
import type { ReactionCode } from './types'
import { scoreOf } from './view'

/* One seat at the table: its hands, the betting spot and the nameplate. Desktop seats sit on the arc
   at full size; phones show the other seats as compact pods and yours (or the one being watched) big. */

export interface ShownCard {
  /** position in the hand: a hit's placeholder and the card that replaces it share it, so the card flips in place */
  key: string
  /** the card's identity in the round, for flights and for moving between split hands */
  id: string
  card: Card
  faceDown: boolean
  /** seconds to wait before flying in, or null when it is already on the table */
  delay: number | null
}
export interface ShownHand {
  key: string
  idx: 0 | 1
  bet: number
  doubled: boolean
  split: boolean
  cards: ShownCard[]
  outcome: Outcome | null
  payout: number | null
  active: boolean
  /** a split hand that isn't being played right now */
  dim: boolean
}
export interface SeatInfo {
  seat: number
  name: string
  avatar: number
  tag: 'you' | 'guest' | 'account' | 'bot'
  /** a signed-in player: the name opens their profile */
  acct?: boolean
  /** away, idle, left the table, leaving */
  status: string | null
  /** the sitter has gone and only their hand is left */
  ghost: boolean
}
export interface TurnInfo {
  key: string
  at: number
  endsAt: number
  away: boolean
}

const GREEN = '#22d36f'
const GOLD = '#f7c548'
const RED = '#ff4d61'

/** The countdown ring around a player's avatar: drains over the turn, gold under 5 s, red under 3 s. */
export function TurnRing({ size, turn, now, mine, children }: { size: number; turn: TurnInfo | null; now: () => number; mine?: boolean; children: ReactNode }) {
  const ref = useRef<SVGCircleElement>(null)
  const r = size / 2 - 2
  const c = 2 * Math.PI * r
  useEffect(() => {
    const el = ref.current
    if (!el || !turn || !el.animate) return
    const d = Math.max(1, turn.endsAt - turn.at)
    const k = (ms: number) => Math.max(0, Math.min(1, ms / d))
    const opts: KeyframeAnimationOptions = { duration: d, delay: -(now() - turn.at), fill: 'forwards', easing: 'linear' }
    const drain = el.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: c }], opts)
    const a = k(d - 5000)
    const b = k(d - 3000)
    const tint = el.animate(
      [
        { stroke: GREEN, offset: 0 },
        { stroke: GREEN, offset: a },
        { stroke: GOLD, offset: a },
        { stroke: GOLD, offset: b },
        { stroke: RED, offset: b },
        { stroke: RED, offset: 1 },
      ],
      opts,
    )
    return () => (drain.cancel(), tint.cancel())
    // the key changes whenever the turn or its deadline does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn?.key, c])
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      {children}
      <svg className="pointer-events-none absolute inset-0 -rotate-90" width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={mine ? GOLD : 'rgba(255,255,255,.14)'} strokeWidth={mine ? 2 : 1.5} />
        {turn && (
          <circle
            key={turn.key}
            ref={ref}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={GREEN}
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeDasharray={turn.away ? `${c / 24} ${c / 48}` : c}
            style={{ filter: 'drop-shadow(0 0 4px rgba(34,211,111,.55))' }}
          />
        )}
      </svg>
    </span>
  )
}

const TAG: Record<SeatInfo['tag'], ReactNode> = {
  you: <span className="rounded bg-gold px-1 text-[9px] font-black uppercase leading-[14px] tracking-wide text-[#2a1c00]">You</span>,
  bot: <span className="rounded bg-white/15 px-1 text-[9px] font-black uppercase leading-[14px] tracking-wide text-white/80">Bot</span>,
  guest: <span className="text-[10px] font-bold text-white/45">Guest</span>,
  account: (
    <span className="flex items-center gap-0.5 text-[10px] font-bold text-sky" title="Signed-in player">
      <IconCheck size={10} strokeWidth={3.5} /> Player
    </span>
  ),
}

export function Nameplate({ info, turn, now, size = 30 }: { info: SeatInfo; turn: TurnInfo | null; now: () => number; size?: number }) {
  const me = info.tag === 'you'
  return (
    <div
      className={`flex max-w-full items-center gap-1.5 rounded-full py-[3px] pl-[3px] pr-3 ring-1 transition-[opacity,box-shadow] duration-300 ${
        me ? 'bg-[#2a2208]/85 ring-gold/45' : 'bg-[#071a14]/75 ring-white/10'
      } ${turn ? 'shadow-[0_0_0_2px_rgba(34,211,111,.55),0_0_22px_-2px_rgba(34,211,111,.6)]' : ''} ${info.ghost ? 'opacity-55' : ''}`}
    >
      <TurnRing size={size + 6} turn={turn} now={now} mine={me}>
        <Avatar index={info.avatar} size={size} />
      </TurnRing>
      <div className="min-w-0 leading-tight">
        <PlayerName name={info.name} acct={info.acct} className="block max-w-full truncate text-[12px] font-extrabold text-white" />
        <div className="flex min-w-0 items-center gap-1">
          {TAG[info.tag]}
          {info.status && <span className="truncate text-[10px] font-bold text-white/50">· {info.status}</span>}
        </div>
      </div>
    </div>
  )
}

/** The betting spot: the stake's chips, which slide to the dealer on a loss; winnings slide in from the dealer. */
export function BetSpot({ amount, pending, outcome, dealer, size = 44, empty }: { amount: number; pending?: boolean; outcome: Outcome | null; dealer: { x: number; y: number }; size?: number; empty?: ReactNode }) {
  const lost = outcome === 'lose' || outcome === 'bust'
  const won = outcome === 'win' || outcome === 'blackjack'
  const chip = size - 10
  return (
    <div className="relative flex items-center justify-center rounded-full border-2 border-dashed border-white/20 bg-black/10" style={{ width: size, height: size }}>
      <AnimatePresence>
        {amount > 0 && (
          <motion.div
            key="stake"
            className="absolute"
            initial={{ y: -26, opacity: 0, scale: 0.8 }}
            animate={lost ? { x: dealer.x, y: dealer.y, opacity: 0, scale: 0.7 } : { x: 0, y: 0, opacity: pending ? 0.6 : 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, transition: { duration: 0.2 } }}
            transition={lost ? { duration: 0.6, delay: 0.35, ease: [0.4, 0, 0.2, 1] } : { type: 'spring', stiffness: 420, damping: 26 }}
          >
            <ChipPile amount={amount} size={chip} />
          </motion.div>
        )}
        {won && amount > 0 && (
          <motion.div
            key="won"
            className="absolute"
            initial={{ x: dealer.x, y: dealer.y, opacity: 0, scale: 0.7 }}
            animate={{ x: size * 0.42, y: -size * 0.1, opacity: 1, scale: 0.9 }}
            transition={{ duration: 0.6, delay: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <ChipPile amount={amount} size={chip} />
          </motion.div>
        )}
      </AnimatePresence>
      {amount === 0 && empty}
    </div>
  )
}

function ChipPile({ amount, size }: { amount: number; size: number }) {
  const n = amount >= 100 ? 3 : amount >= 10 ? 2 : 1
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
          <Chip value={amount} size={size} label={i === n - 1 ? undefined : ''} />
        </span>
      ))}
    </div>
  )
}

/** A card that announces itself with the deal sound when it flies in. */
function DealtCard({ c, index, overlap, from }: { c: ShownCard; index: number; overlap: number; from: { x: number; y: number } }) {
  useEffect(() => {
    if (c.delay == null) return
    const id = setTimeout(sfx.card, c.delay * 1000)
    return () => clearTimeout(id)
    // only on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // a face-down placeholder keeps its origin, so it slides back to the shoe if the move is refused
  return <PlayingCard card={c.card} index={index} hidden={c.faceDown} from={c.delay == null && !c.faceDown ? null : from} delay={c.delay ?? 0} overlap={overlap} layoutId={c.faceDown ? undefined : c.id} />
}

/** A seat's hands at full size: cards fanned, the score and stake above them, the result below. Split hands sit side by side. */
export function SeatHands({ hands, from, scale = 0.8 }: { hands: ShownHand[]; from: { x: number; y: number }; scale?: number }) {
  const split = hands.length > 1
  return (
    <div className="flex items-end justify-center gap-2">
      <AnimatePresence initial={false}>
        {hands.map((h) => {
          const value = scoreOf(
            h.cards.filter((c) => !c.faceDown).map((c) => c.card),
            h.split,
          )
          return (
            <motion.div
              key={h.key}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: h.dim ? 0.55 : 1, scale: split ? scale : 1 }}
              exit={{ opacity: 0, y: -16, transition: { duration: 0.25 } }}
              className="flex origin-bottom flex-col items-center gap-1.5"
            >
              <div className="flex items-center gap-1.5">
                <ScorePill value={value} active={h.active} />
                {h.cards.length > 0 && <ChipStack amount={h.bet} doubled={h.doubled} />}
              </div>
              <div className="relative flex h-[var(--card-h)] items-center">
                <AnimatePresence>
                  {h.cards.map((c, i) => (
                    <DealtCard key={c.key} c={c} index={i} overlap={h.cards.length > 3 ? 0.62 : 0.5} from={from} />
                  ))}
                </AnimatePresence>
                <AnimatePresence>{h.outcome && <OutcomeBadge outcome={h.outcome} payout={h.payout ?? 0} bet={h.bet} />}</AnimatePresence>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/** The latest reaction over a seat. */
export function SeatReaction({ code, id, size }: { code: ReactionCode | null; id: number | null; size?: number }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2">
      <AnimatePresence>{code && <ReactionBubble key={id} code={code} size={size} />}</AnimatePresence>
    </div>
  )
}

/* ---------- phones ---------- */

function MiniCard({ c }: { c: ShownCard }) {
  return (
    <motion.div
      initial={c.delay == null ? false : { y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.25, delay: c.delay ?? 0 }}
      className="relative h-[34px] w-[24px] shrink-0 [&+&]:-ml-[13px]"
      style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.4))' }}
    >
      {c.faceDown ? <CardBack className="h-full w-full" /> : <CardFace rank={c.card.rank} suit={c.card.suit} className="h-full w-full" />}
    </motion.div>
  )
}

/** Another seat on a phone: avatar with the turn ring, name, mini cards and the score or result. */
export function Pod({
  info,
  hands,
  turn,
  now,
  bet,
  reaction,
  onClick,
  empty,
}: {
  info: SeatInfo | null
  hands: ShownHand[]
  turn: TurnInfo | null
  now: () => number
  bet: number
  reaction: { code: ReactionCode; id: number } | null
  onClick?: () => void
  empty?: ReactNode
}) {
  if (!info)
    return (
      <button onClick={onClick} disabled={!onClick} className="flex w-14 flex-col items-center gap-1 pt-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-white/20 text-[10px] font-extrabold text-white/60">{empty}</span>
      </button>
    )
  const result = hands.find((h) => h.outcome)
  const active = hands.find((h) => h.active)
  const value = (active ?? hands[0]) && scoreOf((active ?? hands[0]).cards.filter((c) => !c.faceDown).map((c) => c.card), (active ?? hands[0]).split)
  return (
    <button onClick={onClick} className={`relative flex w-14 flex-col items-center gap-0.5 ${info.ghost ? 'opacity-55' : ''}`}>
      <SeatReaction code={reaction?.code ?? null} id={reaction?.id ?? null} size={34} />
      <TurnRing size={34} turn={turn} now={now} mine={info.tag === 'you'}>
        <Avatar index={info.avatar} size={28} />
        {info.tag === 'bot' && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-white px-1 text-[7px] font-black leading-[11px] text-[#0b1520]">BOT</span>
        )}
      </TurnRing>
      <span className="w-full truncate text-center text-[10px] font-bold leading-tight text-white/85">{info.name}</span>
      <div className="flex h-[34px] items-center justify-center">
        {hands.map((h) => (
          <div key={h.key} className={`flex ${h.dim ? 'opacity-50' : ''} [&+&]:ml-1`}>
            {h.cards.map((c) => (
              <MiniCard key={c.key} c={c} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex h-[18px] items-center">
        {result?.outcome ? (
          <PodResult outcome={result.outcome} net={hands.reduce((s, h) => s + (h.payout ?? 0) - h.bet, 0)} />
        ) : value ? (
          <span className={`tnum rounded-full px-1.5 text-[10px] font-extrabold leading-[16px] ${active ? 'bg-accent text-[#032412]' : 'bg-[#071a14]/80 text-white'}`}>{value}</span>
        ) : bet > 0 ? (
          <span className="tnum rounded-full bg-[#071a14]/80 px-1.5 text-[10px] font-bold leading-[16px] text-white/85">{fmt(bet, 0)}</span>
        ) : null}
      </div>
    </button>
  )
}

function PodResult({ outcome, net }: { outcome: Outcome; net: number }) {
  const cls = outcome === 'blackjack' ? 'bg-gold text-[#2a1c00]' : outcome === 'win' ? 'bg-accent text-[#032412]' : outcome === 'push' ? 'bg-white text-[#0b1520]' : 'bg-danger text-white'
  const text = outcome === 'blackjack' ? 'BJ' : outcome === 'push' ? 'Push' : outcome === 'bust' ? 'Bust' : net > 0 ? `+${fmt(net, 0)}` : 'Lose'
  return <span className={`tnum rounded-full px-1.5 text-[10px] font-extrabold leading-[16px] ${cls}`}>{text}</span>
}

export const cardVars = (cw: number): CSSProperties => ({ ['--card-w' as string]: `${cw}px`, ['--card-h' as string]: `${Math.round(cw * 1.4)}px` })
