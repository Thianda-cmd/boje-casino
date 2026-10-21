import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue } from 'framer-motion'
import { MAX_WIN, PEG_SLOTS, type PegDrop as PegDropRound } from '../rules'
import { dropAt } from '../clock'
import { fmtX } from '../words'
import { showtimeSfx } from '../sound'
import { BonusShell, ResultPlate, seeded, shownX, useFirstStep, useShow, type BonusTimes } from './kit'

/*
  Peg Drop: a puck falls through fifteen rows of pegs onto sixteen slots, fourteen multipliers and two DOUBLEs. A
  DOUBLE doubles every multiplier on the row and the puck goes back up and drops again. The slot each drop lands in
  comes with the round (rules.ts); its path down the pegs is made up to end there, the same in every browser (from the
  round id): at each row it goes left or right of the peg, as many rights in all as the slot's number. Each drop runs
  to the shared clock (clock.ts: one every DROP_MS + DOUBLE_MS from the end of the intro).

  Drawn on a 640 × 760 board: slot k spans x(k) to x(k + 1); the pegs alternate between whole and half slot positions
  row by row, under where the puck can be.
*/

const W = 640
const U = 37.5
const ROWS = 15
const x = (p: number) => 20 + p * U
const rowY = (j: number) => 74 + j * 33
const SLOT_TOP = 600
const SLOT_H = 130
const ROW_MS = 120
const ENTRY_MS = 250
/** a drop's puck lands this long after the drop starts */
const LAND_AT = ENTRY_MS + (ROWS + 2) * ROW_MS
const easeIn = (p: number) => p * p * p

/** a path down the pegs that ends in slot d: the puck's points, one above each row and then down into the slot */
function pathTo(d: number, rnd: () => number) {
  const moves = [...Array(d).fill(1), ...Array(ROWS - d).fill(-1)]
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[moves[i], moves[j]] = [moves[j], moves[i]]
  }
  const xs = [x(8)]
  const ys = [20]
  let p = 8
  for (let j = 0; j < ROWS; j++) {
    xs.push(x(p))
    ys.push(rowY(j) - 15)
    p += moves[j] * 0.5
  }
  xs.push(x(p), x(p))
  ys.push(SLOT_TOP - 4, SLOT_TOP + 40)
  return { xs, ys }
}

type Step = 'intro' | 'drop' | 'double' | 'landed' | 'done'

