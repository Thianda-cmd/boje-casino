import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, GameShell, HistoryPills, Label, WinPopup, useStake } from '../../components/ui'
import { Coin } from '../../components/icons'
import { Chip, chipLabel } from '../../art/Chip'
import { Ball, RouletteWheel, pocketAngle } from '../../art/RouletteWheel'
import { fmt, round2 } from '../../lib/format'
import { rand, randInt } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { MAX_BET, useWallet } from '../../store/wallet'
import { POCKET_COLORS, RED, betNumbers, betPayout, colorOf, type BetKey } from './rules'

/* European roulette. Place chips on the board, spin, and every bet covering the winning number pays. */

const CHIPS = [1, 5, 10, 25, 100, 500, 1000]
const SPIN_MS = 4800
const TRACK_R = 91 // wheel units (the wheel is 200 units across)
const POCKET_R = 66

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export default function Roulette() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [chip, setChip] = useState(10)
  const [bets, setBets] = useState<Record<BetKey, number>>({})
  const [undo, setUndo] = useState<{ key: BetKey; amount: number }[]>([])
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<number | null>(null)
  const [history, setHistory] = useState<{ id: number; n: number }[]>([])
  const [win, setWin] = useState<{ mult: number; amount: number; id: number } | null>(null)
  const [hoverKey, setHoverKey] = useState<BetKey | null>(null)
  const [stageRef, size] = useSize<HTMLDivElement>()

  const total = round2(Object.values(bets).reduce((a, b) => a + b, 0))

  const place = (key: BetKey) => {
    if (spinning) return
    if (total + chip > MAX_BET) return
    sfx.click()
    setWin(null)
    setBets((b) => ({ ...b, [key]: round2((b[key] ?? 0) + chip) }))
    setUndo((u) => [...u, { key, amount: chip }])
  }
  const undoLast = () => {
    if (spinning || !undo.length) return
    const last = undo[undo.length - 1]
    setUndo((u) => u.slice(0, -1))
    setBets((b) => {
      const v = round2((b[last.key] ?? 0) - last.amount)
      const next = { ...b }
      if (v > 0) next[last.key] = v
      else delete next[last.key]
      return next
    })
  }
  const clear = () => {
    if (spinning) return
    setBets({})
    setUndo([])
  }
  const double = () => {
    if (spinning || !total || total * 2 > MAX_BET) return
    sfx.click()
    setBets((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, round2(v * 2)])))
    setUndo((u) => [...u, ...Object.entries(bets).map(([key, amount]) => ({ key, amount }))])
  }

  /* ---------------- wheel and ball animation ---------------- */

  const wheelRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const anim = useRef({ w: 0, a: -90, r: TRACK_R, pocket: null as number | null, spin: null as null | { t0: number; w0: number; dw: number; a0: number; da: number; n: number; resolve: () => void } })
  // phones get a tall vertical board, and the wheel rises over it while it spins
  const phone = size.w < 560
  const [wheelUp, setWheelUp] = useState(false)
  const wheelTimer = useRef(0)
  useEffect(() => () => clearTimeout(wheelTimer.current), [])
  // on wider screens the board needs about 290px under the wheel
  const wheelPx = Math.round(phone ? Math.max(150, Math.min(340, size.w * 0.8, size.h * 0.62)) : Math.max(150, Math.min(380, size.w * (size.w < 640 ? 0.6 : 0.42), size.h - 290)))

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const k = wheelPx / 200
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = anim.current
      if (s.spin) {
        const t = Math.min(1, (now - s.spin.t0) / SPIN_MS)
        s.w = s.spin.w0 + s.spin.dw * easeOut(t)
        const DROP = 0.74
        if (t < DROP) {
          s.a = s.spin.a0 - s.spin.da * easeOut(t / DROP)
          s.r = t < 0.6 ? TRACK_R : TRACK_R - (TRACK_R - 74) * ((t - 0.6) / (DROP - 0.6))
        } else {
          s.a = pocketAngle(s.spin.n) + s.w
          const u = (t - DROP) / (1 - DROP)
          s.r = POCKET_R + (74 - POCKET_R) * (1 - Math.min(1, u * 1.6)) + Math.abs(Math.sin(u * Math.PI * 3)) * 3 * (1 - u)
        }
        if (t >= 1) {
          const done = s.spin.resolve
          s.pocket = s.spin.n
          s.r = POCKET_R
          s.spin = null
          done()
        }
      } else {
        s.w += 7 * dt
        if (s.pocket != null) s.a = pocketAngle(s.pocket) + s.w
      }
      if (wheelRef.current) wheelRef.current.style.transform = `rotate(${s.w}deg)`
      if (ballRef.current) {
        const rad = (s.a * Math.PI) / 180
        ballRef.current.style.transform = `translate(${Math.cos(rad) * s.r * k}px, ${Math.sin(rad) * s.r * k}px)`
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [wheelPx])

  const spin = async () => {
    if (spinning || !total) return
    if (!stake(total)) return
    const placed = { ...bets }
    setSpinning(true)
    setResult(null)
    setWin(null)
    clearTimeout(wheelTimer.current)
    setWheelUp(true)
    const n = randInt(37)
    const s = anim.current
    const dw = 400 + rand() * 120
    const wAtDrop = s.w + dw * easeOut(0.74)
    const target = pocketAngle(n) + wAtDrop
    const da = ((((s.a - target) % 360) + 360) % 360) + 720
    await new Promise<void>((resolve) => {
      s.spin = { t0: performance.now(), w0: s.w, dw, a0: s.a, da, n, resolve }
    })
    let payout = 0
    for (const [key, amount] of Object.entries(placed)) if (betNumbers(key).includes(n)) payout += amount * betPayout(key)
    payout = round2(payout)
    settle({ game: 'roulette', bet: total, payout, meta: { number: n, straight: Object.keys(placed).some((k) => k === `n${n}`) } })
    setResult(n)
    setHistory((h) => [{ id: Date.now(), n }, ...h].slice(0, 14))
    if (payout > total) {
      setWin({ mult: payout / total, amount: payout, id: Date.now() })
      ;(payout / total >= 10 ? sfx.bigWin : sfx.win)()
    } else if (payout > 0) sfx.coin()
    else sfx.lose()
    setSpinning(false)
    wheelTimer.current = window.setTimeout(() => setWheelUp(false), 1800)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        void spin()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') undoLast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const panel = (
    <>
      <div className={phone ? 'hidden' : ''}>
        <Label right={<>{fmt(balance)}</>}>Chip value</Label>
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-stage p-2">
          {CHIPS.map((v) => (
            <button
              key={v}
              disabled={spinning}
              onClick={() => (sfx.click(), setChip(v))}
              className={`flex items-center justify-center rounded-lg py-1.5 transition ${chip === v ? 'bg-hover ring-2 ring-accent' : 'hover:bg-raised'} disabled:opacity-50`}
              aria-label={`${v} coin chip`}
            >
              <motion.span animate={{ y: chip === v ? -2 : 0 }}>
                <Chip value={v} size={38} />
              </motion.span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-3">
        <span className="text-[12px] font-semibold text-muted">Total bet</span>
        <span className="tnum flex items-center gap-1.5 text-[16px] font-extrabold">
          {fmt(total)} <Coin size={16} />
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ActionButton tone="neutral" onClick={undoLast} disabled={spinning || !undo.length}>
          Undo
        </ActionButton>
        <ActionButton tone="neutral" onClick={double} disabled={spinning || !total}>
          2×
        </ActionButton>
        <ActionButton tone="neutral" onClick={clear} disabled={spinning || !total}>
          Clear
        </ActionButton>
      </div>
      <div className={`max-lg:order-first lg:mt-auto ${phone ? 'hidden' : ''}`}>
        <ActionButton onClick={spin} disabled={spinning || !total || balance < total} sub={!total ? 'Place chips on the board' : undefined}>
          {spinning ? 'Spinning…' : 'Spin'}
        </ActionButton>
      </div>
    </>
  )

  const highlight = useMemo(() => new Set(hoverKey ? betNumbers(hoverKey) : []), [hoverKey])

  const wheel = (
    <div className="relative" style={{ width: wheelPx, height: wheelPx }}>
      <div className="absolute inset-0 rounded-full shadow-[0_30px_70px_-20px_rgba(0,0,0,.9)]" />
      <div ref={wheelRef} className="absolute inset-0 will-change-transform">
        <RouletteWheel size={wheelPx} />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0">
        <div ref={ballRef} className="absolute will-change-transform">
          <div className="-translate-x-1/2 -translate-y-1/2">
            <Ball r={Math.max(4, wheelPx * 0.022)} />
          </div>
        </div>
      </div>
      <AnimatePresence>
        {result != null && !spinning && (
          <motion.div
            key={history[0]?.id}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
            className="tnum absolute left-1/2 top-1/2 flex h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white/80 text-[clamp(18px,3vw,30px)] font-black text-white shadow-[0_8px_24px_rgba(0,0,0,.6)]"
            style={{ background: POCKET_COLORS[colorOf(result)] }}
          >
            {result}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  const board = (vertical: boolean) => (
    <Board bets={bets} onPlace={place} onHover={setHoverKey} highlight={highlight} result={spinning ? null : result} disabled={spinning} vertical={vertical} />
  )

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_25%,#1a3a2e_0%,#0d1f1c_45%,#0a1620_100%)]">
      <HistoryPills
        className="min-h-9 justify-end px-3 pt-3 sm:min-h-10 sm:px-4 sm:pt-4"
        items={history.map((h) => ({ key: h.id, label: h.n, tone: 'neutral', style: { background: POCKET_COLORS[colorOf(h.n)], color: '#fff', minWidth: 34, textAlign: 'center' } }))}
      />
      {phone ? (
        <>
          <div className="min-h-0 flex-1 px-3 pt-2">{board(true)}</div>
          <div className="flex items-center gap-2 px-3 pb-3 pt-2">
            <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-lg bg-black/25 p-1">
              {CHIPS.map((v) => (
                <button
                  key={v}
                  disabled={spinning}
                  onClick={() => (sfx.click(), setChip(v))}
                  aria-label={`${v} coin chip`}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition ${chip === v ? 'bg-white/15 ring-2 ring-accent' : ''} disabled:opacity-50`}
                >
                  <Chip value={v} size={30} />
                </button>
              ))}
            </div>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={spin}
              disabled={spinning || !total || balance < total}
              className="h-12 w-[92px] shrink-0 rounded-lg bg-accent text-[16px] font-extrabold text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16)] disabled:opacity-45"
            >
              {spinning ? '…' : 'Spin'}
            </motion.button>
          </div>
          <motion.div
            className="absolute inset-0 z-20 flex items-center justify-center bg-[#06100d]/70 backdrop-blur-[2px]"
            initial={false}
            animate={{ opacity: wheelUp ? 1 : 0 }}
            transition={{ duration: 0.25 }}
            style={{ pointerEvents: wheelUp ? 'auto' : 'none' }}
            onClick={() => !spinning && setWheelUp(false)}
          >
            <motion.div initial={false} animate={{ scale: wheelUp ? 1 : 0.85 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
              {wheel}
            </motion.div>
          </motion.div>
        </>
      ) : (
        <>
          <div className="flex flex-1 items-center justify-center py-2">{wheel}</div>
          <div className="no-scrollbar overflow-x-auto px-3 pb-3 sm:px-5 sm:pb-5">{board(false)}</div>
        </>
      )}
      <AnimatePresence>{win && <WinPopup key={win.id} mult={win.mult} amount={win.amount} />}</AnimatePresence>
    </div>
  )

  return <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[min(80vh,660px)]" />
}

function Board({
  bets,
  onPlace,
  onHover,
  highlight,
  result,
  disabled,
  vertical,
}: {
  bets: Record<BetKey, number>
  onPlace: (k: BetKey) => void
  onHover: (k: BetKey | null) => void
  highlight: Set<number>
  result: number | null
  disabled: boolean
  vertical?: boolean
}) {
  const cell = (key: BetKey, label: ReactNode, cls: string, style: React.CSSProperties, n?: number) => {
    const amount = bets[key]
    const lit = n != null && highlight.has(n)
    const won = result != null && betNumbers(key).includes(result)
    return (
      <button
        key={key}
        disabled={disabled}
        onClick={() => onPlace(key)}
        onPointerEnter={() => onHover(key)}
        onPointerLeave={() => onHover(null)}
        style={style}
        className={`relative flex items-center justify-center rounded-md text-[13px] font-extrabold text-white transition sm:text-[15px] ${cls} ${lit ? 'brightness-125 ring-2 ring-white/60' : ''} ${
          n != null && result === n ? 'z-10 ring-[3px] ring-gold shadow-[0_0_24px_rgba(247,197,72,.6)]' : ''
        } ${!disabled ? 'hover:brightness-125' : ''}`}
      >
        <span className="tnum">{label}</span>
        <AnimatePresence>
          {amount != null && (
            <motion.span
              key="chip"
              initial={{ scale: 0.3, y: -16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 22 }}
              className={`absolute inset-0 m-auto flex h-fit w-fit ${won ? 'drop-shadow-[0_0_8px_rgba(247,197,72,.9)]' : ''}`}
            >
              <Chip value={amount} size={vertical ? 24 : 30} label={chipLabel(amount)} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    )
  }
  const numColor = (n: number) => (RED.has(n) ? 'bg-[#d42a43]' : 'bg-[#1f2c3a]')
  const outside = 'bg-white/[.06] ring-1 ring-inset ring-white/10'
  const diamond = (cls: string) => <span className={`block h-3.5 w-3.5 rotate-45 rounded-sm ${cls}`} />
  if (vertical) {
    // phone layout: zero on top, three number columns running down, outside bets along the left
    const side = '[writing-mode:vertical-rl] rotate-180 text-[12px]'
    return (
      <div className="grid h-full w-full gap-[3px]" style={{ gridTemplateColumns: '0.62fr 0.62fr repeat(3, 1fr)', gridTemplateRows: 'repeat(14, minmax(0, 1fr))' }}>
        {cell('n0', '0', 'bg-[#13a85a]', { gridColumn: '3 / span 3', gridRow: '1' }, 0)}
        {Array.from({ length: 36 }, (_, i) => {
          const n = i + 1
          return cell(`n${n}`, n, numColor(n), { gridColumn: `${(i % 3) + 3}`, gridRow: `${Math.floor(i / 3) + 2}` }, n)
        })}
        {(['c1', 'c2', 'c3'] as const).map((k, i) => cell(k, '2:1', outside, { gridColumn: `${i + 3}`, gridRow: '14' }))}
        {(['d1', 'd2', 'd3'] as const).map((k, i) => cell(k, <span className={side}>{['1st 12', '2nd 12', '3rd 12'][i]}</span>, outside, { gridColumn: '1', gridRow: `${2 + i * 4} / span 4` }))}
        {(
          [
            ['low', <span className={side}>1 to 18</span>, outside],
            ['even', <span className={side}>Even</span>, outside],
            ['red', diamond('bg-white/85'), 'bg-[#d42a43]'],
            ['black', diamond('bg-white/85'), 'bg-[#1f2c3a]'],
            ['odd', <span className={side}>Odd</span>, outside],
            ['high', <span className={side}>19 to 36</span>, outside],
          ] as const
        ).map(([k, label, cls], i) => cell(k, label, cls, { gridColumn: '2', gridRow: `${2 + i * 2} / span 2` }))}
      </div>
    )
  }
  return (
    <div className="mx-auto grid min-w-[620px] max-w-[980px] gap-1" style={{ gridTemplateColumns: '1.1fr repeat(12, 1fr) 1.1fr', gridTemplateRows: 'repeat(3, minmax(40px, 52px)) repeat(2, minmax(36px, 44px))' }}>
      {cell('n0', '0', 'bg-[#13a85a]', { gridColumn: '1', gridRow: '1 / span 3' }, 0)}
      {Array.from({ length: 12 }, (_, c) =>
        [0, 1, 2].map((r) => {
          const n = 3 * (c + 1) - r
          return cell(`n${n}`, n, numColor(n), { gridColumn: `${c + 2}`, gridRow: `${r + 1}` }, n)
        }),
      )}
      {(['c3', 'c2', 'c1'] as const).map((k, r) => cell(k, '2:1', outside, { gridColumn: '14', gridRow: `${r + 1}` }))}
      {(['d1', 'd2', 'd3'] as const).map((k, i) => cell(k, ['1 to 12', '13 to 24', '25 to 36'][i], outside, { gridColumn: `${2 + i * 4} / span 4`, gridRow: '4' }))}
      {(
        [
          ['low', '1 to 18', outside],
          ['even', 'Even', outside],
          ['red', '', 'bg-[#d42a43]'],
          ['black', '', 'bg-[#1f2c3a]'],
          ['odd', 'Odd', outside],
          ['high', '19 to 36', outside],
        ] as const
      ).map(([k, label, cls], i) => cell(k, label || <span className="block h-4 w-4 rotate-45 rounded-sm bg-white/85" />, cls, { gridColumn: `${2 + i * 2} / span 2`, gridRow: '5' }))}
    </div>
  )
}
