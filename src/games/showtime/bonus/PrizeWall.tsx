import { useEffect, useMemo, useRef, useState } from 'react'
import { useSize } from '../../../lib/useSize'
import { motion } from 'framer-motion'
import { MAX_WIN, WALL_TILES, type PrizeWall as PrizeWallRound } from '../rules'
import { fmtX } from '../words'
import { showtimeSfx } from '../sound'
import { BonusShell, CountdownPill, ResultPlate, shownX, useCountdown } from './kit'

/*
  Prize Wall: sixty prizes hidden behind the tiles of a wall. The player has a few seconds to pick one (or one is
  picked for them); it is shot, turns over, and then the whole wall turns over to show what else was there.

  The prize the pick turns up was drawn with the round (rules.ts: `hit`). Whatever tile is picked, that prize is put
  behind it, and the prize that was there goes where the drawn one was; every tile hides a prize from the same
  shuffled sixty, so the pick is as good as any.
*/

const PICK_SECS = 10
const ICONS = ['★', '♦', '♥', '♣', '♠', '●']
const TILE_COLORS = ['#ff5fa2', '#22c7d8', '#f7c548', '#9b7bff', '#ff8a3d', '#2ee87f']

type Step = 'intro' | 'pick' | 'shot' | 'wall' | 'done'

