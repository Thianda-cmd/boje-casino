import { useEffect, useMemo, useState } from 'react'
import { useSize } from '../../../lib/useSize'
import { motion } from 'framer-motion'
import { MAX_WIN, WALL_TILES, type PrizeWall as PrizeWallRound } from '../rules'
import { fmtX } from '../words'
import { showtimeSfx } from '../sound'
import { BonusShell, CountdownPill, PickNote, ResultPlate, shownX, useFirstStep, useSecondsLeft, useShow, type BonusTimes } from './kit'

/*
  Prize Wall: sixty prizes hidden behind the tiles of one wall, the same wall for everyone. Each player picks a tile
  before the picks close (or the round's own tile is played for them); the prizes are only drawn from the seed, which
  the server reveals as the picks close, so nobody can know what a tile hides while picking. Then every player's tile
  is shot and turns over, and the whole wall turns over to show what else was there. It plays on the shared clock
  (clock.ts): the pick until picksUntil, the reveal WALL_REVEAL_MS after.
*/

const ICONS = ['★', '♦', '♥', '♣', '♠', '●']
const TILE_COLORS = ['#ff5fa2', '#22c7d8', '#f7c548', '#9b7bff', '#ff8a3d', '#2ee87f']
/** the tile picked turns over this long after the picks close, once the prizes are in */
const TURN_MS = 900
const WAVE_MS = 2000

type Step = 'intro' | 'pick' | 'shot' | 'turn' | 'wall' | 'done'

