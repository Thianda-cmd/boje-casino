import { memo, useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue } from 'framer-motion'
import { FLAPPERS, MAX_WIN, MEGA_SEGMENTS, type FlapperId, type MegaSpin as MegaSpinRound } from '../rules'
import { fmtX } from '../words'
import { showtimeSfx } from '../sound'
import { BonusShell, CountdownPill, ResultPlate, shownX, useCountdown } from './kit'

/*
  Mega Spin: a giant wheel of 64 segments (58 multipliers, 4 DOUBLEs, 2 TRIPLEs) and three flappers round it. The
  player picks a flapper (or one is picked for them) and the wheel spins. When the player's flapper stops on a
  DOUBLE or TRIPLE, every multiplier on the wheel is doubled or tripled and the wheel spins again.

  Where the player's flapper stops after each spin was drawn with the round (rules.ts: `stops`); the wheel is turned
  so the flapper picked points there. Every flapper is alike until the wheel stops, so the pick is as good as any.
*/

const PICK_SECS = 8
const N = MEGA_SEGMENTS
const PHI = 360 / N
const C = 500
const R = 440
const PALETTE = ['#ff4d61', '#ffb02e', '#2ee87f', '#4cb4ff', '#9b7bff', '#ff5fa2', '#22c7d8', '#f7c548']
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
const pt = (deg: number, r: number) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))] as const
function wedge(a0: number, a1: number, r0: number, r1: number) {
  const [x0, y0] = pt(a0, r1)
  const [x1, y1] = pt(a1, r1)
  const [x2, y2] = pt(a1, r0)
  const [x3, y3] = pt(a0, r0)
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r1} ${r1} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}A${r0} ${r0} 0 0 0 ${x3.toFixed(1)} ${y3.toFixed(1)}Z`
}
/** a segment's label: its multiplier (boosted, times the DOUBLEs and TRIPLEs so far), or DOUBLE / TRIPLE */
const label = (v: number, f: number, boost: number) => (v === -2 ? 'DOUBLE' : v === -3 ? 'TRIPLE' : shownX(v * f, boost) >= MAX_WIN ? 'MAX' : fmtX(shownX(v * f, boost)))

const Disc = memo(function Disc({ wheel, f, boost, mine }: { wheel: number[]; f: number; boost: number; mine: number | null }) {
  return (
    <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full" aria-hidden>
      <circle cx={C} cy={C} r={R + 8} fill="#120c2c" />
      {wheel.map((v, i) => {
        const a = i * PHI
        const mark = v < 0
        const fill = v === -2 ? '#7c4dff' : v === -3 ? '#111' : PALETTE[i % PALETTE.length]
        return (
          <g key={i}>
            <path d={wedge(a - PHI / 2, a + PHI / 2, 150, R)} fill={fill} stroke="#120c2c" strokeWidth="2" opacity={mine === null || mine === i ? 1 : 0.55} />
            {mine === i && <path d={wedge(a - PHI / 2, a + PHI / 2, 150, R)} fill="none" stroke="#fff" strokeWidth="6" />}
            <motion.text
              key={`${i}-${f}`}
              initial={f > 1 && !mark ? { opacity: 0.2 } : false}
              animate={{ opacity: 1 }}
              x={C}
              y={C - 300}
              transform={`rotate(${a} ${C} ${C}) rotate(90 ${C} ${C - 300})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={mark ? 22 : 25}
              fontWeight="900"
              fill={v === -3 ? '#f7c548' : '#fff'}
              stroke="rgba(0,0,0,.35)"
              strokeWidth="1"
              fontFamily="Manrope, system-ui, sans-serif"
            >
              {label(v, f, boost)}
            </motion.text>
          </g>
        )
      })}
      <circle cx={C} cy={C} r="150" fill="#120c2c" />
      <circle cx={C} cy={C} r="138" fill="url(#st-mega-hub)" stroke="#f7c548" strokeWidth="6" />
      <defs>
        <radialGradient id="st-mega-hub" cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#ff4d61" />
          <stop offset="1" stopColor="#6e0f22" />
        </radialGradient>
      </defs>
      <text x={C} y={C - 16} textAnchor="middle" dominantBaseline="central" fontSize="44" fontWeight="900" fill="#fff" fontFamily="Manrope, system-ui, sans-serif">
        MEGA
      </text>
      <text x={C} y={C + 30} textAnchor="middle" dominantBaseline="central" fontSize="44" fontWeight="900" fill="#ffd25e" fontFamily="Manrope, system-ui, sans-serif">
        SPIN
      </text>
    </svg>
  )
})

type Step = 'intro' | 'pick' | 'spin' | 'mark' | 'done'