export function PegDropShow({ clock, t, round, boost, stake, win, id }: { clock: () => number; t: BonusTimes; round: PegDropRound; boost: number; stake: number; win: number; id: number }) {
  const px = useMotionValue(x(8))
  const py = useMotionValue(-30)
  const [lit, setLit] = useState<number | null>(null)
  const [doubles, setDoubles] = useState(0)
  const paths = useMemo(() => round.drops.map((d, k) => pathTo(d, seeded(id, k))), [round, id])
  const lastRow = useRef(-1)
  const last = round.drops.length - 1

  // where the show is at `now`: which drop, how far down, which slot is lit, how many DOUBLEs have doubled the row
  const steps = useMemo(() => {
    const out: [Step, number][] = [['intro', t.bonusAt]]
    round.drops.forEach((_, k) => {
      const at = dropAt(t.playAt, k)
      out.push(['drop', at])
      out.push([k < last ? 'double' : 'landed', at + LAND_AT])
    })
    out.push(['done', t.endsAt])
    return out
  }, [round, t, last])
  const step = useShow<Step>(clock, steps, (now) => {
    let k = -1
    for (let i = 0; i <= last; i++) if (now >= dropAt(t.playAt, i)) k = i
    if (k < 0) return
    const tt = now - dropAt(t.playAt, k)
    const { xs, ys } = paths[k]
    if (tt < ENTRY_MS) {
      px.set(xs[0])
      py.set(-30 + (50 * tt) / ENTRY_MS)
    } else if (tt < LAND_AT) {
      const n = xs.length - 1
      const q = Math.min(n, (tt - ENTRY_MS) / ROW_MS)
      const j = Math.min(n - 1, Math.floor(q))
      const f = q - j
      px.set(xs[j] + (xs[j + 1] - xs[j]) * f)
      py.set(ys[j] + (ys[j + 1] - ys[j]) * easeIn(f))
      const row = k * 100 + j
      if (row !== lastRow.current && j >= 1 && j <= ROWS) {
        lastRow.current = row
        if (!document.hidden) showtimeSfx.peg((j - 1) / ROWS)
      }
    } else {
      px.set(xs[xs.length - 1])
      py.set(ys[ys.length - 1])
    }
    setLit(tt >= LAND_AT ? round.drops[k] : null)
    // a DOUBLE doubles the row 700 ms after the puck lands on it
    setDoubles(k + (k < last && tt >= LAND_AT + 700 ? 1 : 0))
  })
  const first = useFirstStep(step)
  useEffect(() => {
    if (step === first && step !== 'intro') return
    if (step === 'intro') showtimeSfx.bonusIn()
    else if (step === 'double') showtimeSfx.double()
    else if (step === 'landed') showtimeSfx.reveal(win)
    // a sound for each step as it comes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const pegs = useMemo(() => {
    const out: [number, number][] = []
    for (let j = 0; j < ROWS; j++) for (let p = j % 2 ? 0.5 : 1; p <= (j % 2 ? 15.5 : 15); p += 1) out.push([x(p), rowY(j)])
    return out
  }, [])
  const f = 2 ** doubles
  return (
    <BonusShell spot="peg" boost={boost} stake={stake} bg="radial-gradient(ellipse at 50% 20%, #0f4a2c 0%, #0b2018 55%, #07120e 100%)">
      <div className="absolute inset-0 flex items-center justify-center px-2 pb-9 pt-12">
        <svg viewBox={`0 0 ${W} 760`} className="h-full max-w-full" aria-label="Peg Drop board">
          <defs>
            <linearGradient id="st-peg-board" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#123d2a" />
              <stop offset="1" stopColor="#0a2117" />
            </linearGradient>
            <radialGradient id="st-puck" cx=".35" cy=".3" r=".8">
              <stop offset="0" stopColor="#ffb3bd" />
              <stop offset=".5" stopColor="#ff4d61" />
              <stop offset="1" stopColor="#8a1426" />
            </radialGradient>
          </defs>
          <rect x="4" y="4" width={W - 8} height="752" rx="22" fill="url(#st-peg-board)" stroke="#2ee87f" strokeOpacity=".5" strokeWidth="3" />
          {pegs.map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="5" fill="#d9ffe9" stroke="#0b5a30" strokeWidth="1.5" />
          ))}
          {Array.from({ length: PEG_SLOTS }, (_, k) => {
            const v = round.row[k]
            const dbl = v === 0
            const on = lit === k
            const val = dbl ? 0 : shownX(v * f, boost)
            return (
              <g key={k}>
                <rect
                  x={x(k) + 1.5}
                  y={SLOT_TOP}
                  width={U - 3}
                  height={SLOT_H}
                  rx="7"
                  fill={dbl ? '#7c4dff' : on ? '#2ee87f' : '#15402c'}
                  stroke={on ? '#fff' : dbl ? '#c9b8ff' : '#2ee87f'}
                  strokeOpacity={on ? 1 : 0.45}
                  strokeWidth={on ? 3 : 1.5}
                />
                <g transform={`rotate(-90 ${x(k) + U / 2} ${SLOT_TOP + SLOT_H / 2})`}>
                  <motion.text
                    key={`${k}-${f}`}
                    initial={doubles && !dbl ? { opacity: 0.2 } : false}
                    animate={{ opacity: 1 }}
                    x={x(k) + U / 2}
                    y={SLOT_TOP + SLOT_H / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={dbl ? 19 : val >= 10000 ? 17 : val >= 1000 ? 20 : 23}
                    fontWeight="900"
                    fill={on && !dbl ? '#04210f' : '#fff'}
                    fontFamily="Manrope, system-ui, sans-serif"
                  >
                    {dbl ? 'DOUBLE' : val >= MAX_WIN ? 'MAX' : fmtX(val)}
                  </motion.text>
                </g>
              </g>
            )
          })}
          <motion.circle cx={px} cy={py} r="12" fill="url(#st-puck)" stroke="#5a0b18" strokeWidth="2" />
        </svg>
      </div>
      {step === 'double' && (
        <motion.div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.div initial={{ scale: 0.3, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }} className="rounded-2xl bg-[#7c4dff] px-6 py-3 text-[36px] font-black text-white shadow-[0_0_60px_-6px_#7c4dff]">
            DOUBLE!
          </motion.div>
        </motion.div>
      )}
      {step === 'done' && <ResultPlate x={win} capped={win >= MAX_WIN} color="#2ee87f" />}
    </BonusShell>
  )
}
