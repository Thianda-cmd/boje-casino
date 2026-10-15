import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Label, Stat, WinPopup, useStake } from '../../components/ui'
import { Gem } from '../../art/Gem'
import { Bomb } from '../../art/Bomb'
import { IconShuffle } from '../../components/icons'
import { fmt, fmtMult, round2 } from '../../lib/format'
import { rand, randInt, shuffle } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'

const TILES = 25
const RTP = 0.97

/** Fair multiplier after `k` safe picks with `m` mines, minus the house edge. */
export function minesMult(m: number, k: number) {
  if (k === 0) return 1
  let p = 1
  for (let i = 0; i < k; i++) p *= (TILES - m - i) / (TILES - i)
  return Math.floor((RTP / p) * 100) / 100
}

type Phase = 'idle' | 'playing' | 'lost' | 'cashed'

export default function Mines() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)

  const [bet, setBet] = useState(10)
  const [mines, setMines] = useState(3)
  const [phase, setPhase] = useState<Phase>('idle')
  const [board, setBoard] = useState<boolean[]>(() => Array(TILES).fill(false)) // true = mine
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [hitAt, setHitAt] = useState<number | null>(null)
  const [roundBet, setRoundBet] = useState(0)
  const [win, setWin] = useState<{ mult: number; amount: number } | null>(null)
  const [shake, setShake] = useState(false)
  const [stageRef, size] = useSize<HTMLDivElement>()

  const gems = revealed.size
  const cur = minesMult(mines, gems)
  const next = minesMult(mines, gems + 1)
  const playing = phase === 'playing'
  const over = phase === 'lost' || phase === 'cashed'

  const start = () => {
    if (!stake(bet)) return
    setBoard(shuffle(Array.from({ length: TILES }, (_, i) => i < mines)))
    setRevealed(new Set())
    setHitAt(null)
    setWin(null)
    setRoundBet(bet)
    setPhase('playing')
  }

  const pick = (i: number) => {
    if (!playing || revealed.has(i)) return
    const r = new Set(revealed)
    r.add(i)
    setRevealed(r)
    if (board[i]) {
      setHitAt(i)
      setPhase('lost')
      setShake(true)
      setTimeout(() => setShake(false), 450)
      sfx.lose()
      settle({ game: 'mines', bet: roundBet, payout: 0, meta: { mines, gems: r.size - 1 } })
    } else {
      sfx.gem()
      if (r.size === TILES - mines) cashOut(r)
    }
  }

  const cashOut = (r = revealed) => {
    if (r.size === 0) return
    const mult = minesMult(mines, r.size)
    const amount = round2(roundBet * mult)
    setPhase('cashed')
    setWin({ mult, amount })
    settle({ game: 'mines', bet: roundBet, payout: amount, meta: { mines, gems: r.size } })
    ;(mult >= 10 ? sfx.bigWin : sfx.win)()
  }

  const pickRandom = () => {
    const free = Array.from({ length: TILES }, (_, i) => i).filter((i) => !revealed.has(i))
    if (free.length) pick(free[randInt(free.length)])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        if (playing) {
          if (gems) cashOut()
        } else start()
      } else if (e.key.toLowerCase() === 'r' && playing) pickRandom()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const panel = (
    <>
      <BetInput value={bet} onChange={setBet} disabled={playing} />
      <div>
        <Label right={`${TILES - mines} gems`}>Mines</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 3, 5, 10, 24].map((n) => (
            <button
              key={n}
              disabled={playing}
              onClick={() => (sfx.click(), setMines(n))}
              className={`h-10 rounded-lg text-[13px] font-bold transition disabled:opacity-50 ${mines === n ? 'bg-hover text-ink shadow-[inset_0_0_0_2px_rgba(34,211,111,.6)]' : 'bg-raised text-muted hover:text-ink'}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="relative mt-2">
          <select
            disabled={playing}
            value={mines}
            onChange={(e) => setMines(Number(e.target.value))}
            className="h-12 w-full appearance-none rounded-lg border-2 border-raised bg-stage px-3 text-[15px] font-bold outline-none transition hover:border-hover disabled:opacity-50"
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'mine' : 'mines'}
              </option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Next tile" value={playing && gems < TILES - mines ? fmtMult(next) : fmtMult(minesMult(mines, 1))} />
        <Stat label="Profit" value={fmt(playing ? roundBet * cur - roundBet : 0)} tone="accent" />
      </div>

      <div className="flex flex-col gap-2 max-lg:order-first lg:mt-auto">
        {playing ? (
          <>
            <ActionButton tone="gold" onClick={() => cashOut()} disabled={!gems} sub={gems ? `${fmt(roundBet * cur)} coins` : 'Find a gem first'}>
              Cash out {gems ? fmtMult(cur) : ''}
            </ActionButton>
            <ActionButton tone="neutral" onClick={pickRandom}>
              <IconShuffle size={18} /> Random tile
            </ActionButton>
          </>
        ) : (
          <ActionButton onClick={start}>Bet</ActionButton>
        )}
      </div>
    </>
  )

  const tile = Math.max(44, Math.min(118, Math.floor(Math.min(size.w - 40, size.h - 40) / 5.55)))
  const gap = Math.round(tile * 0.13)
  const radius = Math.round(tile * 0.14)
  const lip = Math.max(4, Math.round(tile * 0.07))

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#132a3a_0%,#0a1620_70%)]">
      <div className={`relative grid grid-cols-5 ${shake ? 'shake' : ''}`} style={{ gap }}>
        {board.map((isMine, i) => {
          const open = revealed.has(i)
          const ghost = over && !open // show what was under the rest once the round ends
          const live = playing && !open
          return (
            <motion.button
              key={i}
              disabled={!live}
              onClick={() => pick(i)}
              whileHover={live ? { y: -3 } : undefined}
              whileTap={live ? { y: lip - 1 } : undefined}
              transition={{ type: 'spring', stiffness: 700, damping: 30 }}
              className={`group relative ${live ? 'cursor-pointer' : 'cursor-default'}`}
              style={{ width: tile, height: tile }}
              aria-label={`Tile ${i + 1}`}
            >
              <div
                className={`absolute inset-0 transition-colors duration-150 ${
                  open || ghost
                    ? open && isMine
                      ? 'bg-[#3b1522]'
                      : 'bg-[#071520]'
                    : 'bg-[linear-gradient(180deg,#34536a,#2a465b)] group-hover:bg-[linear-gradient(180deg,#406580,#33546c)]'
                } ${!playing && !over ? 'opacity-90' : ''}`}
                style={{
                  borderRadius: radius,
                  boxShadow: open || ghost ? 'inset 0 3px 8px rgba(0,0,0,.45)' : `0 ${lip}px 0 #1a3040, 0 ${lip + 6}px 14px -6px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.1)`,
                }}
              />
              <AnimatePresence>
                {(open || ghost) && (
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: ghost ? 0.72 : 1, opacity: ghost ? 0.35 : 1 }}
                    transition={{ type: 'spring', stiffness: 460, damping: 17, delay: ghost ? 0.25 + ((i % 5) + Math.floor(i / 5)) * 0.03 : 0 }}
                  >
                    {isMine ? <Bomb size={tile * 0.7} lit={!ghost} /> : <Gem size={tile * 0.66} glow={!ghost} />}
                  </motion.div>
                )}
              </AnimatePresence>
              {open && !isMine && (
                <motion.div
                  className="pointer-events-none absolute inset-0"
                  style={{ borderRadius: radius, boxShadow: '0 0 0 3px #4fe394, 0 0 24px 4px rgba(79,227,148,.55)' }}
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.55 }}
                />
              )}
              {hitAt === i && <Blast size={tile} />}
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence>{win && <WinPopup mult={win.mult} amount={win.amount} />}</AnimatePresence>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}