export function PrizeWallShow({
  clock,
  t,
  round,
  boost,
  stake,
  win,
  chosen,
  played,
  note,
  onPick,
}: {
  clock: () => number
  t: BonusTimes
  round: PrizeWallRound
  boost: number
  stake: number
  /** this player's win, to 1, once the prizes are in */
  win: number | null
  /** the tile this player has picked on this screen */
  chosen: number | null
  /** the tile played for this player, once the picks are in */
  played: number | null
  note: 'sending' | 'ok' | 'failed' | 'local' | null
  onPick: (i: number) => void
}) {
  const picksUntil = t.picksUntil!
  const [shown, setShown] = useState(0)
  const step = useShow<Step>(
    clock,
    [
      ['intro', t.bonusAt],
      ['pick', t.playAt],
      ['shot', picksUntil],
      ['turn', picksUntil + TURN_MS],
      ['wall', picksUntil + WAVE_MS],
      ['done', t.endsAt],
    ],
    (now) => setShown(now < picksUntil + WAVE_MS ? 0 : Math.floor((now - picksUntil - WAVE_MS) / 40) * 3),
  )
  const first = useFirstStep(step)
  const mine = played ?? chosen
  const turned = (step === 'turn' || step === 'wall' || step === 'done') && !!round.prizes
  useEffect(() => {
    if (step === first && step !== 'intro') return
    if (step === 'intro') showtimeSfx.bonusIn()
    else if (step === 'shot') {
      showtimeSfx.choose()
      window.setTimeout(() => showtimeSfx.shot(), 350)
    }
    // a sound for each step as it comes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])
  useEffect(() => {
    if (turned && win != null && step === 'turn') showtimeSfx.reveal(win)
    // once, as the tile turns over
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turned])
  useEffect(() => {
    if (step === 'wall' && shown > 0 && shown < WALL_TILES + 12) showtimeSfx.flip()
    // a flip for each part of the wave
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  const left = useSecondsLeft(clock, picksUntil, step === 'pick')
  // the wall fits the room it has: ten tiles across and six down, square, with their gaps
  const [roomRef, room] = useSize<HTMLDivElement>({ w: 700, h: 420 })
  const gap = room.w < 500 ? 4 : 6
  const tile = Math.max(18, Math.min((room.w - 9 * gap) / 10, (room.h - 5 * gap) / 6))

  // the order the wall turns over in: nearest the tile picked first
  const order = useMemo(() => {
    const at = mine ?? round.auto
    const pr = Math.floor(at / 10)
    const pc = at % 10
    const d = Array.from({ length: WALL_TILES }, (_, i) => Math.hypot(Math.floor(i / 10) - pr, (i % 10) - pc))
    const sorted = d.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
    const rank = new Array(WALL_TILES)
    sorted.forEach(([, i], r) => (rank[i] = r))
    return rank as number[]
  }, [mine, round.auto])

  return (
    <BonusShell spot="wall" boost={boost} stake={stake} bg="radial-gradient(ellipse at 50% 25%, #0f5560 0%, #0b2630 55%, #071218 100%)">
      <div className="absolute right-3 top-3 z-10 max-sm:hidden">{step === 'pick' && <CountdownPill left={left} label={chosen == null ? 'Pick a prize!' : 'Change your pick?'} />}</div>
      <div className="absolute inset-0 flex flex-col items-center gap-2 px-3 pb-11 pt-[52px] sm:pt-14">
        <div className="flex h-9 flex-wrap items-center justify-center gap-2 text-center text-[13px] font-bold text-white/80 sm:h-5">
          {step === 'intro' && (boost > 1 ? `Every prize boosted ×${boost}` : 'Sixty prizes are hiding on the wall')}
          {step === 'pick' && <span className="max-sm:hidden">{chosen == null ? 'Tap a tile to shoot it' : `Tile ${chosen + 1} it is`}</span>}
          {step === 'pick' && (
            <span className="sm:hidden">
              <CountdownPill left={left} label={chosen == null ? 'Tap a tile' : `Tile ${chosen + 1}`} />
            </span>
          )}
          {step === 'pick' && chosen != null && <PickNote state={note} />}
          {(step === 'shot' || step === 'turn') && chosen == null && played != null && <span>The show picked tile {played + 1} for you</span>}
          {(step === 'shot' || step === 'turn') && !round.prizes && <span>Revealing the wall…</span>}
        </div>
        <div ref={roomRef} className="flex min-h-0 w-full max-w-[760px] flex-1 items-center justify-center">
          <div className="grid grid-cols-10" style={{ gap, width: tile * 10 + gap * 9 }}>
            {Array.from({ length: WALL_TILES }, (_, i) => {
              const isMine = mine === i
              const open = isMine ? turned : (step === 'wall' || step === 'done') && !!round.prizes && order[i] < shown
              const v = round.prizes ? shownX(round.prizes[i], boost) : 0
              const c = TILE_COLORS[(i * 7) % TILE_COLORS.length]
              const aiming = isMine && step === 'pick'
              return (
                <button
                  key={i}
                  onClick={() => onPick(i)}
                  disabled={step !== 'pick'}
                  aria-label={`Prize ${i + 1}`}
                  aria-pressed={isMine}
                  className={`relative aspect-square [perspective:400px] ${step === 'pick' ? 'cursor-crosshair' : ''}`}
                >
                  <motion.div className="absolute inset-0 [transform-style:preserve-3d]" initial={false} animate={{ rotateY: open ? 180 : 0, scale: isMine && (step === 'shot' || step === 'turn') && !turned ? [1, 1.25, 1.1] : 1 }} transition={{ duration: 0.45 }}>
                    <div
                      className={`absolute inset-0 flex items-center justify-center rounded-md text-[13px] font-black text-white/90 [backface-visibility:hidden] sm:rounded-lg sm:text-[18px] ${step === 'pick' ? 'transition hover:brightness-125' : ''}`}
                      style={{
                        background: `linear-gradient(160deg, ${c}, ${c}99)`,
                        boxShadow: aiming ? '0 0 0 3px #fff, 0 0 18px #fff' : 'inset 0 -3px 0 rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.3)',
                      }}
                    >
                      {aiming ? '◎' : ICONS[(i * 5) % ICONS.length]}
                    </div>
                    <div
                      className="absolute inset-0 flex items-center justify-center rounded-md [backface-visibility:hidden] [transform:rotateY(180deg)] sm:rounded-lg"
                      style={{ background: isMine ? '#fff' : '#0b2630', boxShadow: isMine ? '0 0 24px #22c7d8' : 'inset 0 0 0 1px rgba(34,199,216,.35)' }}
                    >
                      <span className={`tnum font-black leading-none ${v >= 1000 ? 'text-[8px] sm:text-[12px]' : 'text-[10px] sm:text-[15px]'}`} style={{ color: isMine ? '#0b2630' : v >= 100 ? '#f7c548' : '#bdf3f8' }}>
                        {v >= MAX_WIN ? 'MAX' : fmtX(v)}
                      </span>
                    </div>
                  </motion.div>
                  {isMine && (step === 'shot' || step === 'turn') && !turned && (
                    <motion.span className="pointer-events-none absolute inset-[-30%] rounded-full border-4 border-white" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 0.6, opacity: [0, 1, 0] }} transition={{ duration: 0.5 }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      {step === 'done' && win != null && <ResultPlate x={win} capped={win >= MAX_WIN} color="#22c7d8" />}
    </BonusShell>
  )
}
