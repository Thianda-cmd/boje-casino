import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Label, Segmented, WinPopup, sleep, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Gem } from '../../art/Gem'
import { round2 } from '../../lib/format'
import { shuffle } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'
import { KENO, hitChance, type KenoRisk } from './tables'

/* Keno: pick 1 to 10 of 40 numbers, ten are drawn, the pay table pays on how many you hit. */

const N = 40
const MAX_PICKS = 10

export default function Keno() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [risk, setRisk] = useState<KenoRisk>('classic')
  const [mode, setMode] = useState<Mode>('manual')
  const [picks, setPicks] = useState<Set<number>>(new Set())
  const [drawn, setDrawn] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [win, setWin] = useState<{ mult: number; amount: number; id: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [stageRef, size] = useSize<HTMLDivElement>()

  const hits = drawn.filter((n) => picks.has(n)).length
  const table = KENO[risk][picks.size] ?? []

  const toggle = (n: number) => {
    if (busy) return
    setDrawn([])
    setWin(null)
    const p = new Set(picks)
    if (p.has(n)) p.delete(n)
    else if (p.size < MAX_PICKS) p.add(n)
    else return
    sfx.click()
    setPicks(p)
  }
  const autoPick = () => {
    if (busy) return
    sfx.click()
    setDrawn([])
    setWin(null)
    setPicks(new Set(shuffle(Array.from({ length: N }, (_, i) => i + 1)).slice(0, MAX_PICKS)))
  }
  const clear = () => {
    if (busy) return
    setDrawn([])
    setWin(null)
    setPicks(new Set())
  }

  const play = async (): Promise<number | null> => {
    if (!picks.size) return null
    if (!stake(bet)) return null
    setBusy(true)
    setWin(null)
    setDrawn([])
    const draw = shuffle(Array.from({ length: N }, (_, i) => i + 1)).slice(0, 10)
    const out: number[] = []
    for (const n of draw) {
      await sleep(110)
      out.push(n)
      setDrawn([...out])
      if (picks.has(n)) sfx.gem()
      else sfx.tick()
    }
    const h = draw.filter((n) => picks.has(n)).length
    const mult = KENO[risk][picks.size][h] ?? 0
    const payout = round2(bet * mult)
    settle({ game: 'keno', bet, payout, meta: { picks: picks.size, hits: h, risk } })
    if (payout > 0) {
      setWin({ mult, amount: payout, id: Date.now() })
      ;(mult >= 10 ? sfx.bigWin : sfx.win)()
    } else sfx.lose()
    await sleep(150)
    setBusy(false)
    return payout - bet
  }

  const auto = useAutoBet(play, 700)
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
      <div>
        <Label>Risk</Label>
        <Segmented
          value={risk}
          onChange={setRisk}
          disabled={locked}
          options={[
            { value: 'classic', label: 'Classic' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Med' },
            { value: 'high', label: 'High' },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ActionButton tone="neutral" onClick={autoPick} disabled={locked}>
          Auto pick
        </ActionButton>
        <ActionButton tone="neutral" onClick={clear} disabled={locked || !picks.size}>
          Clear
        </ActionButton>
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div className="max-lg:order-first lg:mt-auto">
        {mode === 'manual' ? (
          <ActionButton onClick={play} disabled={busy || !picks.size || balance < bet} sub={!picks.size ? 'Pick 1 to 10 numbers' : undefined}>
            Bet
          </ActionButton>
        ) : auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop}>
            Stop autobet
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={!picks.size || balance < bet} sub={!picks.size ? 'Pick 1 to 10 numbers' : undefined}>
            Start autobet
          </ActionButton>
        )}
      </div>
    </>
  )

  // phones get five wide columns so each number is a comfortable tap target
  const cols = size.w < 480 ? 5 : 8
  const rows = Math.ceil(N / cols)
  const tile = Math.max(30, Math.min(86, Math.floor(Math.min((size.w - 40) / (cols + (cols - 1) * 0.14), (size.h - 150) / (rows + (rows - 1) * 0.14)))))
  const gap = Math.round(tile * 0.14)
  const lip = Math.max(3, Math.round(tile * 0.06))
  const drawnSet = new Set(drawn)

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,#162a3c_0%,#0a1620_72%)] px-3">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, ${tile}px)`, gap }}>
        {Array.from({ length: N }, (_, i) => {
          const n = i + 1
          const picked = picks.has(n)
          const isDrawn = drawnSet.has(n)
          const hit = picked && isDrawn
          const miss = isDrawn && !picked
          const sunk = hit || miss
          return (
            <motion.button
              key={n}
              disabled={locked}
              onClick={() => toggle(n)}
              whileHover={!locked && !sunk ? { y: -2 } : undefined}
              whileTap={!locked ? { y: lip - 1 } : undefined}
              className={`group relative ${locked ? 'cursor-default' : 'cursor-pointer'}`}
              style={{ width: tile, height: tile }}
            >
              <div
                className={`absolute inset-0 rounded-[22%] transition-colors duration-150 ${
                  hit
                    ? 'bg-[#0b1d2a]'
                    : miss
                      ? 'bg-[#0b1820]'
                      : picked
                        ? 'bg-[linear-gradient(180deg,#b388ff,#8a55f5)]'
                        : 'bg-[linear-gradient(180deg,#34536a,#2a465b)] group-hover:bg-[linear-gradient(180deg,#406580,#33546c)]'
                }`}
                style={{
                  boxShadow: sunk ? 'inset 0 3px 8px rgba(0,0,0,.45)' : `0 ${lip}px 0 ${picked ? '#5a2bb8' : '#1a3040'}, 0 ${lip + 5}px 12px -6px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.14)`,
                }}
              />
              {hit && (
                <motion.div className="absolute inset-0 flex items-center justify-center" initial={{ scale: 0.3 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}>
                  <Gem size={tile * 0.78} tone="violet" />
                  <motion.div
                    className="pointer-events-none absolute inset-0 rounded-[22%]"
                    style={{ boxShadow: '0 0 0 3px #b388ff, 0 0 22px 4px rgba(179,136,255,.6)' }}
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0.25 }}
                    transition={{ duration: 0.6 }}
                  />
                </motion.div>
              )}
              <span
                className={`tnum relative text-[clamp(12px,1.6vw,18px)] font-extrabold ${hit ? 'text-white [text-shadow:0_2px_4px_rgba(0,0,0,.7)]' : miss ? 'text-danger' : picked ? 'text-white' : 'text-ink/85'}`}
              >
                {n}
              </span>
            </motion.button>
          )
        })}
      </div>

      {/* pay table for the current number of picks; the row lights up as hits come in */}
      <div className="w-full max-w-[720px]">
        {picks.size ? (
          <div className="flex flex-col gap-1.5">
            <div className="grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${table.length}, minmax(0, 1fr))` }}>
              {table.map((m, h) => (
                <div
                  key={h}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(h)}
                  onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
                  // touch has no hover: a tap toggles the odds instead
                  onPointerUp={(e) => e.pointerType !== 'mouse' && setHover((x) => (x === h ? null : h))}
                  className={`tnum rounded-md py-2 text-center text-[10px] font-extrabold transition-colors sm:text-[12px] ${drawn.length === 10 && h === hits ? (m > 0 ? 'bg-accent text-[#032412]' : 'bg-danger text-white') : drawn.length && h === hits ? 'bg-hover text-ink' : 'bg-raised text-muted'}`}
                >
                  {payLabel(m)}
                </div>
              ))}
            </div>
            <div className="grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${table.length}, minmax(0, 1fr))` }}>
              {table.map((_, h) => (
                <div key={h} className="tnum text-center text-[11px] font-bold text-dim">
                  {hover === h ? (
                    `${(hitChance(picks.size, h) * 100).toFixed(2)}%`
                  ) : (
                    <>
                      {h}
                      <span className="max-sm:hidden"> {h === 1 ? 'hit' : 'hits'}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-panel2/70 py-3 text-center text-[13px] font-semibold text-muted">Select 1 to 10 numbers to play</div>
        )}
      </div>

      <AnimatePresence>{win && <WinPopup key={win.id} mult={win.mult} amount={win.amount} />}</AnimatePresence>
    </div>
  )

  return <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[min(72vh,620px)]" />
}

/** Short pay-table labels so eleven columns fit on a phone: 0×, 1.4×, 2.25×, 17×, 100×. */
function payLabel(m: number) {
  if (m >= 10) return `${Math.round(m)}×`
  return `${+m.toFixed(2)}×`
}
