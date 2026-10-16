import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, WinPopup, useStake } from '../../components/ui'
import { useSize } from '../../lib/useSize'
import { round2 } from '../../lib/format'
import { shuffle } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'
import {
  CardSlot,
  ChipStack,
  Felt,
  Kbd,
  OutcomeBadge,
  PlayingCard,
  RANKS,
  ScorePill,
  Shoe,
  SUITS,
  cardValue,
  fmtScore,
  isBJ,
  score,
  type Card,
  type Outcome,
} from './table'

let cardSeq = 1
const newShoe = (): Card[] =>
  shuffle(Array.from({ length: 6 }, () => SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit, id: 0 })))).flat())

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
