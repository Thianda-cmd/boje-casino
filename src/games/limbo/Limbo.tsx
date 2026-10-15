import { useEffect, useRef, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, NumberField, Stat, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { fmt, fmtMult, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'

/* Limbo: pick a target. A multiplier is drawn with P(result ≥ x) = 0.99 / x; reach the target and you win it. */

const MAX = 1_000_000

export default function Limbo() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(2)
  const [mode, setMode] = useState<Mode>('manual')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<'idle' | 'win' | 'loss'>('idle')
  const [history, setHistory] = useState<{ id: number; value: number; win: boolean }[]>([])
  const [shown, setShown] = useState(1)
  const numRef = useRef<HTMLSpanElement>(null)
  const seq = useRef(0)

  const chance = 99 / target

  const play = async (): Promise<number | null> => {
    if (!stake(bet)) return null
    setBusy(true)
    setState('idle')
    const t = target
    const result = Math.min(MAX, Math.max(1, Math.floor((0.99 / (1 - rand())) * 100) / 100))
    const win = result >= t
    await new Promise<void>((done) => {
      const dur = Math.min(0.9, 0.35 + Math.log10(result) * 0.18)
      animate(1, result, {
        duration: dur,
        ease: [0.2, 0.7, 0.3, 1],
        onUpdate: (v) => numRef.current && (numRef.current.textContent = fmtMult(Math.floor(v * 100) / 100)),
        onComplete: done,
      })
    })
    if (numRef.current) numRef.current.textContent = fmtMult(result)
    const payout = win ? round2(bet * t) : 0
    settle({ game: 'limbo', bet, payout, meta: { target: t } })
    setState(win ? 'win' : 'loss')
    setShown(result)
    setHistory((h) => [{ id: ++seq.current, value: result, win }, ...h].slice(0, 12))
    if (win) (t >= 10 ? sfx.bigWin : sfx.win)()
    else sfx.lose()
    setBusy(false)
    return payout - bet
  }

  const auto = useAutoBet(play, 250)
  const locked = busy || auto.running

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space' && mode === 'manual') {
        e.preventDefault()
        if (!busy) void play()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={auto.running} />
      <BetInput value={bet} onChange={setBet} disabled={auto.running} />
      <Stat label="Profit on win" value={fmt(bet * target - bet)} tone="accent" />
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div className="max-lg:order-first lg:mt-auto">
        {mode === 'manual' ? (
          <ActionButton onClick={play} disabled={busy || balance < bet}>
            Bet
          </ActionButton>
        ) : auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop}>
            Stop autobet
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={balance < bet}>
            Start autobet
          </ActionButton>
        )}
      </div>
    </>
  )

  const color = state === 'win' ? '#22d36f' : state === 'loss' ? '#ff4d61' : '#ffffff'
  const stage = (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#16293a_0%,#0a1620_70%)]">
      <HistoryPills className="justify-end px-4 pt-4" items={history.map((h) => ({ key: h.id, label: fmtMult(h.value), tone: h.win ? 'win' : 'loss' }))} />
      <div className="relative flex flex-1 items-center justify-center">
        {[1, 2, 3].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full border-2"
            style={{ width: 140 + i * 110, height: 140 + i * 110, borderColor: color }}
            animate={{ opacity: state === 'idle' ? 0.05 : [0.35 / i, 0.06], scale: state === 'idle' ? 1 : [0.92, 1] }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        ))}
        <motion.div
          key={history[0]?.id ?? 0}
          initial={{ scale: state === 'idle' ? 1 : 0.9 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 14 }}
          className="relative"
        >
          <span ref={numRef} className="tnum block text-[clamp(56px,11vw,128px)] font-black leading-none tracking-tight transition-colors duration-200" style={{ color, textShadow: state === 'idle' ? '0 8px 40px rgba(0,0,0,.4)' : `0 0 50px ${color}55` }}>
            {fmtMult(shown)}
          </span>
        </motion.div>
      </div>
      <div className="grid grid-cols-2 gap-3 bg-panel2/60 p-3 sm:p-4">
        <NumberField label="Target multiplier" value={target} min={1.01} max={MAX} disabled={locked} onCommit={(v) => setTarget(round2(v))} suffix="×" />
        <NumberField label="Win chance" value={chance} digits={4} min={99 / MAX} max={98.0198} disabled={locked} onCommit={(c) => setTarget(Math.max(1.01, Math.floor((99 / c) * 100) / 100))} suffix="%" />
      </div>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}
