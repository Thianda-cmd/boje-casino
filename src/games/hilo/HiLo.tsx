import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, WinPopup, useStake } from '../../components/ui'
import { CardBack, CardFace } from '../../art/Card'
import type { Suit } from '../../art/suits'
import { fmt, fmtMult, round2 } from '../../lib/format'
import { randInt } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'

/* Hi-Lo: call whether the next card is higher or lower. Each correct call multiplies the payout
   by 0.99 / chance. Cards come from an endless deck, ace low, king high. */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
interface Card {
  r: number // 1..13
  s: Suit
  id: number
}
let seq = 1
const drawCard = (): Card => ({ r: 1 + randInt(13), s: SUITS[randInt(4)], id: seq++ })

type Call = 'hi' | 'lo'
/** For a card of rank r: the chance and label of each call. Ace can only go higher (or same), king only lower. */
function odds(r: number) {
  const hi = r === 1 ? { p: 12 / 13, label: 'Higher', strict: true } : r === 13 ? { p: 1 / 13, label: 'Same', strict: false } : { p: (14 - r) / 13, label: 'Higher or same', strict: false }
  const lo = r === 13 ? { p: 12 / 13, label: 'Lower', strict: true } : r === 1 ? { p: 1 / 13, label: 'Same', strict: false } : { p: r / 13, label: 'Lower or same', strict: false }
  return { hi, lo }
}
function wins(call: Call, from: number, to: number) {
  if (from === 1) return call === 'hi' ? to > 1 : to === 1
  if (from === 13) return call === 'lo' ? to < 13 : to === 13
  return call === 'hi' ? to >= from : to <= from
}
const factor = (p: number) => 0.99 / p

type Phase = 'idle' | 'playing' | 'lost' | 'cashed'
interface Step {
  card: Card
  call?: Call | 'skip'
  ok?: boolean
  mult: number
}

