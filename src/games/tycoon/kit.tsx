import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmtCash } from './engine'

/*
  Casino Tycoon's small shared pieces: the page's keyframes, the rolling counter, the cycle bar (a CSS animation in
  step with the engine, so a round that lasts a tenth of a second costs no renders), a count badge, timers that die
  with the page, the coins that fly from the vault to the balance in the header, and numbers rising from a press.
*/

/** keyframes the page's pieces share; rendered once by the page */
export function TycoonStyles() {
  return (
    <style>{`
@keyframes ty-fill { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes ty-stripes { from { background-position: 0 0 } to { background-position: 28px 0 } }
@keyframes ty-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
@keyframes ty-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.035) } }
@keyframes ty-shine { 0% { transform: translateX(-120%) skewX(-18deg) } 60%, 100% { transform: translateX(260%) skewX(-18deg) } }
@keyframes ty-glow { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
.ty-scroll { overscroll-behavior: contain; scrollbar-gutter: stable }
@media (prefers-reduced-motion: reduce) { .ty-motion { animation: none !important } }
`}</style>
  )
}

/**
 * A number that rolls to its value rather than jumping: it eases in log space, so it climbs from 1.2M to 45B as
 * smoothly as from 12 to 15. It writes its own text each frame (no renders).
 */
export function Rolling({ value, format = fmtCash, className = '' }: { value: number; format?: (n: number) => string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const st = useRef({ shown: value, target: value, raf: 0, last: 0 })
  useLayoutEffect(() => {
    if (el.current) el.current.textContent = format(st.current.shown)
  }, [format])
  useEffect(() => {
    const s = st.current
    s.target = value
    if (s.raf || s.shown === value) return
    const step = (t: number) => {
      const dt = s.last ? Math.min(0.05, (t - s.last) / 1000) : 1 / 60
      s.last = t
      const a = Math.log1p(Math.max(0, s.shown))
      const b = Math.log1p(Math.max(0, s.target))
      const next = a + (b - a) * (1 - Math.exp(-dt * 7))
      const done = Math.abs(b - next) < 2e-4
      s.shown = done ? s.target : Math.expm1(next)
      if (el.current) el.current.textContent = format(s.shown)
      if (done) {
        s.raf = 0
        s.last = 0
        return
      }
      s.raf = requestAnimationFrame(step)
    }
    s.raf = requestAnimationFrame(step)
  }, [value, format])
  useEffect(() => () => cancelAnimationFrame(st.current.raf), [])
  return <span ref={el} className={`tnum ${className}`} />
}

/** below this a round is a blur: the bar shows stripes running instead of filling */
const BLUR_S = 0.3

/**
 * A round's progress. Running, it fills over `seconds` from `progress` (a CSS animation, in step with the engine's
 * clock), over and over when `loop` (a manager) or once; `epoch` restarts it (a new manual round). Stopped, it is
 * empty. A round faster than BLUR_S shows stripes running instead.
 */
export function CycleBar({
  seconds,
  progress,
  on,
  loop,
  epoch,
  color,
  className = 'h-7',
  children,
}: {
  seconds: number
  progress: number
  on: boolean
  loop: boolean
  epoch: number
  color: string
  className?: string
  children?: ReactNode
}) {
  const blur = on && loop && seconds < BLUR_S
  return (
    <div className={`relative overflow-hidden rounded-lg bg-black/35 shadow-[inset_0_1px_3px_rgba(0,0,0,.4)] ${className}`}>
      {on && !blur && <Fill key={`${seconds}|${epoch}|${loop}`} seconds={seconds} progress={progress} loop={loop} color={color} />}
      {blur && (
        <div
          className="ty-motion absolute inset-0 rounded-lg"
          style={{
            // (the long-hand: the colour changes with a boost, and a shorthand would fight backgroundSize)
            backgroundImage: `repeating-linear-gradient(115deg, ${color} 0 10px, ${color}b0 10px 14px)`,
            backgroundSize: '28px 100%',
            animation: 'ty-stripes .45s linear infinite',
          }}
        />
      )}
      <div className="absolute inset-x-0 top-0 h-1/2 rounded-t-lg bg-white/[.08]" />
      <div className="relative flex h-full items-center justify-between gap-2 px-2.5 text-[12px] font-extrabold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{children}</div>
    </div>
  )
}

/** the bar's fill: where the round stood when it mounted sets its start, and the animation runs on from there (a
 *  later render must not move it, or the start would count twice) */
function Fill({ seconds, progress, loop, color }: { seconds: number; progress: number; loop: boolean; color: string }) {
  const [delay] = useState(() => -Math.min(0.999, progress) * seconds)
  return (
    <div
      className="ty-motion absolute inset-0 origin-left rounded-lg"
      style={{ background: `linear-gradient(180deg, ${color}, ${color}cc)`, animation: `ty-fill ${seconds}s linear ${delay}s ${loop ? 'infinite' : '1'} both` }}
    />
  )
}

/** a small count on a tab or a button */
export function Badge({ n, tone = 'gold' }: { n: number | string; tone?: 'gold' | 'green' | 'sky' | 'violet' }) {
  const bg = { gold: 'bg-gold text-[#2a1c00]', green: 'bg-accent text-[#032412]', sky: 'bg-sky text-[#03233a]', violet: 'bg-violet text-white' }[tone]
  return <span className={`tnum flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-black leading-none ${bg}`}>{n}</span>
}

/** a function that keeps one identity for the page's life but always runs the latest `fn` (handlers for the memoised
 *  rows, which the page draws a few times a second) */
export function useStable<A extends unknown[], R>(fn: (...a: A) => R) {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...a: A) => ref.current(...a), [])
}

