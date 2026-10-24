import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { oddsLabel, PAYTABLE } from './rules'
import { ItemGlyph } from './art'
import { ITEM_KINDS, type Feature, type ItemKind } from './types'
import { NAME, bestOf, headline, multText, tierOf } from './words'

/*
  What Coin Cascade shows over its machine.

  The win counter lives in the cabinet's display panel under the marquee (the machine says where it is on the stage,
  sometimes every frame while the camera pushes in, so the counter is placed and written directly, never through
  React): it rolls up as each thing lands in the tray, glows gold for a prize, and holds the last drop's win until the
  next coin goes in.

  The moments: COIN SHOWER! or QUAKE! slams in as the hopper tips or the machine shudders; once the last thing is in
  the tray the drop's banner (GOLD BAR! and what it paid, with what fell) rises over the machine, with confetti from
  the tray for a gem and up, and a golden flash for a bar; the Golden Idol and the Crown take the whole stage: rays,
  falling confetti, the prize itself, the coins counting up, until it is tapped or a few seconds pass. Under reduced
  motion all of it appears and goes without moving.
*/

const CONFETTI = ['#ffd45c', '#ff4fb8', '#3ff0e0', '#62cdff', '#ffffff', '#ffb547', '#9b7bff']

/* ---------------- the win counter ---------------- */