export function PrizeWallShow({ round, boost, stake, win, onDone }: { round: PrizeWallRound; boost: number; stake: number; win: number; onDone: () => void }) {
  const [step, setStep] = useState<Step>('intro')
  const [picked, setPicked] = useState<number | null>(null)
  const [shown, setShown] = useState(0)
  const done = useRef(false)
  // what each tile turns out to hide, once a tile is picked
  const behind = useMemo(() => {
    if (picked == null) return round.prizes
    const p = round.prizes.slice()
    ;[p[picked], p[round.hit]] = [p[round.hit], p[picked]]
    return p
  }, [picked, round])
  const timers = useRef<number[]>([])
  const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  useEffect(() => {
    showtimeSfx.bonusIn()
    at(boost > 1 ? 2000 : 1400, () => setStep('pick'))
    const t = timers.current
    return () => t.forEach(clearTimeout)
  }, [boost])

  const pick = (i: number) => {
    if (done.current || step !== 'pick') return
    done.current = true
    setPicked(i)
    setStep('shot')
    showtimeSfx.choose()
    at(350, () => showtimeSfx.shot())
    at(900, () => showtimeSfx.reveal(win))
    // then the rest of the wall turns over, in a wave from the tile picked
    at(2000, () => {
      setStep('wall')
      let n = 0
      const id = window.setInterval(() => {
        n += 3
        setShown(n)
        showtimeSfx.flip()
        if (n >= WALL_TILES + 12) clearInterval(id)
      }, 40)
      timers.current.push(id)
    })
    at(4200, () => setStep('done'))
    at(6400, onDone)
  }
  const left = useCountdown(PICK_SECS, step === 'pick', () => pick(Math.floor(Math.random() * WALL_TILES)))
  // the wall fits the room it has: ten tiles across and six down, square, with their gaps
  const [roomRef, room] = useSize<HTMLDivElement>({ w: 700, h: 420 })
  const gap = room.w < 500 ? 4 : 6
  const tile = Math.max(18, Math.min((room.w - 9 * gap) / 10, (room.h - 5 * gap) / 6))

  // the order the wall turns over in: nearest the tile picked first
  const order = useMemo(() => {
    if (picked == null) return new Array(WALL_TILES).fill(0)
    const pr = Math.floor(picked / 10)
    const pc = picked % 10
    const d = Array.from({ length: WALL_TILES }, (_, i) => Math.hypot(Math.floor(i / 10) - pr, (i % 10) - pc))
    const sorted = d.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
    const rank = new Array(WALL_TILES)
    sorted.forEach(([, i], r) => (rank[i] = r))
    return rank as number[]
  }, [picked])

  return (
    <BonusShell spot="wall" boost={boost} stake={stake} bg="radial-gradient(ellipse at 50% 25%, #0f5560 0%, #0b2630 55%, #071218 100%)">
      <div className="absolute right-3 top-3 z-10 max-sm:hidden">{step === 'pick' && <CountdownPill left={left} label="Pick a prize!" />}</div>
      <div className="absolute inset-0 flex flex-col items-center gap-2 px-3 pb-11 pt-[52px] sm:pt-14">
        <div className="flex h-9 items-center text-center text-[13px] font-bold text-white/80 sm:h-5">
          {step === 'intro' && (boost > 1 ? `Every prize boosted ×${boost}` : 'Sixty prizes are hiding on the wall')}
          {step === 'pick' && <span className="max-sm:hidden">Tap a tile to shoot it</span>}
          {step === 'pick' && (
            <span className="sm:hidden">
              <CountdownPill left={left} label="Tap a tile to shoot it" />
            </span>
          )}
        </div>
        <div ref={roomRef} className="flex min-h-0 w-full max-w-[760px] flex-1 items-center justify-center">
        <div className="grid grid-cols-10" style={{ gap, width: tile * 10 + gap * 9 }}>
          {Array.from({ length: WALL_TILES }, (_, i) => {
            const mine = picked === i
            const open = mine ? step !== 'pick' && step !== 'intro' : step === 'wall' || step === 'done' ? order[i] < shown : false
            const v = shownX(behind[i], boost)
            const c = TILE_COLORS[(i * 7) % TILE_COLORS.length]
            return (
              <button
                key={i}
                onClick={() => pick(i)}
                disabled={step !== 'pick'}
                aria-label={`Prize ${i + 1}`}
                className={`relative aspect-square [perspective:400px] ${step === 'pick' ? 'cursor-crosshair' : ''}`}
              >
                <motion.div className="absolute inset-0 [transform-style:preserve-3d]" initial={false} animate={{ rotateY: open ? 180 : 0, scale: mine && step === 'shot' ? [1, 1.25, 1.1] : 1 }} transition={{ duration: 0.45 }}>
                  <div
                    className={`absolute inset-0 flex items-center justify-center rounded-md text-[13px] font-black text-white/90 [backface-visibility:hidden] sm:rounded-lg sm:text-[18px] ${step === 'pick' ? 'transition hover:brightness-125' : ''}`}
                    style={{ background: `linear-gradient(160deg, ${c}, ${c}99)`, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.3)' }}
                  >
                    {ICONS[(i * 5) % ICONS.length]}
                  </div>
                  <div
                    className="absolute inset-0 flex items-center justify-center rounded-md [backface-visibility:hidden] [transform:rotateY(180deg)] sm:rounded-lg"
                    style={{ background: mine ? '#fff' : '#0b2630', boxShadow: mine ? '0 0 24px #22c7d8' : 'inset 0 0 0 1px rgba(34,199,216,.35)' }}
                  >
                    <span className={`tnum font-black leading-none ${v >= 1000 ? 'text-[8px] sm:text-[12px]' : 'text-[10px] sm:text-[15px]'}`} style={{ color: mine ? '#0b2630' : v >= 100 ? '#f7c548' : '#bdf3f8' }}>
                      {v >= MAX_WIN ? 'MAX' : fmtX(v)}
                    </span>
                  </div>
                </motion.div>
                {mine && step === 'shot' && (
                  <motion.span className="pointer-events-none absolute inset-[-30%] rounded-full border-4 border-white" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 0.6, opacity: [0, 1, 0] }} transition={{ duration: 0.5 }} />
                )}
              </button>
            )
          })}
        </div>
        </div>
      </div>
      {step === 'done' && <ResultPlate x={win} capped={win >= MAX_WIN} color="#22c7d8" />}
    </BonusShell>
  )
}
