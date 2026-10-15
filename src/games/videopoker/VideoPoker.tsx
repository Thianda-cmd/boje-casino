import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Stat, useStake } from '../../components/ui'
import { Coin } from '../../components/icons'
import { CardBack, CardFace } from '../../art/Card'
import { fmt, round2 } from '../../lib/format'
import { rand, shuffle } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'
import { HANDS, PAY, RANK_LABEL, bestHold, evaluate, newDeck, type HandId, type PCard } from './rules'

/* Jacks or Better: deal five, hold what you like, draw once. */

type Phase = 'idle' | 'dealt' | 'busy' | 'done'
interface Slot {
  card: PCard
  /** changes whenever a new card lands here, so it flips in */
  id: number
}

const GRID: HandId[] = ['royal', 'sflush', 'quads', 'full', 'flush', 'straight', 'trips', 'twopair', 'jacks']
const NAME = Object.fromEntries(HANDS.map((h) => [h.id, h.name])) as Record<HandId, string>
const DEAL_GAP = 0.08

export default function VideoPoker() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState<Phase>('idle')
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [held, setHeld] = useState<boolean[]>([false, false, false, false, false])
  const [result, setResult] = useState<{ hand: HandId | null; used: boolean[]; payout: number } | null>(null)
  const [suggest, setSuggest] = useState<boolean[] | null>(null)
  const deck = useRef<PCard[]>([])
  const roundBet = useRef(0)
  const seq = useRef(1)
  const pending = useRef<{ bet: number; cards: PCard[] } | null>(null)

  // leaving mid-hand stands on the cards as dealt
  useEffect(
    () => () => {
      const p = pending.current
      if (!p) return
      const h = evaluate(p.cards).hand
      useWallet.getState().settle({ game: 'videopoker', bet: p.bet, payout: h ? round2(p.bet * PAY[h]) : 0, meta: { hand: h ?? 'none' } })
    },
    [],
  )

  const live = slots && phase === 'dealt' ? evaluate(slots.map((s) => s.card)) : null

  const deal = () => {
    if (phase === 'dealt' || phase === 'busy') return
    if (!stake(bet)) return
    roundBet.current = bet
    const d = shuffle(newDeck())
    deck.current = d.slice(5)
    const hand = d.slice(0, 5).map((card) => ({ card, id: seq.current++ }))
    setSlots(hand)
    setHeld([false, false, false, false, false])
    setSuggest(null)
    setResult(null)
    setPhase('busy')
    pending.current = { bet, cards: hand.map((s) => s.card) }
    hand.forEach((_, i) => setTimeout(sfx.card, i * DEAL_GAP * 1000))
    setTimeout(() => setPhase('dealt'), 5 * DEAL_GAP * 1000 + 250)
  }

  const toggle = (i: number) => {
    if (phase !== 'dealt') return
    sfx.click()
    setHeld((h) => h.map((v, j) => (j === i ? !v : v)))
  }

  const hint = () => {
    if (phase !== 'dealt' || !slots) return
    const b = bestHold(
      slots.map((s) => s.card),
      deck.current,
      rand,
    )
    sfx.click()
    setHeld(b.hold)
    setSuggest(b.hold)
  }

  const draw = () => {
    if (phase !== 'dealt' || !slots) return
    setPhase('busy')
    let k = 0
    const next = slots.map((s, i) => (held[i] ? s : { card: deck.current[k++], id: seq.current++ }))
    const swapped = held.map((h) => !h)
    setSlots(next)
    setSuggest(null)
    let n = 0
    swapped.forEach((sw) => sw && setTimeout(sfx.card, n++ * DEAL_GAP * 1000))
    setTimeout(() => {
      const r = evaluate(next.map((s) => s.card))
      const payout = r.hand ? round2(roundBet.current * PAY[r.hand]) : 0
      pending.current = null
      useWallet.getState().settle({ game: 'videopoker', bet: roundBet.current, payout, meta: { hand: r.hand ?? 'none' } })
      setResult({ ...r, payout })
      setPhase('done')
      if (!r.hand) sfx.lose()
      else if (PAY[r.hand] >= 25) sfx.bigWin()
      else if (PAY[r.hand] > 1) sfx.win()
      else sfx.coin()
    }, Math.max(1, n) * DEAL_GAP * 1000 + 380)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        if (phase === 'dealt') draw()
        else deal()
      } else if (/^Digit[1-5]$/.test(e.code)) toggle(Number(e.code.slice(5)) - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const shownHand = phase === 'done' ? result?.hand : live?.hand
  const panel = (
    <>
      <BetInput value={bet} onChange={setBet} disabled={phase === 'dealt' || phase === 'busy'} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Hand" value={shownHand ? NAME[shownHand] : '—'} />
        <Stat label="Win" value={fmt(phase === 'done' ? (result?.payout ?? 0) : 0)} tone={phase === 'done' && result?.payout ? 'accent' : undefined} />
      </div>
      <button
        onClick={hint}
        disabled={phase !== 'dealt'}
        className="h-11 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
      >
        Best hold
      </button>
      <div className="max-lg:order-first lg:mt-auto">
        {phase === 'dealt' || (phase === 'busy' && slots && !result && pending.current) ? (
          <ActionButton onClick={draw} disabled={phase !== 'dealt'} sub={held.some(Boolean) ? `Holding ${held.filter(Boolean).length}` : 'Tap cards to hold them'}>
            Draw
          </ActionButton>
        ) : (
          <ActionButton onClick={deal} disabled={phase === 'busy' || balance < bet}>
            Deal
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const [boxRef, box] = useSize<HTMLDivElement>({ w: 800, h: 400 })
  const narrow = box.w < 520
  const gap = narrow ? 6 : 14
  const cw = Math.round(Math.max(52, Math.min((box.w - 24 - gap * 4) / 5, (box.h - 70) / 1.4, 150)))
  const ch = Math.round(cw * 1.4)

  const stage = (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_55%,#123a5c_0%,#0b2236_55%,#0a1620_100%)]">
      <Paytable bet={phase === 'dealt' || phase === 'busy' ? roundBet.current || bet : bet} hand={shownHand ?? null} won={phase === 'done' && !!result?.hand} />
      <div ref={boxRef} className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex items-end" style={{ gap }}>
            {Array.from({ length: 5 }, (_, i) => {
              const s = slots?.[i]
              const h = held[i]
              const win = phase === 'done' && result?.used[i]
              const dim = phase === 'done' && result?.hand && !result.used[i]
              return (
                <div key={i} className="flex flex-col items-center gap-2">
                  <motion.button
                    onClick={() => toggle(i)}
                    disabled={phase !== 'dealt'}
                    animate={{ y: h && phase !== 'done' ? -12 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className={`relative rounded-[10px] ${phase === 'dealt' ? 'cursor-pointer' : 'cursor-default'}`}
                    style={{ width: cw, height: ch }}
                    aria-label={s ? `Card ${i + 1}: ${RANK_LABEL(s.card.r)}${s.card.s}${h ? ', held' : ''}` : `Card ${i + 1}`}
                  >
                    {s ? (
                      <motion.div
                        key={s.id}
                        className="absolute inset-0 [transform-style:preserve-3d]"
                        initial={{ rotateY: 180, y: -18 }}
                        animate={{ rotateY: 0, y: 0 }}
                        transition={{ duration: 0.38, ease: [0.4, 0, 0.2, 1], delay: (phase === 'busy' && !result ? i : 0) * DEAL_GAP }}
                      >
                        <CardFace
                          rank={RANK_LABEL(s.card.r)}
                          suit={s.card.s}
                          className="absolute inset-0 h-full w-full drop-shadow-[0_12px_20px_rgba(0,0,0,.45)] [backface-visibility:hidden]"
                          style={{ opacity: dim ? 0.4 : 1, transition: 'opacity .3s' }}
                        />
                        <CardBack className="absolute inset-0 h-full w-full [backface-visibility:hidden] [transform:rotateY(180deg)]" />
                      </motion.div>
                    ) : (
                      <CardBack className="absolute inset-0 h-full w-full opacity-90 drop-shadow-[0_12px_20px_rgba(0,0,0,.45)]" />
                    )}
                    {(h && phase !== 'done') || win ? (
                      <span className={`pointer-events-none absolute -inset-[3px] rounded-[12px] ring-[3px] ${win ? 'ring-gold shadow-[0_0_24px_rgba(247,197,72,.55)]' : 'ring-accent'}`} />
                    ) : suggest?.[i] ? (
                      <span className="pointer-events-none absolute -inset-[3px] rounded-[12px] outline-2 outline-dashed outline-gold/70" />
                    ) : null}
                  </motion.button>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition sm:text-[11px] ${
                      h && phase !== 'idle' && phase !== 'done' ? 'bg-accent text-[#032412] opacity-100' : 'opacity-0'
                    }`}
                  >
                    Held
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex h-14 shrink-0 items-center justify-center px-3">
        <AnimatePresence mode="wait">
          {phase === 'done' && result ? (
            <motion.div
              key={`r${slots?.[0]?.id}`}
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              className={`tnum flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-extrabold ${result.hand ? 'bg-gold/15 text-gold' : 'bg-black/30 text-muted'}`}
            >
              {result.hand ? (
                <>
                  {NAME[result.hand]} · +{fmt(result.payout)} <Coin size={16} />
                </>
              ) : (
                'No win'
              )}
            </motion.div>
          ) : phase === 'dealt' && live?.hand ? (
            <motion.div key="live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-full bg-black/30 px-4 py-2 text-[14px] font-bold text-ink">
              You have {NAME[live.hand]}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}

function Paytable({ bet, hand, won }: { bet: number; hand: HandId | null; won: boolean }) {
  return (
    <div className="grid shrink-0 grid-cols-3 gap-1 p-2 sm:gap-1.5 sm:p-4">
      {GRID.map((id) => {
        const on = hand === id
        return (
          <div
            key={id}
            className={`rounded-lg px-2 py-1.5 transition-colors duration-300 sm:px-3 sm:py-2 ${
              on ? (won ? 'bg-gold text-[#2a1c00] shadow-[0_0_24px_rgba(247,197,72,.45)]' : 'bg-white/15 text-ink ring-1 ring-white/30') : 'bg-black/25 text-ink'
            }`}
          >
            <div className={`truncate text-[10px] font-bold sm:text-[12px] ${on ? '' : 'text-muted'}`}>{NAME[id]}</div>
            <div className="tnum flex items-baseline justify-between gap-1">
              <span className="truncate text-[13px] font-extrabold sm:text-[15px]">{fmt(bet * PAY[id], bet * PAY[id] >= 1000 ? 0 : 2)}</span>
              <span className={`text-[10px] font-bold sm:text-[11px] ${on ? 'opacity-70' : 'text-dim'}`}>{PAY[id]}×</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