export default function HiLo() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState<Phase>('idle')
  const [steps, setSteps] = useState<Step[]>(() => [{ card: drawCard(), mult: 1 }])
  const [roundBet, setRoundBet] = useState(0)
  const [busy, setBusy] = useState(false)
  const [win, setWin] = useState<{ mult: number; amount: number } | null>(null)
  const [stageRef, size] = useSize<HTMLDivElement>()
  const stripRef = useRef<HTMLDivElement>(null)

  const card = steps[steps.length - 1].card
  const mult = steps[steps.length - 1].mult
  const o = odds(card.r)
  const playing = phase === 'playing'
  const correct = steps.filter((s) => s.ok).length

  useEffect(() => {
    stripRef.current?.scrollTo({ left: stripRef.current.scrollWidth, behavior: 'smooth' })
  }, [steps.length])

  const start = () => {
    if (!stake(bet)) return
    setRoundBet(bet)
    setWin(null)
    setSteps([{ card, mult: 1 }])
    setPhase('playing')
  }

  const next = async (call: Call | 'skip') => {
    if (busy) return
    if (call !== 'skip' && !playing) return
    setBusy(true)
    const c = drawCard()
    sfx.card()
    if (call === 'skip') {
      setSteps((s) => (playing ? [...s, { card: c, call: 'skip', mult }] : [{ card: c, mult: 1 }]))
    } else {
      const ok = wins(call, card.r, c.r)
      const p = call === 'hi' ? o.hi.p : o.lo.p
      const m = ok ? Math.floor(mult * factor(p) * 100) / 100 : 0
      setSteps((s) => [...s, { card: c, call, ok, mult: ok ? m : mult }])
      if (ok) {
        sfx.gem()
      } else {
        setPhase('lost')
        sfx.lose()
        settle({ game: 'hilo', bet: roundBet, payout: 0, meta: { mult: 0, calls: correct } })
      }
    }
    await new Promise((r) => setTimeout(r, 260))
    setBusy(false)
  }

  const cashOut = () => {
    if (!playing || mult <= 1 || busy) return
    const amount = round2(roundBet * mult)
    setPhase('cashed')
    setWin({ mult, amount })
    settle({ game: 'hilo', bet: roundBet, payout: amount, meta: { mult, calls: correct } })
    ;(mult >= 10 ? sfx.bigWin : sfx.win)()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        if (playing) cashOut()
        else start()
      } else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') void next('hi')
      else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') void next('lo')
      else if (e.key.toLowerCase() === 'n') void next('skip')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const callButton = (call: Call) => {
    const x = call === 'hi' ? o.hi : o.lo
    return (
      <motion.button
        whileTap={playing && !busy ? { scale: 0.97 } : undefined}
        disabled={!playing || busy}
        onClick={() => next(call)}
        className="flex min-h-[64px] w-full items-center gap-3 rounded-lg bg-raised px-4 text-left shadow-[inset_0_-3px_0_rgba(0,0,0,.2)] transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${x.label === 'Same' ? 'bg-gold text-[#2a1c00]' : call === 'hi' ? 'bg-accent text-[#032412]' : 'bg-danger text-white'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {x.label === 'Same' ? <path d="M5 9h14M5 15h14" /> : call === 'hi' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold">{x.label}</span>
          <span className="tnum block text-[12px] font-semibold text-muted">{(x.p * 100).toFixed(2)}%</span>
        </span>
        <span className="tnum text-[14px] font-extrabold text-ink/90">{fmtMult(Math.floor(factor(x.p) * 100) / 100)}</span>
      </motion.button>
    )
  }

  const panel = (
    <>
      <BetInput value={bet} onChange={setBet} disabled={playing} />
      <div className={`flex flex-col gap-2 ${playing ? 'max-lg:order-first' : ''}`}>
        {callButton('hi')}
        {callButton('lo')}
        <ActionButton tone="neutral" onClick={() => next('skip')} disabled={busy}>
          Skip card
        </ActionButton>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-stage px-3 py-2">
          <div className="text-[11px] font-semibold text-dim">Multiplier</div>
          <div className="tnum text-[15px] font-bold text-gold">{fmtMult(playing || phase === 'cashed' ? mult : 1)}</div>
        </div>
        <div className="rounded-lg bg-stage px-3 py-2">
          <div className="text-[11px] font-semibold text-dim">Profit</div>
          <div className="tnum text-[15px] font-bold text-accent">{fmt(playing ? roundBet * mult - roundBet : 0)}</div>
        </div>
      </div>
      <div className="max-lg:order-first lg:mt-auto">
        {playing ? (
          <ActionButton tone="gold" onClick={cashOut} disabled={mult <= 1 || busy} sub={mult > 1 ? `${fmt(roundBet * mult)} coins` : 'Make a correct call first'}>
            Cash out {mult > 1 ? fmtMult(mult) : ''}
          </ActionButton>
        ) : (
          <ActionButton onClick={start} disabled={balance < bet}>
            Bet
          </ActionButton>
        )}
      </div>
    </>
  )

  const cw = Math.round(Math.max(96, Math.min(190, (size.h - 200) / 1.4, size.w / 3.4)))
  const ch = Math.round(cw * 1.4)
  const small = Math.round(Math.max(44, Math.min(64, cw * 0.36)))

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,#14303a_0%,#0a1620_72%)]">
      <div className="relative flex flex-1 items-center justify-center">
        {/* deck */}
        <div className="absolute hidden sm:block" style={{ left: `calc(50% - ${cw * 1.35}px)`, top: `calc(50% - ${ch / 2}px)`, width: cw * 0.8, height: ch * 0.8 }}>
          {[3, 2, 1, 0].map((i) => (
            <CardBack key={i} className="absolute left-0 top-0 h-full w-full" style={{ transform: `translate(${-i * 2}px, ${-i * 2}px) rotate(-6deg)`, filter: i === 3 ? 'drop-shadow(0 10px 18px rgba(0,0,0,.5))' : undefined }} />
          ))}
        </div>
        <div className="relative" style={{ width: cw, height: ch }}>
          <AnimatePresence initial={false}>
            <motion.div
              key={card.id}
              className="absolute inset-0 [perspective:1000px]"
              initial={{ x: -cw * 0.9, y: -10, rotate: -8, opacity: 0 }}
              animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
              exit={{ x: cw * 0.5, opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            >
              <motion.div className="absolute inset-0 [transform-style:preserve-3d]" initial={{ rotateY: 180 }} animate={{ rotateY: 0 }} transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}>
                <CardFace rank={RANKS[card.r - 1]} suit={card.s} className="absolute inset-0 h-full w-full drop-shadow-[0_14px_24px_rgba(0,0,0,.5)] [backface-visibility:hidden]" />
                <CardBack className="absolute inset-0 h-full w-full [backface-visibility:hidden] [transform:rotateY(180deg)]" />
              </motion.div>
            </motion.div>
          </AnimatePresence>
          <AnimatePresence>
            {phase === 'lost' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 rounded-[10px] ring-4 ring-danger" style={{ boxShadow: '0 0 40px rgba(255,77,97,.5)' }} />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* the run so far */}
      <div ref={stripRef} className="no-scrollbar flex min-h-[112px] items-end gap-2 overflow-x-auto bg-panel2/60 px-4 py-3">
        {steps.map((s, i) => (
          <motion.div key={s.card.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex shrink-0 flex-col items-center gap-1.5">
            <div className="relative" style={{ width: small, height: small * 1.4 }}>
              <CardFace rank={RANKS[s.card.r - 1]} suit={s.card.s} className={`h-full w-full ${s.ok === false ? 'opacity-60' : ''}`} />
              {s.call && (
                <span
                  className={`absolute -left-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-black shadow ${
                    s.call === 'skip' ? 'bg-raised text-muted' : s.ok ? 'bg-accent text-[#032412]' : 'bg-danger text-white'
                  }`}
                >
                  {s.call === 'skip' ? '»' : s.call === 'hi' ? '▲' : '▼'}
                </span>
              )}
            </div>
            <span className={`tnum text-[11px] font-extrabold ${i === 0 ? 'text-dim' : s.ok === false ? 'text-danger' : s.call === 'skip' ? 'text-dim' : 'text-accent'}`}>{i === 0 ? 'Start' : s.ok === false ? 'Bust' : fmtMult(s.mult)}</span>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>{win && <WinPopup mult={win.mult} amount={win.amount} />}</AnimatePresence>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}