/** the display panel's counter: placed by the machine, rolled up by the page */
export class Roller {
  el: HTMLDivElement | null = null
  private shown = 0
  private target = 0
  private raf = 0
  private last = 0
  private box: { w: number; h: number } | null = null
  private text = ''
  private calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  /** where the display panel is (null: not up yet) */
  place(r: { x: number; y: number; w: number; h: number } | null) {
    const el = this.el
    if (!el) return
    if (!r || r.w < 8 || r.h < 4) {
      el.style.opacity = '0'
      this.box = null
      return
    }
    el.style.opacity = '1'
    el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`
    el.style.width = `${r.w}px`
    el.style.height = `${r.h}px`
    this.box = { w: r.w, h: r.h }
    this.fit()
  }
  /** rolls up to v */
  to(v: number) {
    this.target = v
    if (this.calm) return this.snap(v)
    if (!this.raf) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    }
  }
  /** shows v at once */
  snap(v: number) {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.shown = this.target = v
    this.write()
  }
  /** the counter's mood: 'idle' (teal), 'win' (bright), 'prize' (gold, pulsing) */
  mood(m: 'idle' | 'win' | 'prize') {
    if (this.el) this.el.dataset.mood = m
  }
  dispose() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }
  private tick = (t: number) => {
    const dt = Math.min(0.1, (t - this.last) / 1000)
    this.last = t
    const d = this.target - this.shown
    // most of the way in a quarter of a second or so (a prize's big jump takes a little longer to settle), then the tail
    const step = Math.max(Math.abs(d) * Math.min(1, dt * 6), dt * 0.6)
    this.shown = Math.abs(d) <= step ? this.target : this.shown + Math.sign(d) * step
    this.write()
    this.raf = this.shown === this.target ? 0 : requestAnimationFrame(this.tick)
  }
  private write() {
    const s = fmt(this.shown)
    if (s === this.text) return
    const longer = s.length !== this.text.length
    this.text = s
    const t = this.el?.firstElementChild as HTMLElement | null
    if (t) t.textContent = s
    if (longer) this.fit()
  }
  private fit() {
    const t = this.el?.firstElementChild as HTMLElement | null
    if (!t || !this.box) return
    const n = Math.max(4, this.text.length)
    t.style.fontSize = `${Math.max(8, Math.min(this.box.h * 0.72, (this.box.w * 0.92) / (n * 0.62))).toFixed(1)}px`
  }
}

/** the counter's element: the page hands it to its Roller */
export function WinDisplay({ roller }: { roller: Roller }) {
  return (
    <div
      ref={(el) => {
        roller.el = el
      }}
      data-mood="idle"
      className="pusher-display pointer-events-none absolute left-0 top-0 z-[5] flex items-center justify-center opacity-0"
      style={{ willChange: 'transform' }}
      aria-hidden
    >
      <span className="tnum font-mono font-black leading-none">0.00</span>
    </div>
  )
}

/** the styles the counter and the moments share (keyframes can't be written in a class name) */
export function HudStyles() {
  return (
    <style>{`
.pusher-display span { color: #5ff6ea; text-shadow: 0 0 8px rgba(60,240,220,.85), 0 0 2px rgba(60,240,220,.9); transition: color .25s }
.pusher-display[data-mood="win"] span { color: #b8fff6; text-shadow: 0 0 10px rgba(90,255,235,1), 0 0 3px #fff }
.pusher-display[data-mood="prize"] span { color: #ffe27a; text-shadow: 0 0 10px rgba(255,200,60,1), 0 0 3px #fff; animation: pusher-pulse .5s ease-in-out infinite alternate }
@keyframes pusher-pulse { to { filter: brightness(1.45) } }
@keyframes pusher-rays { to { transform: translate(-50%, -50%) rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .pusher-display[data-mood="prize"] span, .pusher-anim { animation: none !important } }
`}</style>
  )
}

/* ---------------- the moments ---------------- */

/** COIN SHOWER! / QUAKE! as it starts */
export function Callout({ kind }: { kind: Exclude<Feature, 'none'> }) {
  const calm = useReducedMotion()
  const quake = kind === 'quake'
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-[24%] z-30 flex justify-center px-3"
      initial={calm ? { opacity: 0 } : { opacity: 0, scale: 2.4, rotate: quake ? 0 : -6 }}
      animate={calm ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: quake ? [0, -3, 3, -2, 2, 0] : -4, x: quake ? [0, -8, 8, -6, 6, -3, 0] : 0 }}
      exit={{ opacity: 0, scale: calm ? 1 : 0.9, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 15, rotate: { duration: 0.6 }, x: { duration: 0.6 } }}
    >
      <div
        className="whitespace-nowrap text-center text-[34px] font-black italic uppercase leading-none tracking-tight sm:text-[54px]"
        style={{
          color: quake ? '#fff4c2' : '#7ff7ff',
          WebkitTextStroke: '2px #0b1033',
          textShadow: quake ? '0 5px 0 #0b1033, 0 0 34px rgba(255,90,60,.85)' : '0 5px 0 #0b1033, 0 0 34px rgba(63,240,224,.9)',
        }}
      >
        {quake ? 'Quake!' : 'Coin Shower!'}
      </div>
    </motion.div>
  )
}

export interface BannerInfo {
  id: string
  wins: Record<ItemKind, number>
  mult: number
  feature: Feature
  amount: number
}

/** the drop's result, once everything is in the tray */
export function WinBanner({ b }: { b: BannerInfo }) {
  const calm = useReducedMotion()
  const tier = tierOf(b)
  const best = bestOf(b.wins)
  const big = tier >= 2
  // pink for a gem, teal for a Shower or a Quake that brought no prize, gold for the rest
  const fill =
    best === 'gem'
      ? 'linear-gradient(180deg,#ffe0f3 0%,#ff7fcf 45%,#d22d8f 100%)'
      : b.feature !== 'none' && tier < 3
        ? 'linear-gradient(180deg,#e6fffd 0%,#6ff3ea 45%,#14a9b4 100%)'
        : 'linear-gradient(180deg,#fff6cf 0%,#ffd45c 45%,#f39b12 100%)'
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex justify-center px-3"
      initial={calm ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.6 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: calm ? 1 : 0.92, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 18 }}
    >
      <div className="flex flex-col items-center">
        {(tier >= 1 || b.feature !== 'none') && (
          <div
            className={`whitespace-nowrap bg-clip-text font-black uppercase italic leading-none tracking-tight text-transparent [filter:drop-shadow(0_3px_0_#0b1033)] ${big ? 'text-[30px] sm:text-[44px]' : 'text-[24px] sm:text-[32px]'}`}
            style={{ WebkitTextStroke: '1px rgba(11,16,51,.55)', backgroundImage: fill }}
          >
            {headline(b)}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2 rounded-full border-[3px] border-[#0b1033] bg-white py-1 pl-1.5 pr-4 shadow-[0_6px_0_rgba(11,16,51,.45)]">
          <span className="flex items-center gap-0.5 rounded-full bg-[#0b1033] px-1.5 py-0.5">
            {ITEM_KINDS.filter((k) => b.wins[k] > 0)
              .reverse()
              .map((k) => (
                <span key={k} className="flex items-center text-[12px] font-black text-white">
                  <ItemGlyph kind={k} size={18} />
                  {b.wins[k] > 1 && <span className="tnum -ml-0.5 mr-0.5">×{b.wins[k]}</span>}
                </span>
              ))}
          </span>
          <span className="tnum flex items-center gap-1.5 text-[18px] font-black text-[#0b1033] sm:text-[21px]">
            {fmt(b.amount)} <Coin size={19} />
          </span>
        </div>
      </div>
    </motion.div>
  )
}

/** confetti thrown up out of the tray */
export function Burst({ big }: { big: boolean }) {
  const n = big ? 34 : 22
  return (
    <div className="pointer-events-none absolute bottom-[14%] left-1/2 z-[25] h-0 w-0" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + ((i / (n - 1)) - 0.5) * 2.3 + (i % 3) * 0.06
        const d = (big ? 190 : 140) + (i % 5) * 34
        return (
          <motion.span
            key={i}
            className="absolute block rounded-[2px]"
            style={{ width: 6 + (i % 3) * 2, height: 9 + (i % 4) * 2, background: CONFETTI[i % CONFETTI.length], left: -4, top: -5 }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
            animate={{ x: [0, Math.cos(a) * d * 1.15], y: [0, Math.sin(a) * d, Math.sin(a) * d + 160], opacity: [1, 1, 0], rotate: (i % 2 ? 1 : -1) * 460, scale: 1 }}
            transition={{ duration: 1.5 + (i % 4) * 0.18, ease: 'easeOut', times: [0, 0.55, 1] }}
          />
        )
      })}
    </div>
  )
}

/** a golden flash over the stage, for a gold bar and up */
export function Flash() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_50%_70%,rgba(255,236,150,.8),rgba(255,180,60,.3)_45%,transparent_75%)]"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    />
  )
}

/** a number counting up from nothing */
function CountUp({ value, calm }: { value: number; calm: boolean }) {
  const mv = useMotionValue(calm ? value : 0)
  const text = useTransform(mv, (v) => fmt(v))
  useEffect(() => {
    if (calm) return mv.set(value)
    const c = animate(mv, value, { duration: 1.8, ease: [0.16, 1, 0.3, 1], delay: 0.45 })
    return c.stop
  }, [value, mv, calm])
  return <motion.span className="tnum">{text}</motion.span>
}

export interface PartyInfo {
  id: string
  wins: Record<ItemKind, number>
  mult: number
  amount: number
  feature: Feature
}

/** the Golden Idol or the Crown: the whole stage celebrates, until tapped (or Space) or a few seconds pass */
export function Party({ p, compact, quick, onDone }: { p: PartyInfo; compact: boolean; quick: boolean; onDone: () => void }) {
  const calm = !!useReducedMotion()
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const t = window.setTimeout(() => done.current(), quick ? 2600 : 5200)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        done.current()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [quick])
  const crown = p.wins.crown > 0
  const kind: ItemKind = crown ? 'crown' : 'idol'
  const both = p.wins.crown > 0 && p.wins.idol > 0
  const row = PAYTABLE.rows.find((r) => r.kind === kind)!
  const glow = crown ? 'rgba(255,90,200,.42)' : 'rgba(255,196,80,.42)'
  return (
    <motion.div
      className="absolute inset-0 z-[45] flex cursor-pointer items-center justify-center overflow-hidden"
      onClick={(e) => {
        e.stopPropagation()
        done.current()
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      data-party
    >
      <div className="absolute inset-0" style={{ background: `radial-gradient(closest-side, ${glow}, transparent), rgba(5,8,26,.9)` }} />
      <div
        className="pusher-anim absolute left-1/2 top-1/2 h-[240%] w-[240%] opacity-40"
        style={{
          transform: 'translate(-50%, -50%)',
          background: `repeating-conic-gradient(from 0deg, ${crown ? 'rgba(255,150,220,.5)' : 'rgba(255,226,140,.55)'} 0deg 8deg, transparent 8deg 20deg)`,
          animation: calm ? undefined : 'pusher-rays 24s linear infinite',
          maskImage: 'radial-gradient(closest-side, #000 18%, transparent)',
          WebkitMaskImage: 'radial-gradient(closest-side, #000 18%, transparent)',
        }}
      />
      {!calm &&
        Array.from({ length: 54 }, (_, i) => {
          const x = (i * 37) % 100
          const d = 1.9 + ((i * 13) % 10) / 6
          return (
            <motion.span
              key={i}
              className="absolute top-0 block rounded-[2px]"
              style={{ left: `${x}%`, width: 7 + (i % 3) * 2, height: 11 + (i % 4) * 2, background: CONFETTI[i % CONFETTI.length] }}
              initial={{ y: -30, rotate: 0, opacity: 1 }}
              animate={{ y: compact ? 640 : 900, rotate: (i % 2 ? 1 : -1) * (360 + i * 20), x: ((i % 5) - 2) * 26 }}
              transition={{ duration: d, delay: (i % 12) * 0.09, ease: 'easeIn' }}
            />
          )
        })}
      <div className="relative px-4 text-center">
        <motion.div className="mb-1 flex justify-center gap-2" initial={calm ? false : { y: -40, opacity: 0, scale: 0.4 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}>
          {both && <ItemGlyph kind="idol" size={compact ? 76 : 112} className="drop-shadow-[0_0_24px_rgba(255,200,80,.8)]" />}
          <ItemGlyph kind={kind} size={compact ? 92 : 136} className="drop-shadow-[0_0_28px_rgba(255,210,90,.85)]" />
        </motion.div>
        <motion.div
          className={`font-black italic uppercase leading-none tracking-tight ${compact ? 'text-[40px]' : 'text-[76px]'}`}
          style={{
            color: crown ? '#ffe39a' : '#ffd45c',
            WebkitTextStroke: compact ? '2px #2a1600' : '3px #2a1600',
            textShadow: `0 6px 0 #2a1600, 0 0 50px ${crown ? 'rgba(255,120,210,.75)' : 'rgba(255,212,92,.75)'}`,
          }}
          initial={calm ? false : { scale: 3, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: -4 }}
          transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        >
          {both ? 'Crown and Idol!' : crown ? 'The Crown!' : 'Golden Idol!'}
        </motion.div>
        <motion.div
          className={`tnum mt-3 flex items-center justify-center gap-2 font-black text-white ${compact ? 'text-[30px]' : 'text-[46px]'}`}
          style={{ textShadow: '0 3px 0 rgba(0,0,0,.5)' }}
          initial={calm ? false : { y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          +<CountUp value={p.amount} calm={calm} /> <Coin size={compact ? 26 : 38} />
        </motion.div>
        <div className={`mt-1.5 font-black text-white/80 ${compact ? 'text-[13px]' : 'text-[17px]'}`}>
          {multText(p.mult)} your stake · {NAME[kind]} {oddsLabel(row.chance).toLowerCase()} drops
        </div>
        <div className={`mt-3 font-bold text-white/45 ${compact ? 'text-[11px]' : 'text-[12.5px]'}`}>Tap to carry on</div>
      </div>
    </motion.div>
  )
}
