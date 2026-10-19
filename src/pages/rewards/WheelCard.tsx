/*
  The Lucky Wheel: one spin a day once all three daily missions are claimed.

  The prize is drawn by the wallet the moment Spin is pressed (spinWheel) and kept there until it is collected, so the
  wheel is only ever showing a result that already exists: it winds back a touch, lets go, runs five turns and crawls
  past the last pegs to stop inside the drawn segment (never on a divider), then settles. The result shows the moment
  the wheel looks stopped, not after the settle. The balance only moves when the player collects, so it can't spoil
  the result while the wheel turns. A spin left waiting (the page closed mid-spin) comes back already stopped on its
  prize, with Collect.

  Every peg the pointer passes ticks it aside and clicks, faster and brighter at speed, slowing with the wheel. The
  bulbs round the rim are off while the wheel is locked, chase slowly when it is ready, race while it spins and flash
  for the win. The celebration grows with the prize: coins for every win, a second spray and a longer flash from 300,
  gold rings pulsing off the rim from 500, and a shower of coins over the card for the 1,000. With reduced motion the
  wheel jumps straight to its prize, without the sprays.

  Below the desktop layout a locked or finished wheel shrinks beside its note: there's nothing to do with it then, and
  it would otherwise take a phone's whole screen.
*/
import { memo, useEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from 'framer-motion'
import { WHEEL_MEAN, WHEEL_PRIZES, dayKey, msToMidnight, wheelChance } from '../../store/rewards'
import { missionsToday, useWallet, type WheelSpin } from '../../store/wallet'
import { POINTER_ORIGIN, WheelDisc, WheelFrame, WheelGloss, WheelLights, WheelPointer, type WheelSegment } from '../../art/LuckyWheel'
import { Coin, IconCheck, IconLock } from '../../components/icons'
import { fmt, fmtDuration } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { useNow } from '../../lib/useNow'
import { ClaimButton, EASE, Eyebrow, IconWheel, Popover, burstFrom, nb, showerOver, useLater } from './kit'
import { useWheelUi } from './ready'

/** the prizes round the wheel, by position (index into WHEEL_PRIZES): the 1,000 at the top, big and small alternating */
const ORDER = [7, 0, 4, 1, 6, 2, 5, 3]
const SEG = 360 / ORDER.length
const COLORS: Record<number, string> = { 50: '#3f78e0', 75: '#13a9a3', 100: '#28b35f', 150: '#8b5cf6', 200: '#e0469a', 300: '#f07a2e', 500: '#e03a52', 1000: '#f1b52c' }
const SEGMENTS: WheelSegment[] = ORDER.map((i) => {
  const a = WHEEL_PRIZES[i].amount
  return { label: fmt(a, 0), color: COLORS[a], coins: a >= 1000 ? 4 : a >= 300 ? 3 : a >= 150 ? 2 : 1 }
})
const TURNS = 5
const SPIN_MS = 6200
/** how far the wheel runs past its resting point before settling back into the slot */
const OVERSHOOT = 2.4
/** the result shows once the wheel is this close to stopping: it reads as stopped from here */
const REVEAL_WITHIN = 1.5

/** the disc's rotation that puts prize `index` under the pointer (plus `offset` degrees inside its segment) */
const restAngle = (index: number, offset = 0) => -ORDER.indexOf(index) * SEG + offset

type Lights = 'off' | 'idle' | 'race' | 'flash' | 'glow'
type View = 'spinning' | 'landed' | 'ready' | 'done' | 'locked'

/** memoised: the missions card around it re-renders every second for its countdown, and the wheel needn't */
export const WheelCard = memo(function WheelCard() {
  // a slow clock is enough here: it only notices the day turning over (the footer keeps its own for the countdowns)
  const now = useNow(10_000)
  const reduce = useReducedMotion()
  const missions = useWallet((s) => s.missions)
  const wheelSpin = useWallet((s) => s.wheelSpin)
  const rewardLog = useWallet((s) => s.rewardLog)
  const m = missionsToday(missions, dayKey(now))
  const claimed = m.claimed.filter(Boolean).length
  // today's prize once collected, from the history (to rest the wheel on it and say what it paid)
  const todayPrize = m.wheel === 'spun' && !wheelSpin ? (rewardLog ?? []).find((e) => e.kind === 'wheel' && dayKey(e.time) === m.day) : undefined
  const prizeIndex = (amount: number) => WHEEL_PRIZES.findIndex((p) => p.amount === amount)

  const rot = useMotionValue(wheelSpin ? restAngle(wheelSpin.index) : todayPrize ? restAngle(prizeIndex(todayPrize.amount)) : 0)
  const pointer = useMotionValue(0)
  const [spinning, setSpinning] = useState(false)
  // the spin that just finished on this page (it gets the celebration); a spin found waiting doesn't
  const [fresh, setFresh] = useState<WheelSpin | null>(null)
  const [flashing, setFlashing] = useState(false)
  const [rings, setRings] = useState(0)
  const [unlocking, setUnlocking] = useState(false)
  // the rotation the labels read the right way up at: where the wheel rests (re-aimed mid-spin for where it will stop)
  const [upright, setUpright] = useState(() => rot.get())
  const [said, setSaid] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const wheel = useRef<HTMLDivElement>(null)
  const spinCtl = useRef<AnimationPlaybackControls | null>(null)
  const flickCtl = useRef<AnimationPlaybackControls | null>(null)
  const live = useRef(true)
  const later = useLater()

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      spinCtl.current?.stop()
      flickCtl.current?.stop()
      useWheelUi.setState({ spinning: false })
    }
  }, [])

  // the last mission claimed while the page is open: the wheel wakes up
  const prevWheel = useRef(m.wheel)
  useEffect(() => {
    if (prevWheel.current === 'locked' && m.wheel === 'ready') {
      setUnlocking(true)
      const t = setTimeout(() => setUnlocking(false), 1400)
      prevWheel.current = m.wheel
      return () => clearTimeout(t)
    }
    prevWheel.current = m.wheel
  }, [m.wheel])

  /** the wheel has stopped on `s`: show it, sound it and celebrate it, more for more */
  const reveal = (s: WheelSpin) => {
    if (!live.current) return
    useWheelUi.setState({ spinning: false })
    setSpinning(false)
    setFresh(s)
    setSaid(`The wheel landed on ${fmt(s.amount, 0)}. You won ${fmt(s.amount, 0)} coins.`)
    sfx.rewards.land()
    later(() => sfx.rewards.prize(s.amount), 240)
    setFlashing(true)
    later(() => setFlashing(false), s.amount >= 500 ? 6000 : s.amount >= 300 ? 3200 : 1600)
    burstFrom(wheel.current, s.amount >= 300 ? 2.5 : 2, 120)
    if (s.amount >= 300) burstFrom(wheel.current, 1.6, 480)
    if (s.amount >= 500) setRings((r) => r + 1)
    if (s.amount >= 1000) showerOver(card.current, 300)
  }

  const spin = () => {
    if (spinning) return
    let s = useWallet.getState().spinWheel()
    if (!s) return
    // dev only: window.__wheelForce = <prize index> lands the next spin on that prize, for checking each fanfare
    const force = import.meta.env.DEV ? (window as unknown as { __wheelForce?: number }).__wheelForce : undefined
    if (force != null && WHEEL_PRIZES[force]) {
      s = { index: force, amount: WHEEL_PRIZES[force].amount }
      useWallet.setState({ wheelSpin: s })
    }
    const won = s
    useWheelUi.setState({ spinning: true })
    setSpinning(true)
    setFresh(null)
    setSaid('Spinning the Lucky Wheel.')
    sfx.rewards.spin()
    // somewhere inside the segment, clear of its dividers (and of the little settle at the end)
    const offset = (Math.random() - 0.5) * SEG * 0.56
    const cur = rot.get()
    const delta = (((restAngle(won.index, offset) - cur) % 360) + 360) % 360
    const target = cur + delta + 360 * TURNS
    if (reduce) {
      rot.set(target)
      setUpright(target)
      reveal(won)
      return
    }
    let lastPeg = Math.floor((cur + SEG / 2) / SEG)
    let lastV = cur
    let lastT = performance.now()
    let aimed = false
    let shown = false
    spinCtl.current = animate(rot, [cur, cur - 16, target + OVERSHOOT, target], {
      duration: SPIN_MS / 1000,
      times: [0, 0.08, 0.95, 1],
      // a slow wind back, a quick let-go that fades into a long crawl, and a gentle settle back into the slot
      ease: [
        [0.45, 0, 0.55, 1],
        [0.3, 0.62, 0.2, 1],
        [0.45, 0, 0.55, 1],
      ],
      onUpdate: (v) => {
        if (!live.current) return
        const t = performance.now()
        const speed = Math.abs(v - lastV) / Math.max(1, t - lastT)
        lastV = v
        lastT = t
        // turn the labels over for where the wheel will stop while it's too fast to read
        if (!aimed && speed > 0.5) {
          aimed = true
          setUpright(target)
        }
        if (!shown && v > cur && target + OVERSHOOT - v < REVEAL_WITHIN) {
          shown = true
          reveal(won)
        }
        const peg = Math.floor((v + SEG / 2) / SEG)
        if (peg === lastPeg) return
        // a peg went past: tick the pointer the way the peg was moving (clockwise flicks the tip to the right)
        const dir = peg > lastPeg ? -1 : 1
        lastPeg = peg
        const k = Math.min(1, speed / 1.4)
        sfx.rewards.tick(k)
        flickCtl.current = animate(pointer, [dir * (12 + 16 * k), 0], { duration: 0.18, ease: 'easeOut' })
      },
      onComplete: () => {
        if (!aimed) setUpright(target)
        if (!shown) reveal(won)
      },
    })
  }

  const collect = () => {
    const got = useWallet.getState().collectWheel()
    if (!got) return
    sfx.rewards.collect(2)
    setSaid(`Collected ${fmt(got, 0)} coins.`)
    useWallet.getState().pushToast({ kind: 'reward', title: 'Lucky Wheel prize collected', amount: got })
  }

  // what the wheel is doing, in order of precedence
  const view: View = spinning ? 'spinning' : wheelSpin ? 'landed' : m.wheel === 'ready' ? 'ready' : m.wheel === 'spun' ? 'done' : 'locked'
  const shown = wheelSpin ?? (todayPrize ? { index: prizeIndex(todayPrize.amount), amount: todayPrize.amount } : null)
  const lit = view === 'landed' || view === 'done' ? (shown ? ORDER.indexOf(shown.index) : null) : null
  const lights: Lights = view === 'locked' ? 'off' : view === 'spinning' ? 'race' : view === 'landed' && fresh && flashing ? 'flash' : view === 'done' || view === 'landed' ? 'glow' : 'idle'
  // nothing to do with a locked or finished wheel: below the desktop layout it shrinks beside its note
  const small = view === 'locked' || view === 'done'

  return (
    <div id="lucky-wheel" ref={card} className="relative flex h-full scroll-mt-4 flex-col items-center">
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
      <div className="flex w-full items-center justify-between gap-2">
        <Eyebrow className="text-[#ff7ab8]">
          <IconWheel size={18} /> Lucky Wheel
        </Eyebrow>
        <PrizeOdds />
      </div>

      <div className={`flex w-full flex-col items-center ${small ? 'max-lg:flex-row max-lg:gap-4 sm:max-lg:gap-6' : ''}`}>
        <motion.div
          ref={wheel}
          className={`relative mt-3 aspect-square w-full max-w-[300px] sm:max-w-[320px] xl:max-w-[340px] ${small ? 'max-lg:w-[42%] max-lg:max-w-[190px] max-lg:shrink-0' : ''}`}
          animate={unlocking && !reduce ? { scale: [1, 1.06, 0.98, 1] } : { scale: 1 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          <div className="absolute inset-[2%] rounded-full shadow-[0_26px_50px_-18px_rgba(0,0,0,.9)]" />
          <div className={`absolute inset-0 transition-[filter] duration-700 ${view === 'locked' ? 'brightness-[.82] saturate-[.6]' : ''}`}>
            <WheelFrame size="100%" />
            <BulbLights mode={reduce && lights !== 'off' ? 'glow' : lights} />
            <motion.div className="absolute inset-0 will-change-transform" style={{ rotate: rot }}>
              <WheelDisc size="100%" segments={SEGMENTS} lit={lit} upright={upright} />
            </motion.div>
            <WheelGloss size="100%" />
            <motion.div className="absolute inset-0" style={{ rotate: pointer, transformOrigin: POINTER_ORIGIN }}>
              <WheelPointer size="100%" />
            </motion.div>
          </div>

          {/* a top prize: gold rings pulse off the rim */}
          {!reduce &&
            rings > 0 &&
            [0, 1, 2].map((k) => (
              <motion.span
                key={`${rings}-${k}`}
                className="pointer-events-none absolute inset-[3%] rounded-full ring-[5px] ring-gold/80"
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1.22, opacity: [0, 0.9, 0] }}
                transition={{ duration: 1.1, delay: 0.15 + k * 0.32, ease: 'easeOut' }}
              />
            ))}

          {/* the middle: a lock, a SPIN button, or the prize */}
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="popLayout">
              {view === 'locked' && (
                <motion.span
                  key="lock"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.4, opacity: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="flex h-[22%] w-[22%] items-center justify-center rounded-full bg-[#120b30]/90 text-[#cdbfff] shadow-[0_6px_18px_-4px_rgba(0,0,0,.8)] ring-2 ring-white/15"
                >
                  <IconLock size={small ? 18 : 22} />
                </motion.span>
              )}
              {view === 'ready' && (
                <motion.button
                  key="spin"
                  onClick={spin}
                  aria-label="Spin the Lucky Wheel"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                  className="glow-pulse flex h-[25%] w-[25%] items-center justify-center rounded-full bg-[radial-gradient(circle_at_40%_30%,#fff3c4,#f7c548_55%,#b97c12)] text-[15px] font-black tracking-wide text-[#3a2400] ring-[3px] ring-[#7a4d08] sm:text-[16px]"
                >
                  SPIN
                </motion.button>
              )}
              {view === 'landed' && shown && (
                <motion.div
                  key={`prize${shown.amount}`}
                  initial={{ scale: 0.3, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 16, delay: fresh ? 0.12 : 0 }}
                  className="flex h-[40%] w-[40%] flex-col items-center justify-center rounded-full bg-[radial-gradient(circle_at_50%_32%,#2a1c66,#120b30)] shadow-[0_12px_30px_-8px_rgba(0,0,0,.9),0_0_0_3px_#f7c548,0_0_36px_-4px_rgba(247,197,72,.7)]"
                >
                  <span className="text-[10px] font-extrabold uppercase tracking-[.14em] text-gold/80 sm:text-[11px]">You won</span>
                  <span className="tnum text-[26px] font-black leading-none tracking-tight text-gold sm:text-[30px]">{fmt(shown.amount, 0)}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-muted">
                    <Coin size={12} /> coins
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <WheelFooter view={view} small={small} claimed={claimed} shown={shown} fresh={!!fresh} onSpin={spin} onCollect={collect} />
      </div>
    </div>
  )
})

