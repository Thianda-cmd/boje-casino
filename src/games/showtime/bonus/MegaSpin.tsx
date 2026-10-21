import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { cubicBezier, motion, useMotionValue } from 'framer-motion'
import { FLAPPERS, MAX_WIN, MEGA_SEGMENTS, megaStops, type MegaSpin as MegaSpinRound } from '../rules'
import { megaSpins } from '../clock'
import { fmtX } from '../words'
import { showtimeSfx } from '../sound'
import { BonusShell, CountdownPill, PickNote, ResultPlate, seeded, shownX, useFirstStep, useSecondsLeft, useShow, type BonusTimes } from './kit'

/*
  Mega Spin: one giant wheel of 64 segments (58 multipliers, 4 DOUBLEs, 2 TRIPLEs) for everyone, and three flappers
  round it. Each player picks a flapper before the picks close (or the round's own is played for them), and follows
  it. The wheel spins; a player whose flapper stops on a DOUBLE or TRIPLE has every multiplier on their wheel doubled
  or tripled, and the wheel spins again until every flapper has stopped on a multiplier. Where it stops each spin is
  drawn from the seed, revealed as the picks close (rules.ts: `spins`), and every browser turns the wheel the same way
  on the shared clock (clock.ts megaSpins).
*/

const N = MEGA_SEGMENTS
const PHI = 360 / N
const C = 500
const R = 440
const PALETTE = ['#ff4d61', '#ffb02e', '#2ee87f', '#4cb4ff', '#9b7bff', '#ff5fa2', '#22c7d8', '#f7c548']
const ease = cubicBezier(0.12, 0.6, 0.12, 1)
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

type Step = 'intro' | 'pick' | 'lead' | 'spin' | 'stop' | 'done'

/** each flapper's run: where it stops after every spin, and its DOUBLEs and TRIPLEs so far after each one */
function runs(round: MegaSpinRound) {
  return FLAPPERS.map((_, f) => {
    const stops = megaStops(round, f)
    const factors: number[] = []
    let x = 1
    stops.forEach((s, k) => {
      if (k < stops.length - 1) x *= -round.wheel[s]
      factors.push(x)
    })
    return { stops, factors }
  })
}

