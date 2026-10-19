import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { MACHINE_W, PLATE, REELS_H, SLOT, WINDOW, CELL, colX } from './layout'
import { COL, GOLD, INK, Sym } from './art'
import type { ReelSym } from './rules'

/*
  The reels: five windows under the card, each straight under its column, in a grape cabinet whose plate (left
  empty here) carries the spins counter, which the game lays over it. A spin is acted out here once it has been drawn: every reel's strip is built for that spin
  (the new symbol at the top, a run of random ones, then what showed before), and one animation frame loop slides
  the strips down: a quick kick to speed, a steady run with a little motion blur, a stop with a bounce, left to
  right. A reel that could finish a line (the screen decides, from the card, before the spin is shown) is teased: it
  slows to a crawl under a gold light before it stops. Hurrying lands every reel at once.

  At rest each strip is three symbols (the landed one in the middle), so the next spin starts from exactly what is
  showing. `looks` dresses the landed symbols: a number that marked the card pops, one that didn't fades, a Joker
  waiting to be placed glows.
*/

export interface SpinPlan {
  /** when each reel stops (ms from the start) */
  stopAt: number[]
  tease: boolean[]
  /** symbols a second while running */
  speed: number
  quick: boolean
}

export interface ReelsHandle {
  /** shows the spin: resolves once every reel has settled; onStop(i) as reel i lands, onTease(i) as it starts to crawl */
  spin(final: ReelSym[], plan: SpinPlan, onStop: (i: number) => void, onTease: (i: number) => void): Promise<void>
  /** lands every reel now */
  hurry(): void
}

export type Look = 'hit' | 'miss' | 'wait' | 'used' | null

interface Props {
  u: string
  /** what the reels show before the first spin */
  rest: readonly ReelSym[]
  looks: readonly Look[]
}

const TOP = (WINDOW - SLOT) / 2
/** the strip offset that puts item j in the middle of the window */
const centerY = (j: number) => TOP - j * SLOT
const SYM = 78

/** a random symbol for the run of a reel (looks only: what lands is drawn by the rules) */
function filler(c: number): ReelSym {
  const x = Math.random()
  if (x < 0.07) return { kind: 'joker' }
  if (x < 0.085) return { kind: 'super' }
  if (x < 0.1) return { kind: 'free' }
  return { kind: 'num', n: 15 * c + 1 + Math.floor(Math.random() * 15), cell: null }
}

interface Run {
  els: (HTMLDivElement | null)[]
  y0: number[]
  dist: number[]
  plan: SpinPlan
  t0: number
  landed: boolean[]
  teased: boolean[]
  blur: boolean[]
  hurried: boolean
  onStop: (i: number) => void
  onTease: (i: number) => void
  done: () => void
}