export function MegaSpinShow({ round, boost, stake, win, onDone }: { round: MegaSpinRound; boost: number; stake: number; win: number; onDone: () => void }) {
  const [step, setStep] = useState<Step>('intro')
  const [mine, setMine] = useState<FlapperId | null>(null)
  const [f, setF] = useState(1)
  const [stopped, setStopped] = useState<number | null>(null)
  const [mark, setMark] = useState<'DOUBLE' | 'TRIPLE' | null>(null)
  const [others, setOthers] = useState(true)
  const rot = useMotionValue(0)
  const chosen = useRef(false)
  const alive = useRef(true)
  const timers = useRef<number[]>([])

  useEffect(() => {
    alive.current = true
    showtimeSfx.bonusIn()
    timers.current.push(window.setTimeout(() => setStep('pick'), boost > 1 ? 2000 : 1400))
    const t = timers.current
    return () => {
      alive.current = false
      t.forEach(clearTimeout)
    }
  }, [boost])

  const go = async (id: FlapperId) => {
    if (chosen.current) return
    chosen.current = true
    setMine(id)
    showtimeSfx.choose()
    const at = FLAPPERS.find((x) => x.id === id)!.at * PHI
    const wait = (ms: number) => new Promise<void>((r) => timers.current.push(window.setTimeout(r, ms)))
    await wait(500)
    let factor = 1
    for (let i = 0; i < round.stops.length; i++) {
      if (!alive.current) return
      const s = round.stops[i]
      setStep('spin')
      setStopped(null)
      setMark(null)
      showtimeSfx.spin()
      // turn clockwise, several times round, to where segment s sits under the flapper picked
      const cur = rot.get()
      const want = at - s * PHI + (Math.random() - 0.5) * PHI * 0.6
      const base = cur + (i ? 3 : 5) * 360
      const target = base + ((((want - base) % 360) + 360) % 360)
      let last = Math.floor(cur / PHI)
      await animate(rot, target, {
        duration: i ? 4.5 : 6,
        ease: [0.12, 0.6, 0.12, 1],
        onUpdate: (v) => {
          const k = Math.floor(v / PHI)
          if (k !== last) {
            last = k
            showtimeSfx.tick(0.5)
          }
        },
      })
      if (!alive.current) return
      setStopped(s)
      const v = round.wheel[s]
      if (v < 0) {
        setStep('mark')
        setMark(v === -2 ? 'DOUBLE' : 'TRIPLE')
        showtimeSfx.double()
        await wait(1000)
        factor *= -v
        setF(factor)
        setOthers(false)
        await wait(1000)
      } else {
        showtimeSfx.reveal(win)
        await wait(1100)
        setStep('done')
        await wait(2200)
        if (alive.current) onDone()
      }
    }
  }
  const left = useCountdown(PICK_SECS, step === 'pick', () => void go(FLAPPERS[Math.floor(Math.random() * 3)].id))

  // what each flapper points at now that the wheel has stopped
  const under = (at: number) => ((Math.round((at * PHI - rot.get()) / PHI) % N) + N) % N
  return (
    <BonusShell spot="mega" boost={boost} stake={stake} noteOnPhone={false} bg="radial-gradient(ellipse at 50% 35%, #4a0f2a 0%, #1d0b26 55%, #0d0a1c 100%)">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-2 pb-3 pt-14 sm:flex-row sm:gap-6 sm:pb-10 sm:pt-12">
        <div className="relative aspect-square h-auto w-full max-w-[min(86vw,100%)] sm:h-full sm:w-auto">
          <motion.div className="absolute inset-0" style={{ rotate: rot }}>
            <Disc wheel={round.wheel} f={f} boost={boost} mine={stopped != null && step !== 'spin' ? stopped : null} />
          </motion.div>
          {/* the three flappers, still, round the rim */}
          {FLAPPERS.map((fl) => {
            const picked = mine === fl.id
            const show = mine === null || picked || others
            const a = fl.at * PHI
            const seg = stopped != null && step !== 'spin' ? under(fl.at) : null
            return (
              <div key={fl.id} className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${a}deg)`, opacity: show ? 1 : 0.25 }}>
                <svg viewBox="0 0 60 80" className="absolute left-1/2 top-[-1%] w-[7%] -translate-x-1/2" aria-hidden>
                  <path d="M30 76 L8 22 A22 22 0 1 1 52 22 Z" fill={fl.color} stroke={picked ? '#fff' : '#120c2c'} strokeWidth={picked ? 5 : 3} strokeLinejoin="round" />
                </svg>
                {seg != null && (picked || others) && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="tnum absolute left-1/2 top-[-9%] -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black sm:text-[13px]"
                    style={{ background: fl.color, color: '#120c2c', transform: `translateX(-50%) rotate(${-a}deg)` }}
                  >
                    {label(round.wheel[seg], f, boost)}
                  </motion.div>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 flex-row items-center gap-2 sm:w-[170px] sm:flex-col sm:items-stretch">
          {step === 'pick' && (
            <div className="hidden sm:block">
              <CountdownPill left={left} label="Pick a flapper" />
            </div>
          )}
          {step === 'pick' && (
            <div className="sm:hidden">
              <CountdownPill left={left} label="Pick" />
            </div>
          )}
          {FLAPPERS.map((fl) => (
            <button
              key={fl.id}
              onClick={() => void go(fl.id)}
              disabled={step !== 'pick'}
              className={`flex h-10 items-center gap-2 rounded-xl px-3 text-[13px] font-black transition sm:h-12 sm:text-[14px] ${step === 'pick' ? 'hover:brightness-110' : ''} ${mine && mine !== fl.id ? 'opacity-40' : ''}`}
              style={{ background: `${fl.color}26`, color: fl.color, boxShadow: mine === fl.id ? `0 0 0 2px ${fl.color}` : `inset 0 0 0 1px ${fl.color}66` }}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: fl.color }} />
              {fl.name}
            </button>
          ))}
        </div>
      </div>
      {mark && step === 'mark' && (
        <motion.div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.div
            initial={{ scale: 0.3, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12 }}
            className="rounded-2xl px-6 py-3 text-[36px] font-black shadow-[0_0_60px_-6px_#7c4dff]"
            style={{ background: mark === 'DOUBLE' ? '#7c4dff' : '#111', color: mark === 'DOUBLE' ? '#fff' : '#f7c548' }}
          >
            {mark}! Spin again
          </motion.div>
        </motion.div>
      )}
      {step === 'done' && <ResultPlate x={win} capped={win >= MAX_WIN} color="#ff4d61" />}
    </BonusShell>
  )
}