export function MegaSpinShow({
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
  id,
}: {
  clock: () => number
  t: BonusTimes
  round: MegaSpinRound
  boost: number
  stake: number
  win: number | null
  chosen: number | null
  played: number | null
  note: 'sending' | 'ok' | 'failed' | 'local' | null
  onPick: (f: number) => void
  id: number
}) {
  const picksUntil = t.picksUntil!
  const rot = useMotionValue(0)
  const n = round.spins?.length ?? 0
  const times = useMemo(() => (n ? megaSpins(picksUntil, n) : []), [picksUntil, n])
  const all = useMemo(() => (round.spins ? runs(round) : null), [round])
  // where the wheel rests after each spin: segment spins[k] at the top, a little off centre, the same everywhere
  const targets = useMemo(() => {
    let from = 0
    return (round.spins ?? []).map((top, k) => {
      const want = -top * PHI + (seeded(id, k)() - 0.5) * PHI * 0.6
      const base = from + (k ? 3 : 5) * 360
      const to = base + ((((want - base) % 360) + 360) % 360)
      const out = { from, to }
      from = to
      return out
    })
  }, [round.spins, id])
  // the first spin sets off when the stops are in: on time, or later (and quicker) if the reveal came late
  const setOff = useRef<number | null>(null)
  const lastSeg = useRef(0)
  const [k, setK] = useState(-1)

  const steps = useMemo(() => {
    const out: [Step, number][] = [
      ['intro', t.bonusAt],
      ['pick', t.playAt],
      ['lead', picksUntil],
    ]
    times.forEach((s) => {
      out.push(['spin', s.from])
      out.push(['stop', s.to])
    })
    out.push(['done', t.endsAt])
    return out
  }, [t, picksUntil, times])
  const step = useShow<Step>(clock, steps, (now) => {
    if (!times.length) return
    let i = -1
    for (let j = 0; j < times.length; j++) if (now >= times[j].from) i = j
    setK(i)
    if (i < 0) return rot.set(0)
    const s = times[i]
    let t0 = s.from
    if (i === 0) {
      if (setOff.current == null) setOff.current = now > s.from + 50 && s.to - now >= 1500 ? now : s.from
      t0 = setOff.current
    }
    const p = Math.max(0, Math.min(1, (now - t0) / (s.to - t0)))
    const { from, to } = targets[i]
    const v = from + (to - from) * ease(p)
    rot.set(v)
    const seg = Math.floor(v / PHI)
    if (seg !== lastSeg.current) {
      lastSeg.current = seg
      if (p < 1 && !document.hidden) showtimeSfx.tick(0.5)
    }
  })
  const first = useFirstStep(step)
  const mine = played ?? chosen ?? round.auto
  // the flapper shown as this player's: the one they picked, or the one played for them once the picks are in
  const shownPick = played ?? chosen
  const run = all?.[mine]
  // my run after spin k: how far it has got, and whether it has ended
  const myStop = run && k >= 0 && k < run.stops.length && step !== 'spin' ? run.stops[k] : null
  const myDone = !!run && k >= run.stops.length - 1 && step !== 'spin'
  const myMark = !!run && k >= 0 && k < run.stops.length - 1 && step === 'stop'
  // the DOUBLE or TRIPLE takes hold a second into the pause after the spin
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!myMark) return setLate(false)
    const left = times[k].to + 1000 - clock()
    if (left <= 0) return setLate(true)
    const id = window.setTimeout(() => setLate(true), left)
    return () => clearTimeout(id)
  }, [myMark, k, times, clock])
  // my wheel's DOUBLEs and TRIPLEs so far: up to the last stop (not the spin still turning), each once it takes hold
  const L = run?.stops.length ?? 0
  const fi = !run || k < 0 ? -1 : step === 'spin' ? Math.min(k - 1, L - 1) : Math.min(k, L - 1) - (myMark && !late ? 1 : 0)
  const f = fi >= 0 ? run!.factors[fi] : 1

  useEffect(() => {
    if (step === first && step !== 'intro') return
    if (step === 'intro') showtimeSfx.bonusIn()
    else if (step === 'lead') showtimeSfx.choose()
    else if (step === 'spin') showtimeSfx.spin()
    else if (step === 'stop' && run && k < run.stops.length - 1) showtimeSfx.double()
    else if (step === 'stop' && run && k === run.stops.length - 1 && win != null) showtimeSfx.reveal(win)
    // a sound for each step as it comes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, k])
  const left = useSecondsLeft(clock, picksUntil, step === 'pick')
  const picking = step === 'pick'
  const others = all ? all.some((r, i) => i !== mine && r.stops.length > (run?.stops.length ?? 0)) : false

  return (
    <BonusShell spot="mega" boost={boost} stake={stake} noteOnPhone={false} bg="radial-gradient(ellipse at 50% 35%, #4a0f2a 0%, #1d0b26 55%, #0d0a1c 100%)">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-2 pb-3 pt-14 sm:flex-row sm:gap-6 sm:pb-10 sm:pt-12">
        <div className="relative aspect-square h-auto w-full max-w-[min(86vw,100%)] sm:h-full sm:w-auto">
          <motion.div className="absolute inset-0" style={{ rotate: rot }}>
            <Disc wheel={round.wheel} f={f} boost={boost} mine={myStop} />
          </motion.div>
          {/* the three flappers, still, round the rim */}
          {FLAPPERS.map((fl, i) => {
            const picked = shownPick === i
            const a = fl.at * PHI
            const r = all?.[i]
            const kk = r && k >= 0 && step !== 'spin' ? Math.min(k, r.stops.length - 1) : -1
            const seg = kk >= 0 ? r!.stops[kk] : null
            const out = r ? k >= r.stops.length : false
            return (
              <div key={fl.id} className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${a}deg)`, opacity: picked || !out ? 1 : 0.35 }}>
                <svg viewBox="0 0 60 80" className="absolute left-1/2 top-[-1%] w-[7%] -translate-x-1/2" aria-hidden>
                  <path d="M30 76 L8 22 A22 22 0 1 1 52 22 Z" fill={fl.color} stroke={picked ? '#fff' : '#120c2c'} strokeWidth={picked ? 5 : 3} strokeLinejoin="round" />
                </svg>
                {seg != null && (
                  <motion.div
                    key={`${kk}-${seg}`}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="tnum absolute left-1/2 top-[-9%] -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black sm:text-[13px]"
                    style={{ background: fl.color, color: '#120c2c', transform: `translateX(-50%) rotate(${-a}deg)`, boxShadow: picked ? '0 0 0 2px #fff' : undefined }}
                  >
                    {label(round.wheel[seg], r!.factors[kk], boost)}
                  </motion.div>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 flex-row flex-wrap items-center justify-center gap-2 sm:w-[170px] sm:flex-col sm:items-stretch">
          {picking && (
            <div className="hidden sm:block">
              <CountdownPill left={left} label={chosen == null ? 'Pick a flapper' : 'Change it?'} />
            </div>
          )}
          {picking && (
            <div className="sm:hidden">
              <CountdownPill left={left} label="Pick" />
            </div>
          )}
          {FLAPPERS.map((fl, i) => (
            <button
              key={fl.id}
              onClick={() => onPick(i)}
              disabled={!picking}
              aria-pressed={shownPick === i}
              className={`flex h-10 items-center gap-2 rounded-xl px-3 text-[13px] font-black transition sm:h-12 sm:text-[14px] ${picking ? 'hover:brightness-110' : ''} ${shownPick != null && shownPick !== i ? 'opacity-40' : ''}`}
              style={{ background: `${fl.color}26`, color: fl.color, boxShadow: shownPick === i ? `0 0 0 2px ${fl.color}` : `inset 0 0 0 1px ${fl.color}66` }}
            >
              <span className="h-3 w-3 rounded-full" style={{ background: fl.color }} />
              {fl.name}
            </button>
          ))}
          {picking && chosen != null && (
            <span className="max-sm:hidden">
              <PickNote state={note} />
            </span>
          )}
          {!picking && step !== 'intro' && chosen == null && played != null && <span className="text-center text-[12px] font-bold text-white/70">The show gave you {FLAPPERS[played].name}</span>}
          {myDone && others && step !== 'done' && <span className="text-center text-[12px] font-bold text-white/70">Your flapper has stopped. The wheel spins on for the others</span>}
        </div>
      </div>
      {myMark && run && step === 'stop' && (
        <motion.div key={k} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.div
            initial={{ scale: 0.3, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12 }}
            className="rounded-2xl px-6 py-3 text-[36px] font-black shadow-[0_0_60px_-6px_#7c4dff]"
            style={{ background: round.wheel[run.stops[k]] === -2 ? '#7c4dff' : '#111', color: round.wheel[run.stops[k]] === -2 ? '#fff' : '#f7c548' }}
          >
            {round.wheel[run.stops[k]] === -2 ? 'DOUBLE' : 'TRIPLE'}! Spin again
          </motion.div>
        </motion.div>
      )}
      {step === 'done' && win != null && <ResultPlate x={win} capped={win >= MAX_WIN} color="#ff4d61" />}
    </BonusShell>
  )
}