/** A flash, a shock ring and sparks flying out of the tile that held the mine. */
function Blast({ size }: { size: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2 + rand() * 0.4
        const d = size * (0.5 + rand() * 0.6)
        return { x: Math.cos(a) * d, y: Math.sin(a) * d, s: 4 + rand() * 6, c: ['#fff3b0', '#ffb02e', '#ff5a3c', '#ff5a3c'][Math.floor(rand() * 4)] }
      }),
    [size],
  )
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <motion.div
        className="absolute rounded-full"
        style={{ width: size * 0.9, height: size * 0.9, background: 'radial-gradient(circle, #fff6c9 0%, #ffb02e 35%, #ff4d3d 60%, rgba(255,77,61,0) 72%)' }}
        initial={{ scale: 0.3, opacity: 1 }}
        animate={{ scale: 2.1, opacity: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
      <motion.div
        className="absolute rounded-full border-4 border-[#ffb02e]"
        style={{ width: size, height: size }}
        initial={{ scale: 0.4, opacity: 0.9 }}
        animate={{ scale: 2.4, opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      {parts.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{ width: p.s, height: p.s, background: p.c, boxShadow: `0 0 8px ${p.c}` }}
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{ x: p.x, y: [0, p.y, p.y + size * 0.4], opacity: [1, 1, 0] }}
          transition={{ duration: 0.85, ease: 'easeOut', times: [0, 0.45, 1] }}
        />
      ))}
    </div>
  )
}