/** memo's comparison, ignoring the props named (ones a component only reads as it mounts) */
export const sameBut =
  <P extends object>(...skip: (keyof P)[]) =>
  (a: P, b: P) =>
    (Object.keys(a) as (keyof P)[]).every((k) => skip.includes(k) || Object.is(a[k], b[k]))

/** setTimeout that is dropped if the page goes first */
export function useLater() {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const live = timers.current
    return () => live.forEach(clearTimeout)
  }, [])
  return useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])
}

/* ---------------- coins flying to the balance, and numbers rising ---------------- */

interface Flight {
  id: number
  x: number
  y: number
  dx: number
  dy: number
  n: number
}
interface Rise {
  id: number
  x: number
  y: number
  text: string
  color: string
}
let layer: { flights: Flight[]; rises: Rise[] } = { flights: [], rises: [] }
let nextId = 1
const subs = new Set<() => void>()
const put = (next: typeof layer) => {
  layer = next
  subs.forEach((f) => f())
}
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** the balance in the header (where paid coins land), or the top of the screen */
function balanceSpot() {
  const el = document.querySelector('header .tnum')
  const r = el?.getBoundingClientRect()
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, el: el as HTMLElement } : { x: window.innerWidth / 2, y: 28, el: null }
}

/** `n` coins burst from a point on the screen (viewport px) and sweep up into the header's balance, which bumps */
export function flyCoins(x: number, y: number, n = 10) {
  if (calm()) return
  const to = balanceSpot()
  const f = { id: nextId++, x, y, dx: to.x - x, dy: to.y - y, n: Math.max(3, Math.min(16, n)) }
  put({ ...layer, flights: [...layer.flights, f] })
  setTimeout(() => to.el?.parentElement?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' }), 820)
  setTimeout(() => put({ ...layer, flights: layer.flights.filter((g) => g.id !== f.id) }), 1600)
}

/** a short text ("+10", "+23.45") rising and fading from a point on the screen */
export function riseText(x: number, y: number, text: string, color: string) {
  const r = { id: nextId++, x, y, text, color }
  put({ ...layer, rises: [...layer.rises.slice(-6), r] })
  setTimeout(() => put({ ...layer, rises: layer.rises.filter((g) => g.id !== r.id) }), 1000)
}

/** the layer the coins fly and the numbers rise in, over everything; the page renders it once */
export function FlyLayer() {
  const { flights, rises } = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => layer,
  )
  useEffect(
    () => () => {
      layer = { flights: [], rises: [] }
    },
    [],
  )
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      {rises.map((r) => (
        <motion.span
          key={r.id}
          className="tnum absolute left-0 top-0 whitespace-nowrap text-[16px] font-black [text-shadow:0_2px_6px_rgba(0,0,0,.7)]"
          style={{ color: r.color }}
          initial={{ x: r.x, y: r.y, opacity: 0, scale: 0.7, translateX: '-50%' }}
          animate={{ y: r.y - 42, opacity: [0, 1, 1, 0], scale: 1 }}
          transition={{ duration: 0.95, ease: 'easeOut', opacity: { times: [0, 0.15, 0.65, 1], duration: 0.95 } }}
        >
          {r.text}
        </motion.span>
      ))}
      {flights.map((f) => (
        <div key={f.id} className="absolute" style={{ left: f.x, top: f.y }}>
          {Array.from({ length: f.n }, (_, i) => {
            // each coin bursts out a little way, then sweeps up into the balance
            const a = (i / f.n) * Math.PI * 2 + 0.4
            const ox = Math.cos(a) * (26 + (i % 3) * 10)
            const oy = Math.sin(a) * (18 + (i % 2) * 8) - 10
            return (
              <motion.span
                key={i}
                className="absolute -ml-2.5 -mt-2.5"
                initial={{ x: 0, y: 0, scale: 0.5, opacity: 0 }}
                animate={{ x: [0, ox, f.dx], y: [0, oy, f.dy], scale: [0.5, 1.1, 0.7], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 0.85, delay: i * 0.035, times: [0, 0.32, 1], ease: ['easeOut', [0.55, 0, 0.75, 0.3]], opacity: { duration: 0.85, delay: i * 0.035, times: [0, 0.1, 0.92, 1] } }}
              >
                <Coin size={20} />
              </motion.span>
            )
          })}
        </div>
      ))}
    </div>,
    document.body,
  )
}