/** What the wheel's state means and the one thing to do about it. */
function WheelFooter({
  view,
  small,
  claimed,
  shown,
  fresh,
  onSpin,
  onCollect,
}: {
  view: View
  small: boolean
  claimed: number
  shown: WheelSpin | null
  fresh: boolean
  onSpin: () => void
  onCollect: () => void
}) {
  const now = useNow(1000)
  const resets = nb(fmtDuration(msToMidnight(now)))
  const prizeLine = (amount: number) => (amount >= 1000 ? 'The top prize. What a spin!' : amount >= 500 ? 'A top prize. Nicely done.' : amount >= 300 ? 'A big one. Collect it into your balance.' : 'Collect it into your balance.')
  return (
    <div className={`mt-4 flex w-full flex-col items-center text-center ${small ? 'max-lg:mt-3 max-lg:min-w-0 max-lg:flex-1 max-lg:items-start max-lg:text-left' : ''}`}>
      {view === 'locked' && (
        <>
          <div className="text-[17px] font-black tracking-tight">Locked for now</div>
          <p className="mt-0.5 max-w-[300px] text-pretty text-[13px] text-muted">Claim all three of today's missions to unlock one free spin.</p>
          <div className="mt-3 flex items-center gap-2" role="img" aria-label={`${claimed} of 3 missions claimed`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 ${i < claimed ? 'bg-accent text-[#032412] ring-accent' : 'bg-stage text-dim ring-white/10'}`}>
                {i < claimed ? <IconCheck size={14} /> : <span className="tnum text-[11px] font-extrabold">{i + 1}</span>}
              </span>
            ))}
            <span className="tnum ml-1 text-[13px] font-bold text-muted max-sm:hidden">{claimed} / 3</span>
          </div>
        </>
      )}
      {view === 'ready' && (
        <>
          <div className="text-[17px] font-black tracking-tight">Your spin is ready</div>
          <p className="mt-0.5 text-[13px] text-muted">50 to 1,000 coins, about {Math.round(WHEEL_MEAN)} on average.</p>
          <ClaimButton ready onClick={onSpin} className="mt-3 h-12 w-full max-w-[300px]" burst={0}>
            Spin the wheel
          </ClaimButton>
        </>
      )}
      {view === 'spinning' && (
        <>
          <div className="text-[17px] font-black tracking-tight">Round and round…</div>
          <p className="mt-0.5 text-[13px] text-muted">Your prize is already drawn. Let's see it.</p>
          <ClaimButton ready={false} onClick={() => {}} className="mt-3 h-12 w-full max-w-[300px]">
            Spinning…
          </ClaimButton>
        </>
      )}
      {view === 'landed' && shown && (
        <>
          <div className="text-[17px] font-black tracking-tight">{fresh ? `${fmt(shown.amount, 0)} coins!` : 'Your prize is waiting'}</div>
          <p className="mt-0.5 text-[13px] text-muted">{fresh ? prizeLine(shown.amount) : `Your last spin landed on ${fmt(shown.amount, 0)}.`}</p>
          <ClaimButton ready onClick={onCollect} className="mt-3 h-12 w-full max-w-[300px]" burst={1.5}>
            <Coin size={18} /> Collect {fmt(shown.amount, 0)} coins
          </ClaimButton>
        </>
      )}
      {view === 'done' && (
        <>
          <div className="text-[17px] font-black tracking-tight">{shown ? `Today's spin paid ${fmt(shown.amount, 0)}` : 'Spun for today'}</div>
          <p className="mt-0.5 text-pretty text-[13px] text-muted">New missions and a new spin in {resets}.</p>
          <div className={`mt-3 flex h-11 w-full max-w-[300px] items-center justify-center gap-1.5 rounded-xl bg-accent/10 text-[14px] font-bold text-accent ${small ? 'max-lg:w-auto max-lg:px-4' : ''}`}>
            <IconCheck size={16} /> Collected
          </div>
        </>
      )}
    </div>
  )
}

/** The bulbs round the rim: two alternating sets, faded in turn (each its own layer, so nothing repaints). */
const BulbLights = memo(function BulbLights({ mode }: { mode: Lights }) {
  if (mode === 'off') return null
  const cycle = mode === 'race' ? 0.2 : mode === 'flash' ? 0.5 : 1.6
  const anim = (phase: 0 | 1) => {
    if (mode === 'glow') return { opacity: 0.75 }
    if (mode === 'flash') return { opacity: [1, 0.15, 1] }
    return { opacity: phase === 0 ? [1, 0.2, 1] : [0.2, 1, 0.2] }
  }
  return (
    <>
      {([0, 1] as const).map((phase) => (
        <motion.div
          key={`${mode}${phase}`}
          className="absolute inset-0 will-change-[opacity]"
          initial={{ opacity: 0 }}
          animate={anim(phase)}
          transition={mode === 'glow' ? { duration: 0.6 } : { duration: cycle, repeat: Infinity, ease: 'easeInOut' }}
        >
          <WheelLights size="100%" phase={phase} />
        </motion.div>
      ))}
    </>
  )
})

/** "Prizes": every prize with its honest chance, in a small popover. */
function PrizeOdds() {
  const top = Math.max(...WHEEL_PRIZES.map((_, i) => wheelChance(i)))
  return (
    <Popover label="Prizes and chances" title="Prizes and chances" text="Prizes">
      <span className="flex flex-col gap-1.5">
        {WHEEL_PRIZES.map((p, i) => (
          <span key={p.amount} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[p.amount] }} />
            <span className="tnum flex w-[58px] items-center gap-1 font-extrabold text-ink">
              {fmt(p.amount, 0)} <Coin size={11} />
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stage">
              <span className="block h-full origin-left rounded-full" style={{ background: COLORS[p.amount], transform: `scaleX(${wheelChance(i) / top})` }} />
            </span>
            <span className="tnum w-[34px] text-right font-bold">{Math.round(wheelChance(i) * 100)}%</span>
          </span>
        ))}
      </span>
      <span className="mt-3 block border-t border-white/[.06] pt-2.5 text-[11.5px] text-dim">
        The segments are drawn the same size, but the chances differ as listed. The average spin pays about {Math.round(WHEEL_MEAN)} coins. The prize is drawn when you press Spin; the wheel just shows it.
      </span>
    </Popover>
  )
}