export const Reels = memo(
  forwardRef<ReelsHandle, Props>(function Reels({ u, rest, looks }, ref) {
    const [strips, setStrips] = useState<ReelSym[][]>(() => rest.map((s, c) => [filler(c), s, filler(c)]))
    const [spinNo, setSpinNo] = useState(0)
    const [teasing, setTeasing] = useState<boolean[]>([false, false, false, false, false])
    const els = useRef<(HTMLDivElement | null)[]>([])
    // one steady ref callback a reel, so the memoised strips don't re-render for a new function
    const [setters] = useState(() => [0, 1, 2, 3, 4].map((c) => (el: HTMLDivElement | null) => void (els.current[c] = el)))
    const run = useRef<Run | null>(null)
    const pending = useRef<Omit<Run, 'els' | 't0'> | null>(null)
    const raf = useRef(0)
    const stripsRef = useRef(strips)
    stripsRef.current = strips

    useImperativeHandle(ref, () => ({
      spin(final, plan, onStop, onTease) {
        return new Promise<void>((resolve) => {
          const cur = stripsRef.current
          const next = final.map((s, c) => {
            const m = Math.max(4, Math.round((plan.speed * plan.stopAt[c]) / 1000) - 3)
            const run = Array.from({ length: m }, () => filler(c))
            return [filler(c), s, filler(c), ...run, ...cur[c].slice(-3)]
          })
          const y0 = next.map((s) => centerY(s.length - 2))
          pending.current = {
            y0,
            dist: next.map((s) => (s.length - 3) * SLOT),
            plan,
            landed: [false, false, false, false, false],
            teased: [false, false, false, false, false],
            blur: [false, false, false, false, false],
            hurried: false,
            onStop,
            onTease,
            done: () => {
              setStrips(next.map((s) => s.slice(0, 3)))
              setTeasing([false, false, false, false, false])
              resolve()
            },
          }
          setStrips(next)
          setSpinNo((n) => n + 1)
        })
      },
      hurry() {
        if (run.current) run.current.hurried = true
        else if (pending.current) pending.current.hurried = true
      },
    }))

    // the new strips are on the page: start them moving before the browser paints
    useLayoutEffect(() => {
      const p = pending.current
      if (!p) return
      pending.current = null
      const r: Run = { ...p, els: els.current, t0: performance.now() }
      run.current = r
      r.els.forEach((el, c) => el && (el.style.transform = `translate3d(0, ${r.y0[c]}px, 0)`))
      const settle = r.plan.quick ? 120 : 190
      const over = r.plan.quick ? 9 : 14
      const step = (now: number) => {
        const t = now - r.t0
        let all = true
        for (let c = 0; c < 5; c++) {
          const el = r.els[c]
          const T = r.plan.stopAt[c]
          const D = r.dist[c]
          let p: number
          if (r.hurried) {
            p = D
            if (!r.landed[c]) {
              r.landed[c] = true
              r.onStop(c)
            }
          } else if (t >= T) {
            if (!r.landed[c]) {
              r.landed[c] = true
              r.onStop(c)
            }
            const k = Math.min(1, (t - T) / settle)
            p = D + over * (1 - k * k * (3 - 2 * k))
            if (k < 1) all = false
          } else {
            all = false
            // a kick up to speed, a steady run, then a stop (a long slow one when teased) that just overshoots
            const ta = r.plan.quick ? 90 : 140
            const dec = r.plan.tease[c] ? (r.plan.quick ? 420 : 900) : r.plan.quick ? 170 : 300
            const v = (D + over) / (ta / 2 + (T - dec - ta) + dec / 2)
            if (t < ta) p = (0.5 * v * t * t) / ta
            else if (t < T - dec) p = (v * ta) / 2 + v * (t - ta)
            else {
              const s = t - (T - dec)
              p = (v * ta) / 2 + v * (T - dec - ta) + v * s - (0.5 * v * s * s) / dec
              if (r.plan.tease[c] && !r.teased[c]) {
                r.teased[c] = true
                r.onTease(c)
                setTeasing((x) => x.map((on, i) => (i === c ? true : on)))
              }
            }
            const speed = t < ta ? (v * t) / ta : t < T - dec ? v : v * (1 - (t - (T - dec)) / dec)
            const blur = speed > 0.9
            if (blur !== r.blur[c] && el) {
              r.blur[c] = blur
              el.style.filter = blur ? 'blur(1.4px)' : ''
            }
          }
          if (el) {
            if (r.landed[c] && r.blur[c]) {
              r.blur[c] = false
              el.style.filter = ''
            }
            el.style.transform = `translate3d(0, ${(r.y0[c] + p).toFixed(2)}px, 0)`
          }
        }
        if (all) {
          run.current = null
          raf.current = 0
          r.done()
        } else raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    }, [spinNo])

    useLayoutEffect(() => () => cancelAnimationFrame(raf.current), [])

    return (
      <div className="absolute left-0" style={{ width: MACHINE_W, height: REELS_H }}>
        {/* the cabinet: a toon shadow, the grape body, the plate */}
        <div className="absolute inset-0 translate-y-[8px] rounded-[26px]" style={{ background: INK, opacity: 0.45 }} />
        <div className="absolute inset-0 rounded-[26px] border-[4px]" style={{ borderColor: INK, background: 'linear-gradient(180deg,#7a4ae6 0%,#5a2cc9 40%,#41199e 100%)' }}>
          <div className="absolute inset-x-6 top-[5px] h-[3px] rounded-full bg-white/35" />
        </div>
        {/* the windows */}
        {strips.map((strip, c) => {
          const look = looks[c]
          const tease = teasing[c]
          return (
            <div
              key={c}
              className="absolute overflow-hidden rounded-[18px] border-[3px]"
              style={{
                left: colX(c) - CELL / 2,
                top: PLATE + 2,
                width: CELL,
                height: WINDOW - 4,
                borderColor: INK,
                background: 'linear-gradient(180deg,#e9dcc2 0%,#fff9ee 22%,#fffdf8 50%,#fff9ee 78%,#e9dcc2 100%)',
                boxShadow: tease ? `0 0 0 3px ${GOLD}, 0 0 22px 6px ${GOLD}aa` : look === 'wait' ? `0 0 0 3px #fff, 0 0 20px 4px ${COL[4].light}` : undefined,
                transition: 'box-shadow .2s',
              }}
            >
              <Strip
                u={u}
                c={c}
                strip={strip}
                look={look}
                setRef={setters[c]}
              />
              {/* the cylinder's shading over the strip */}
              <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(29,15,48,.34) 0%,rgba(29,15,48,0) 26%,rgba(29,15,48,0) 74%,rgba(29,15,48,.34) 100%)' }} />
              <div className="pointer-events-none absolute inset-x-2 top-1 h-3 rounded-full bg-white/50 blur-[2px]" />
            </div>
          )
        })}

        {/* the pointers either side of the middle row */}
        <svg className="pointer-events-none absolute left-0" style={{ top: PLATE + 2 + WINDOW / 2 - 2 - 9 }} width={MACHINE_W} height="18" aria-hidden>
          <path d="M3 1 L13 9 L3 17 Z" fill={GOLD} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          <path d={`M${MACHINE_W - 3} 1 L${MACHINE_W - 13} 9 L${MACHINE_W - 3} 17 Z`} fill={GOLD} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }),
)

/** one reel's strip of symbols (its own component, so a landing re-renders only the reels whose looks changed) */
const Strip = memo(function Strip({ u, c, strip, look, setRef }: { u: string; c: number; strip: ReelSym[]; look: Look; setRef: (el: HTMLDivElement | null) => void }) {
  const calm = useReducedMotion()
  return (
    <div ref={setRef} className="absolute left-0 top-0 w-full will-change-transform" style={{ transform: `translate3d(0, ${centerY(strip.length - 2)}px, 0)` }}>
      {strip.map((s, j) => (
        <div key={j} className="flex items-center justify-center" style={{ height: SLOT }}>
          {j === 1 && look === 'wait' ? (
            // a Joker waiting to be placed bobs and wiggles until it is (or just stands out, for less motion)
            <motion.div animate={calm ? undefined : { y: [0, -5, 0], rotate: [0, -6, 6, 0] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}>
              <Sym u={u} s={s} col={c} size={SYM} className="scale-[1.08]" />
            </motion.div>
          ) : (
            <Sym u={u} s={s} col={c} size={SYM} className={j === 1 ? lookClass(look) : ''} />
          )}
        </div>
      ))}
    </div>
  )
})

function lookClass(look: Look) {
  if (look === 'hit') return 'transition-[transform,opacity,filter] duration-300 scale-[1.06]'
  if (look === 'miss') return 'transition-[transform,opacity,filter] duration-500 opacity-45 saturate-[.35] scale-[.9]'
  if (look === 'used') return 'transition-[transform,opacity,filter] duration-500 opacity-40 saturate-[.3] scale-[.9]'
  return 'transition-[transform,opacity,filter] duration-200'
}
