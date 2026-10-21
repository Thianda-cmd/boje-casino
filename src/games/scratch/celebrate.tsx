import { useEffect, useRef, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { scratchSfx } from './sound'
import { CARDS, multLabel, tierTitle, winTier, type CardId, type SymbolId } from './rules'
import { THEMES } from './cardart'
import { SymbolArt } from './symbols'
import { flyCoins, type Fx } from './fx'

/*
  The big win (50× or more) and the jackpot, over the whole stage. A big win dims the stage, pops the winning symbol,
  slams the title in and rolls the amount up with odometer ticks to a ka-ching. A mega win or the card's top prize goes
  further first: the three winning symbols lift off the card, gather in the middle and fuse with a flash, a shockwave
  and a jolt of the whole stage. Either way the coins then fly from the counter into the balance in the header, and
  the card pays at that moment (onSettle), so the header never runs ahead of the count. A click, a tap or Space skips
  to the end (and pays at once).
*/

export interface Party {
  key: number
  id: CardId
  /** the winning symbol */
  sym: SymbolId
  mult: number
  amount: number
  /** the card's top prize (its jackpot symbol) */
  top: boolean
  /** the most the card can pay */
  max: boolean
  /** the three winners' boxes, stage-local */
  cells: { x: number; y: number; w: number; h: number }[]
}

type Phase = 'dim' | 'lift' | 'gather' | 'fuse' | 'show' | 'count' | 'landed' | 'fly'

export function Celebration({ party, fx, phone, desk, quick, stage, onSettle, onClose }: { party: Party; fx: Fx | null; phone: boolean; desk: boolean; quick: boolean; stage: HTMLElement | null; onSettle: () => void; onClose: () => void }) {
  const t = THEMES[party.id]
  const tier = winTier(party.mult)
  const full = party.top || party.mult >= 250
  const k = quick ? 0.62 : 1
  const [phase, setPhase] = useState<Phase>('dim')
  const [box, setBox] = useState({ w: 800, h: 600 })
  const numRef = useRef<HTMLSpanElement>(null)
  const settled = useRef(false)
  const closed = useRef(false)
  const timers = useRef<number[]>([])
  const stops = useRef<(() => void)[]>([])
  const cb = useRef({ onSettle, onClose })
  cb.current = { onSettle, onClose }

  const settle = () => {
    if (settled.current) return
    settled.current = true
    cb.current.onSettle()
  }
  const close = () => {
    if (closed.current) return
    closed.current = true
    settle()
    cb.current.onClose()
  }

  useEffect(() => {
    const r = stage?.getBoundingClientRect()
    if (r) setBox({ w: r.width, h: r.height })
    let live = true
    // nothing is scheduled once the celebration is gone (cancelling the coins in flight calls back into here)
    const at = (ms: number, f: () => void) => live && timers.current.push(window.setTimeout(f, ms * k))
    const show = full ? 1300 : 260
    if (full) {
      at(90, () => setPhase('lift'))
      at(480, () => {
        setPhase('gather')
        scratchSfx.gather()
      })
      at(1040, () => setPhase('fuse'))
    }
    at(show, () => {
      setPhase('show')
      const cx = (r?.left ?? 0) + (r?.width ?? 800) / 2
      const cy = (r?.top ?? 0) + (r?.height ?? 600) * 0.4
      if (full) {
        scratchSfx.boom()
        // the shockwave and the jolt
        fx?.ring(cx, cy, Math.min(r?.width ?? 600, 700) * 0.55, '#ffffff', 0.7)
        fx?.ring(cx, cy, Math.min(r?.width ?? 600, 700) * 0.4, t.win, 0.9)
        stage?.animate?.(
          [
            { transform: 'translate(0,0)' },
            { transform: 'translate(-7px,5px)' },
            { transform: 'translate(6px,-6px)' },
            { transform: 'translate(-4px,3px)' },
            { transform: 'translate(3px,-2px)' },
            { transform: 'translate(0,0)' },
          ],
          { duration: 460, easing: 'ease-out' },
        )
      }
      fx?.coins(cx, cy, full ? 44 : 26, full ? 1.35 : 1.1)
      fx?.confetti(full ? 70 : 40, t.confetti, { cx, cy })
      fx?.shower(full ? 5 : 2.5, t.confetti)
      scratchSfx.jackpot(party.id, tier)
    })
    // the count, then the coins to the balance
    const D = full ? (party.top || party.mult >= 1000 ? 3500 : 2800) : 1900
    at(show + 420, () => {
      setPhase('count')
      const el = numRef.current
      if (!el) return
      let last = 0
      const c = animate(0, party.amount, {
        duration: (D * k) / 1000,
        ease: [0.22, 0.6, 0.3, 1],
        onUpdate: (v) => {
          el.textContent = fmt(v)
          const now = performance.now()
          if (now - last > 55) {
            last = now
            scratchSfx.tick(v / party.amount)
          }
        },
        onComplete: () => {
          el.textContent = fmt(party.amount)
          scratchSfx.kaching()
          setPhase('landed')
        },
      })
      stops.current.push(() => c.stop())
    })
    at(show + 420 + D + 750, () => {
      setPhase('fly')
      const from = numRef.current?.getBoundingClientRect()
      const target = document.querySelector('header .tnum')?.getBoundingClientRect()
      if (!from || !target || target.width === 0) {
        settle()
        at(500, close)
        return
      }
      let first = true
      const cancel = flyCoins(
        { x: from.left + from.width / 2, y: from.top + from.height / 2 },
        { x: target.left + target.width / 2, y: target.top + target.height / 2 },
        phone ? 12 : 16,
        () => {
          scratchSfx.coin()
          if (first) {
            first = false
            settle()
          }
        },
        () => at(260, close),
      )
      stops.current.push(cancel)
    })
    return () => {
      live = false
      timers.current.forEach(clearTimeout)
      timers.current = []
      stops.current.forEach((s) => s())
      stops.current = []
      fx?.stopShower()
    }
    // the sequence runs once per party
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Space or Enter skips too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat) close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cx = box.w / 2
  const cy = box.h * 0.4
  const symSize = full ? (phone ? 118 : 156) : phone ? 92 : 116
  const kicker = party.top ? (party.max && party.id === 'fruit' ? 'Grand jackpot' : 'Jackpot') : null
  const title = tierTitle(party.mult)
  const shown = phase === 'show' || phase === 'count' || phase === 'landed' || phase === 'fly'
  const cloneSize = phone ? 64 : 84

  return (
    <>
      {/* under the particles: the dark, the rays and the flash */}
      <motion.div className="absolute inset-0 z-30 cursor-pointer overflow-hidden" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 42%, rgba(8,12,26,.74) 0%, rgba(3,6,14,.95) 72%)' }} />
        <motion.div
          className="pointer-events-none absolute left-1/2 top-[40%] h-[200vmax] w-[200vmax]"
          style={{
            background: `repeating-conic-gradient(from 0deg, ${t.win}40 0deg 8deg, transparent 8deg 20deg)`,
            animation: 'scr-rays 30s linear infinite',
            transform: 'translate(-50%,-50%)',
            maskImage: 'radial-gradient(circle, #000 0%, transparent 40%)',
            WebkitMaskImage: 'radial-gradient(circle, #000 0%, transparent 40%)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: shown ? 1 : 0.25 }}
          transition={{ duration: 0.5 }}
        />
        {shown && (
          <motion.div
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(circle at 50% 40%, #fffbe6 0%, ${t.win}aa 30%, transparent 70%)` }}
            initial={{ opacity: full ? 1 : 0.6 }}
            animate={{ opacity: 0 }}
            transition={{ duration: full ? 0.9 : 0.6, ease: 'easeOut' }}
          />
        )}
      </motion.div>

      {/* over the particles: the symbols, the title and the count */}
      <motion.div
        className="absolute inset-0 z-50 cursor-pointer overflow-hidden"
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.35 } }}
        role="dialog"
        aria-label={`${kicker ? `${kicker}, ` : ''}${title}: ${fmt(party.amount)} coins, ${multLabel(party.mult)}`}
      >
        {/* the three winners lift off the card, gather and fuse */}
        {full &&
          party.cells.map((c, i) => {
            const a = -Math.PI / 2 + (i * Math.PI * 2) / 3
            const gx = cx + Math.cos(a) * (phone ? 62 : 84) - cloneSize / 2
            const gy = cy + Math.sin(a) * (phone ? 62 : 84) - cloneSize / 2
            const sx = c.x + c.w / 2 - cloneSize / 2
            const sy = c.y + c.h / 2 - cloneSize / 2
            const s0 = (c.w * 0.72) / cloneSize
            const target =
              phase === 'dim'
                ? { x: sx, y: sy, scale: s0, rotate: 0, opacity: 1 }
                : phase === 'lift'
                  ? { x: sx, y: sy - 14, scale: s0 * 1.25, rotate: 0, opacity: 1 }
                  : phase === 'gather'
                    ? { x: gx, y: gy, scale: 1.05, rotate: 360, opacity: 1 }
                    : phase === 'fuse'
                      ? { x: cx - cloneSize / 2, y: cy - cloneSize / 2, scale: 0.5, rotate: 540, opacity: 1 }
                      : { x: cx - cloneSize / 2, y: cy - cloneSize / 2, scale: 0.3, rotate: 540, opacity: 0 }
            return (
              <motion.div
                key={i}
                className="pointer-events-none absolute left-0 top-0"
                style={{ width: cloneSize, height: cloneSize, filter: 'drop-shadow(0 14px 14px rgba(0,0,0,.5))' }}
                initial={{ x: sx, y: sy, scale: s0, opacity: 0 }}
                animate={target}
                transition={
                  phase === 'gather'
                    ? { duration: 0.5 * k, ease: [0.4, 0, 0.2, 1], delay: i * 0.04 }
                    : phase === 'fuse'
                      ? { duration: 0.24 * k, ease: [0.6, 0, 0.9, 0.4] }
                      : { duration: 0.32 * k, ease: [0.2, 0.8, 0.3, 1] }
                }
              >
                <SymbolArt sym={party.sym} size={cloneSize} />
              </motion.div>
            )
          })}

        {shown && (
          <div className="pointer-events-none absolute left-0 right-0 flex flex-col items-center px-4 text-center" style={{ top: cy - symSize * 0.62 }}>
            {/* the symbol in its halo */}
            <motion.div className="relative" initial={{ scale: 0.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 13 }}>
              <div className="absolute left-1/2 top-1/2 h-[175%] w-[175%] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `radial-gradient(closest-side, ${t.win}99, ${t.win}00)` }} />
              <motion.div animate={{ y: [0, -6, 0], rotate: [-3, 3, -3] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
                <SymbolArt sym={party.sym} size={symSize} className="relative drop-shadow-[0_12px_18px_rgba(0,0,0,.55)]" />
              </motion.div>
            </motion.div>
            {kicker && (
              <motion.div
                className="relative mt-1 whitespace-nowrap rounded-full px-4 py-1 text-[13px] font-extrabold uppercase tracking-[.3em] text-[#2a1600] sm:text-[15px]"
                style={{ background: 'linear-gradient(180deg,#fff3b0,#ffc83a 55%,#e08a0c)', boxShadow: '0 4px 0 rgba(90,45,0,.55), 0 0 24px rgba(255,200,60,.5)', paddingLeft: 'calc(1rem + .3em)' }}
                initial={{ scale: 0, rotate: -8 }}
                animate={{ scale: 1, rotate: -2 }}
                transition={{ type: 'spring', stiffness: 420, damping: 14, delay: 0.08 }}
              >
                {kicker}
              </motion.div>
            )}
            <motion.div
              className="mt-1 whitespace-nowrap bg-clip-text font-extrabold uppercase leading-none tracking-tight text-transparent"
              style={{
                // as big as the stage allows for the title's length
                fontSize: Math.min(full ? (phone ? 50 : 84) : phone ? 44 : 68, (box.w - 36) / (title.length * 0.66)),
                backgroundImage: 'linear-gradient(100deg,#fff6cf 0%,#ffd45c 28%,#ffffff 44%,#ffd45c 58%,#f39b12 100%)',
                backgroundSize: '200% 100%',
                animation: 'scr-shine 2.6s linear infinite',
                filter: `drop-shadow(0 5px 0 rgba(60,30,0,.55)) drop-shadow(0 0 22px ${t.win}66)`,
                WebkitTextStroke: '1px rgba(90,45,0,.35)',
              }}
              initial={{ scale: 2.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 22, delay: 0.14 }}
            >
              {title}
            </motion.div>
            <motion.div
              className="mt-4 flex items-center gap-2.5 rounded-full border-[3px] py-2 pl-2.5 pr-5 shadow-[0_14px_34px_-10px_rgba(0,0,0,.8)]"
              style={{ borderColor: t.win, background: 'rgba(8,12,24,.92)' }}
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1, scale: phase === 'landed' ? [1, 1.12, 1] : 1 }}
              transition={{ duration: 0.35 }}
            >
              <span className="tnum rounded-full px-3 py-0.5 text-[16px] font-extrabold text-[#1a1000] sm:text-[19px]" style={{ background: t.win }}>
                {multLabel(party.mult)}
              </span>
              <span className="flex items-center gap-1.5 text-[26px] font-extrabold text-white sm:text-[36px]">
                <span ref={numRef} className="tnum">
                  {fmt(0)}
                </span>
                <Coin size={phone ? 24 : 30} />
              </span>
            </motion.div>
            <div className="mt-2 text-[12px] font-bold text-white/55">{CARDS[party.id].name}</div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[11.5px] font-semibold uppercase tracking-[.2em] text-white/45">{desk ? 'Click or press Space to skip' : 'Tap to skip'}</div>
      </motion.div>
    </>
  )
}
