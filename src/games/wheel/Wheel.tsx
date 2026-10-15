import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, Segmented, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { PrizeWheel } from '../../art/PrizeWheel'
import { fmtMult, round2 } from '../../lib/format'
import { rand, randInt } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'
import { SEGMENT_COUNTS, segmentColor, wheelSegments, type SegmentCount, type WheelRisk } from './rules'

export default function Wheel() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [risk, setRisk] = useState<WheelRisk>('medium')
  const [count, setCount] = useState<SegmentCount>(30)
  const [mode, setMode] = useState<Mode>('manual')
  const [busy, setBusy] = useState(false)
  const [lit, setLit] = useState<number | null>(null)
  const [history, setHistory] = useState<{ id: number; mult: number }[]>([])
  const [hover, setHover] = useState<number | null>(null)
  const rot = useMotionValue(0)
  const lastTick = useRef(0)
  const [stageRef, size] = useSize<HTMLDivElement>()

  const segs = useMemo(() => wheelSegments(count, risk), [count, risk])
  const legend = useMemo(() => {
    const m = new Map<number, number>()
    for (const v of segs) m.set(v, (m.get(v) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [segs])

  const play = async (): Promise<number | null> => {
    if (!stake(bet)) return null
    setBusy(true)
    setLit(null)
    const n = segs.length
    const seg = 360 / n
    const idx = randInt(n)
    const mult = segs[idx]
    const cur = rot.get()
    const base = cur - (((cur % 360) + 360) % 360)
    const jitter = (rand() - 0.5) * seg * 0.7
    const target = base + 360 * 5 - idx * seg - jitter
    lastTick.current = Math.floor(cur / seg)
    await new Promise<void>((done) =>
      animate(rot, target, {
        duration: auto.running ? 2.2 : 3.2,
        ease: [0.12, 0.8, 0.22, 1],
        onUpdate: (v) => {
          const k = Math.floor((v + seg / 2) / seg)
          if (k !== lastTick.current) {
            lastTick.current = k
            sfx.tick()
          }
        },
        onComplete: done,
      }),
    )
    const payout = round2(bet * mult)
    settle({ game: 'wheel', bet, payout, meta: { risk, segments: n, mult } })
    setLit(idx)
    setHistory((h) => [{ id: Date.now(), mult }, ...h].slice(0, 12))
    if (mult > 0) (mult >= 10 ? sfx.bigWin : mult >= 1 ? sfx.win : sfx.coin)()
    else sfx.lose()
    setBusy(false)
    return payout - bet
  }

  const auto = useAutoBet(play, 600)
  const locked = busy || auto.running

  useEffect(() => setLit(null), [count, risk])

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
      <div>
        <Label>Risk</Label>
        <Segmented
          value={risk}
          onChange={setRisk}
          disabled={locked}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
        />
      </div>
      <div>
        <Label>Segments</Label>
        <Segmented value={count} onChange={setCount} disabled={locked} options={SEGMENT_COUNTS.map((c) => ({ value: c, label: c }))} />
      </div>
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

  const wheel = Math.max(220, Math.min(560, size.w - 40, size.h - 150))
  const total = segs.length

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_42%,#182f42_0%,#0a1620_70%)]">
      <HistoryPills className="justify-end px-4 pt-4" items={history.map((h) => ({ key: h.id, label: fmtMult(h.mult), tone: h.mult >= 10 ? 'gold' : h.mult >= 1 ? 'win' : 'loss' }))} />
      <div className="relative flex flex-1 items-center justify-center">
        <div className="relative" style={{ width: wheel, height: wheel }}>
          <div className="absolute inset-0 rounded-full shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)]" />
          <motion.div className="absolute inset-0" style={{ rotate: rot }}>
            <PrizeWheel segments={segs} size={wheel} lit={lit} />
          </motion.div>
          {/* pointer */}
          <svg className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[30%] drop-shadow-[0_6px_10px_rgba(0,0,0,.5)]" width={wheel * 0.09} height={wheel * 0.11} viewBox="0 0 40 48" aria-hidden>
            <path d="M20 46 4 10a16 16 0 1 1 32 0Z" fill={lit != null ? segmentColor(segs[lit]) : '#ffffff'} stroke="#0b1a26" strokeWidth="3" />
            <circle cx="20" cy="15" r="5" fill="#0b1a26" />
          </svg>
          <AnimatePresence>
            {lit != null && (
              <motion.div
                key={`m${history[0]?.id}`}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <span
                  className="tnum flex items-center justify-center rounded-full bg-[radial-gradient(circle_at_50%_35%,#1d3d55,#0b1a26)] font-black shadow-[0_10px_30px_-8px_rgba(0,0,0,.8)]"
                  style={{
                    width: wheel * 0.4,
                    height: wheel * 0.4,
                    fontSize: wheel * 0.085,
                    color: segmentColor(segs[lit]),
                    boxShadow: `0 0 0 3px ${segmentColor(segs[lit])}55, 0 0 40px -6px ${segmentColor(segs[lit])}88`,
                    textShadow: `0 0 24px ${segmentColor(segs[lit])}66`,
                  }}
                >
                  {fmtMult(segs[lit])}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5 bg-panel2/60 p-3">
        {legend.map(([m, c]) => (
          <div
            key={m}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(m)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
            // touch has no hover: a tap toggles the odds instead
            onPointerUp={(e) => e.pointerType !== 'mouse' && setHover((x) => (x === m ? null : m))}
            className={`tnum min-w-[76px] rounded-lg bg-raised px-3 py-2 text-center text-[13px] font-extrabold transition ${lit != null && segs[lit] === m ? 'ring-2 ring-white/70' : ''}`}
            style={{ boxShadow: `inset 0 -3px 0 ${segmentColor(m)}` }}
          >
            {hover === m ? `${((c / total) * 100).toFixed(1)}%` : fmtMult(m)}
          </div>
        ))}
      </div>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}
