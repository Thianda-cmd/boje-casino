import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, WinPopup, useStake } from '../../components/ui'
import { useSize } from '../../lib/useSize'
import { CardBack, CardFace } from '../../art/Card'
import { Chip } from '../../art/Chip'
import { fmt, round2 } from '../../lib/format'
import { shuffle } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'

/* ------------------------------------------------------------------ */
/*  Cards & rules: 6 decks, S17, BJ 3:2, double any two, one split      */
/* ------------------------------------------------------------------ */

const SUITS = ['♠', '♥', '♦', '♣'] as const
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
type Card = { rank: (typeof RANKS)[number]; suit: (typeof SUITS)[number]; id: number }

let cardSeq = 1
const newShoe = (): Card[] =>
  shuffle(Array.from({ length: 6 }, () => SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit, id: 0 })))).flat())

const cardValue = (c: Card) => (c.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank))
function score(cards: Card[]) {
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
const isBJ = (cards: Card[]) => cards.length === 2 && score(cards).total === 21

type Outcome = 'win' | 'lose' | 'push' | 'blackjack' | 'bust'
interface Hand {
  cards: Card[]
  bet: number
  done: boolean
  doubled?: boolean
  fromSplit?: boolean
  outcome?: Outcome
  payout?: number
}
type Phase = 'bet' | 'dealing' | 'player' | 'dealer' | 'done'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function Blackjack() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState<Phase>('bet')
  const [dealer, setDealer] = useState<Card[]>([])
  const [holeHidden, setHoleHidden] = useState(true)
  const [hands, setHands] = useState<Hand[]>([])
  const [active, setActive] = useState(0)
  const [summary, setSummary] = useState<{ net: number; payout: number } | null>(null)
  const [stageRef, size] = useSize<HTMLDivElement>()

  const shoe = useRef<Card[]>(newShoe())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  // mirror of state for async sequences
  const H = useRef<Hand[]>([])
  const D = useRef<Card[]>([])
  const setH = (h: Hand[]) => {
    H.current = h
    setHands(h)
  }
  const setD = (d: Card[]) => {
    D.current = d
    setDealer(d)
  }

  const draw = (): Card => {
    if (shoe.current.length < 20) shoe.current = newShoe()
    sfx.card()
    return { ...shoe.current.pop()!, id: cardSeq++ }
  }

  async function deal() {
    if (phase === 'dealing' || phase === 'player' || phase === 'dealer') return
    if (shoe.current.length < 60) shoe.current = newShoe()
    if (!stake(bet)) return
    setSummary(null)
    setHoleHidden(true)
    setActive(0)
    setD([])
    setH([{ cards: [], bet, done: false }])
    setPhase('dealing')
    await sleep(120)
    const seq: ('p' | 'd')[] = ['p', 'd', 'p', 'd']
    for (const who of seq) {
      if (!alive.current) return
      if (who === 'p') setH([{ ...H.current[0], cards: [...H.current[0].cards, draw()] }])
      else setD([...D.current, draw()])
      await sleep(300)
    }
    const up = D.current[0]
    const dealerBJ = isBJ(D.current)
    const playerBJ = isBJ(H.current[0].cards)
    // dealer peeks with an ace or ten showing
    if ((cardValue(up) >= 10 && dealerBJ) || playerBJ) {
      setHoleHidden(false)
      await sleep(450)
      finishRound()
      return
    }
    setPhase('player')
  }

  function advance(hs: Hand[]) {
    const next = hs.findIndex((h) => !h.done)
    if (next === -1) {
      setH(hs)
      void dealerTurn()
    } else {
      setActive(next)
      setH(hs)
    }
  }

  async function hit() {
    if (phase !== 'player') return
    const hs = H.current.map((h) => ({ ...h }))
    const h = hs[active]
    h.cards = [...h.cards, draw()]
    const t = score(h.cards).total
    if (t >= 21) h.done = true
    if (t > 21) h.outcome = 'bust'
    setH(hs)
    if (h.done) {
      setPhase('dealing')
      await sleep(380)
      setPhase('player')
      advance(H.current.map((x) => ({ ...x })))
    }
  }

  function stand() {
    if (phase !== 'player') return
    const hs = H.current.map((h) => ({ ...h }))
    hs[active].done = true
    advance(hs)
  }

  async function double() {
    if (phase !== 'player') return
    const h0 = H.current[active]
    if (h0.cards.length !== 2 || !stake(h0.bet)) return
    const hs = H.current.map((h) => ({ ...h }))
    const h = hs[active]
    h.bet = h.bet * 2
    h.doubled = true
    h.cards = [...h.cards, draw()]
    h.done = true
    if (score(h.cards).total > 21) h.outcome = 'bust'
    setH(hs)
    setPhase('dealing')
    await sleep(450)
    setPhase('player')
    advance(H.current.map((x) => ({ ...x })))
  }

  async function split() {
    if (!canSplit || !stake(H.current[active].bet)) return
    const [a, b] = H.current[0].cards
    const aces = a.rank === 'A'
    setPhase('dealing')
    let hs: Hand[] = [
      { cards: [a], bet: H.current[0].bet, done: false, fromSplit: true },
      { cards: [b], bet: H.current[0].bet, done: false, fromSplit: true },
    ]
    setH(hs)
    await sleep(320)
    for (let i = 0; i < 2; i++) {
      hs = hs.map((h, j) => (j === i ? { ...h, cards: [...h.cards, draw()], done: aces || score([...h.cards]).total === 21 } : h))
      setH(hs)
      await sleep(320)
    }
    // split aces get one card each; 21 stands automatically
    hs = hs.map((h) => ({ ...h, done: aces || score(h.cards).total === 21 }))
    setPhase('player')
    advance(hs)
  }

  async function dealerTurn() {
    setPhase('dealer')
    await sleep(250)
    setHoleHidden(false)
    sfx.card()
    await sleep(550)
    const allBust = H.current.every((h) => score(h.cards).total > 21)
    if (!allBust) {
      while (score(D.current).total < 17) {
        if (!alive.current) return
        setD([...D.current, draw()])
        await sleep(520)
      }
    }
    finishRound()
  }

  function finishRound() {
    const d = score(D.current).total
    const dBJ = isBJ(D.current)
    let totalBet = 0
    let totalPay = 0
    const hs = H.current.map((h) => {
      const p = score(h.cards).total
      const pBJ = isBJ(h.cards) && !h.fromSplit
      let outcome: Outcome
      let payout = 0
      if (p > 21) outcome = 'bust'
      else if (pBJ && !dBJ) {
        outcome = 'blackjack'
        payout = h.bet * 2.5
      } else if (dBJ && !pBJ) outcome = 'lose'
      else if (pBJ && dBJ) {
        outcome = 'push'
        payout = h.bet
      } else if (d > 21 || p > d) {
        outcome = 'win'
        payout = h.bet * 2
      } else if (p === d) {
        outcome = 'push'
        payout = h.bet
      } else outcome = 'lose'
      totalBet += h.bet
      totalPay += payout
      return { ...h, done: true, outcome, payout: round2(payout) }
    })
    setH(hs)
    setPhase('done')
    settle({ game: 'blackjack', bet: round2(totalBet), payout: round2(totalPay) })
    setSummary({ net: round2(totalPay - totalBet), payout: round2(totalPay) })
    if (totalPay > totalBet) (hs.some((h) => h.outcome === 'blackjack') ? sfx.bigWin : sfx.win)()
    else if (totalPay < totalBet) sfx.lose()
  }

  const cur = hands[active]
  const inPlay = phase === 'player'
  const canDouble = inPlay && cur?.cards.length === 2 && balance >= cur.bet
  const canSplit =
    inPlay && hands.length === 1 && cur?.cards.length === 2 && cardValue(cur.cards[0]) === cardValue(cur.cards[1]) && balance >= cur.bet
  const busy = phase === 'dealing' || phase === 'dealer'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const k = e.key.toLowerCase()
      if (k === ' ' && (phase === 'bet' || phase === 'done')) (e.preventDefault(), deal())
      else if (k === 'h') hit()
      else if (k === 's') stand()
      else if (k === 'd' && canDouble) double()
      else if (k === 'p' && canSplit) split()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const panel = (
    <>
      <BetInput value={bet} onChange={setBet} disabled={phase !== 'bet' && phase !== 'done'} />
      {/* on phones the controls you need right now sit straight under the table */}
      <div className={`grid grid-cols-2 gap-2 ${inPlay ? 'max-lg:order-first' : ''}`}>
        <ActionButton tone="neutral" onClick={hit} disabled={!inPlay}>
          Hit <Kbd>H</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={stand} disabled={!inPlay}>
          Stand <Kbd>S</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={double} disabled={!canDouble}>
          Double <Kbd>D</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={split} disabled={!canSplit}>
          Split <Kbd>P</Kbd>
        </ActionButton>
      </div>
      <div className="max-lg:order-first lg:mt-auto">
        <ActionButton onClick={deal} disabled={busy || inPlay}>
          Bet
        </ActionButton>
      </div>
    </>
  )

  const dScore = score(holeHidden ? dealer.slice(0, 1) : dealer)

  const cw = Math.round(Math.max(62, Math.min(118, (size.h - 170) / 2 / 1.4, size.w / 4.6)))
  const vars = { ['--card-w' as string]: `${cw}px`, ['--card-h' as string]: `${Math.round(cw * 1.4)}px` } as CSSProperties

  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden" style={vars}>
      <Felt />

      <Shoe />

      {/* dealer */}
      <div className="absolute inset-x-0 top-[6%] flex flex-col items-center gap-3">
        <div className="relative flex h-[var(--card-h)] items-center">
          {dealer.length === 0 && <CardSlot />}
          <AnimatePresence>
            {dealer.map((c, i) => (
              <PlayingCard key={c.id} card={c} index={i} hidden={i === 1 && holeHidden} />
            ))}
          </AnimatePresence>
        </div>
        <ScorePill value={dealer.length ? (holeHidden ? `${dScore.total}` : fmtScore(dealer)) : null} />
      </div>

      {/* player hands */}
      <div className="absolute inset-x-0 bottom-[6%] flex items-end justify-center gap-[6vw]">
        {hands.length === 0 && (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8" />
            <CardSlot />
          </div>
        )}
        <AnimatePresence>
          {hands.map((h, hi) => (
            <motion.div
              key={hi}
              layout
              className={`flex flex-col items-center gap-3 transition-opacity ${hands.length > 1 && inPlay && hi !== active ? 'opacity-55' : ''}`}
            >
              <div className="flex items-center gap-2">
                <ScorePill value={h.cards.length ? fmtScore(h.cards) : null} active={inPlay && hi === active} />
                {h.cards.length > 0 && <ChipStack amount={h.bet} doubled={!!h.doubled} />}
              </div>
              <div className="relative flex h-[var(--card-h)] items-center">
                <AnimatePresence>
                  {h.cards.map((c, i) => (
                    <PlayingCard key={c.id} card={c} index={i} fromBottom />
                  ))}
                </AnimatePresence>
                <AnimatePresence>{h.outcome && phase === 'done' && <OutcomeBadge outcome={h.outcome} payout={h.payout ?? 0} bet={h.bet} />}</AnimatePresence>
                <AnimatePresence>{h.outcome === 'bust' && phase !== 'done' && <OutcomeBadge outcome="bust" payout={0} bet={h.bet} />}</AnimatePresence>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>{summary && phase === 'done' && summary.net > 0 && <WinPopup mult={summary.payout / (summary.payout - summary.net)} amount={summary.payout} />}</AnimatePresence>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}

function fmtScore(cards: Card[]) {
  const s = score(cards)
  if (isBJ(cards)) return 'BJ'
  return s.soft && s.total < 21 ? `${s.total - 10}/${s.total}` : `${s.total}`
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 hidden rounded border border-white/15 px-1 text-[10px] font-bold text-white/40 lg:inline">{children}</span>
}

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** Green baize with a soft spotlight, a fine weave and the dealer's arc. */
function Felt() {
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

function ScorePill({ value, active }: { value: string | null; active?: boolean }) {
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

function ChipStack({ amount, doubled }: { amount: number; doubled: boolean }) {
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

function OutcomeBadge({ outcome, payout, bet }: { outcome: Outcome; payout: number; bet: number }) {
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
function CardSlot() {
  return <div className="h-[var(--card-h)] w-[var(--card-w)] rounded-[10px] border-2 border-dashed border-white/20 bg-white/[.03]" />
}

/** The shoe, peeking in from the corner the cards are dealt from. */
function Shoe() {
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

function PlayingCard({ card, index, hidden, fromBottom }: { card: Card; index: number; hidden?: boolean; fromBottom?: boolean }) {
  return (
    <motion.div
      layout
      initial={{ x: 420, y: fromBottom ? -360 : -80, rotate: -16, opacity: 0 }}
      animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
      exit={{ y: -40, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
      className="relative h-[var(--card-h)] w-[var(--card-w)] [perspective:900px]"
      style={{ marginLeft: index ? 'calc(var(--card-w) * -0.5)' : 0, zIndex: index, filter: 'drop-shadow(0 8px 14px rgba(0,0,0,.4))' }}
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
