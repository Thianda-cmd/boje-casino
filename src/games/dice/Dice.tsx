import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, NumberField, Stat, sleep, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'

/* Dice: roll 0.00 to 100.00. Pick a line and whether you need to roll over or under it.
   Payout is 99 / win chance, so the house keeps 1%. */

type Dir = 'over' | 'under'
const MIN_T = 2
const MAX_T = 98

const multFor = (chance: number) => Math.floor((99 / chance) * 10000) / 10000

export default function Dice() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(50.5)
  const [dir, setDir] = useState<Dir>('over')
  const [mode, setMode] = useState<Mode>('manual')
  const [busy, setBusy] = useState(false)
  const [roll, setRoll] = useState<{ id: number; value: number; win: boolean } | null>(null)
  const [history, setHistory] = useState<{ id: number; value: number; win: boolean }[]>([])
  const seq = useRef(0)

  const chance = dir === 'over' ? 100 - target : target
  const mult = multFor(chance)

  const play = async (): Promise<number | null> => {
    if (!stake(bet)) return null
    setBusy(true)
    const value = Math.floor(rand() * 10001) / 100
    const win = dir === 'over' ? value > target : value < target
    const payout = win ? round2(bet * mult) : 0
    const r = { id: ++seq.current, value, win }
    setRoll(r)
    sfx.tick()
    await sleep(380)
    settle({ game: 'dice', bet, payout, meta: { chance } })
    setHistory((h) => [r, ...h].slice(0, 12))
    if (win) (mult >= 10 ? sfx.bigWin : sfx.win)()
    else sfx.lose()
    setBusy(false)
    return payout - bet
  }

  const auto = useAutoBet(play, 200)
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

  const setChance = (c: number) => {
    const cc = Math.min(MAX_T, Math.max(MIN_T, c))
    setTarget(round2(dir === 'over' ? 100 - cc : cc))
  }
  const flip = () => {
    sfx.click()
    setDir((d) => (d === 'over' ? 'under' : 'over'))
    setTarget((t) => round2(100 - t))
  }

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={auto.running} />
      <BetInput value={bet} onChange={setBet} disabled={auto.running} />
      <Stat label={`Profit on win (${mult.toFixed(4)}×)`} value={fmt(bet * mult - bet)} tone="accent" />
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

  const stage = (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,#132a3a_0%,#0a1620_70%)]">
      <HistoryPills className="justify-end px-4 pt-4" items={history.map((h) => ({ key: h.id, label: h.value.toFixed(2), tone: h.win ? 'win' : 'loss' }))} />
      <div className="flex flex-1 items-center justify-center px-5 sm:px-10">
        <Slider target={target} dir={dir} roll={roll} disabled={locked} onChange={(t) => setTarget(t)} />
      </div>
      <div className="grid grid-cols-3 gap-2 bg-panel2/60 p-3 sm:gap-3 sm:p-4">
        <NumberField label="Multiplier" value={mult} digits={4} min={multFor(MAX_T)} max={multFor(MIN_T)} disabled={locked} onCommit={(m) => setChance(99 / m)} suffix="×" />
        <div className="min-w-0">
          <div className="mb-1.5 text-[12px] font-semibold text-muted">Roll {dir === 'over' ? 'over' : 'under'}</div>
          <button
            disabled={locked}
            onClick={flip}
            className="flex h-12 w-full items-center justify-between rounded-lg border-2 border-raised bg-stage px-3 text-[16px] font-bold transition hover:border-hover disabled:opacity-60"
          >
            <span className="tnum">{target.toFixed(2)}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
              <path d="M4 8h13l-3-3M20 16H7l3 3" />
            </svg>
          </button>
        </div>
        <NumberField label="Win chance" value={chance} digits={2} min={MIN_T} max={MAX_T} disabled={locked} onCommit={setChance} suffix="%" />
      </div>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}

/** The 0 to 100 bar: red where you lose, green where you win, a handle on the line and the roll marker above it. */
function Slider({ target, dir, roll, disabled, onChange }: { target: number; dir: Dir; roll: { id: number; value: number; win: boolean } | null; disabled: boolean; onChange: (t: number) => void }) {
  const [ref, size] = useSize<HTMLDivElement>({ w: 600, h: 40 })
  const dragging = useRef(false)
  const setFromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const pct = ((clientX - r.left) / r.width) * 100
    onChange(Math.round(Math.min(MAX_T, Math.max(MIN_T, pct)) * 100) / 100)
  }
  const pos = (v: number) => (v / 100) * size.w
  const lose = dir === 'over' ? '#ff4d61' : '#22d36f'
  const win = dir === 'over' ? '#22d36f' : '#ff4d61'

  return (
    <div className="w-full max-w-[820px]">
      <div className="rounded-full bg-raised p-3 shadow-[inset_0_2px_6px_rgba(0,0,0,.3),0_10px_30px_-10px_rgba(0,0,0,.6)] sm:p-4">
        <div
          ref={ref}
          className={`relative h-3 touch-none rounded-full ${disabled ? '' : 'cursor-pointer'}`}
          onPointerDown={(e) => {
            if (disabled) return
            dragging.current = true
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            setFromX(e.clientX)
          }}
          onPointerMove={(e) => dragging.current && setFromX(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
        >
          <div className="absolute inset-y-0 left-0 rounded-l-full transition-colors" style={{ width: `${target}%`, background: lose }} />
          <div className="absolute inset-y-0 right-0 rounded-r-full transition-colors" style={{ width: `${100 - target}%`, background: win }} />
          <div
            className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-[3px] rounded-lg bg-[linear-gradient(180deg,#6fc3ff,#2f8be6)] shadow-[0_6px_14px_-4px_rgba(0,0,0,.6),inset_0_1px_0_rgba(255,255,255,.4)]"
            style={{ left: pos(target) }}
          >
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-4 w-[3px] rounded-full bg-[#0d3c66]/60" />
            ))}
          </div>
          {roll && (
            <motion.div
              key="marker"
              className="pointer-events-none absolute bottom-[calc(100%+22px)] -translate-x-1/2"
              initial={false}
              animate={{ left: pos(roll.value) }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            >
              <motion.div
                key={roll.id}
                initial={{ scale: 0.7, y: 6 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                className="relative"
              >
                <svg width="74" height="62" viewBox="0 0 74 62" className="drop-shadow-[0_8px_14px_rgba(0,0,0,.5)]">
                  <path d="M20 3h34l17 25-17 25H20L3 28Z" fill="#fff" />
                  <path d="M33 53h8l-4 7Z" fill="#fff" />
                </svg>
                <span className={`tnum absolute inset-x-0 top-[18px] text-center text-[16px] font-black ${roll.win ? 'text-[#12a356]' : 'text-[#e8344e]'}`}>{roll.value.toFixed(2)}</span>
              </motion.div>
            </motion.div>
          )}
        </div>
      </div>
      <div className="relative mx-3 mt-3 h-5 text-[13px] font-bold text-muted sm:mx-4">
        {[0, 25, 50, 75, 100].map((v) => (
          <span key={v} className="tnum absolute -translate-x-1/2" style={{ left: `${v}%` }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  )
}
