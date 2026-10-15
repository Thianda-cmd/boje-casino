import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, GameShell, Stat } from '../../components/ui'
import { Coin, IconCheck } from '../../components/icons'
import { fmt, fmtDuration } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useNow } from '../../lib/useNow'
import { useSize } from '../../lib/useSize'
import { useUid } from '../../art/ids'
import { Lockpick } from '../../art/Vault'
import { HEIST_LOOT, HEIST_MAX_PICKS, heistPicks, useWallet } from '../../store/wallet'

/*
  Vault Heist. A needle sweeps round the dial; tap while it crosses the glowing notch to set a pin.
  Set every pin and the door swings open. Then bank the bag, or go one vault deeper for more.
  Tap off the notch, or let the needle slip past it, and the alarm takes the whole bag.
  Each run costs a lockpick: three at most, one back every 45 minutes.
*/

interface Vault {
  pins: number
  /** needle speed in degrees per second at the first pin */
  speed: number
  /** notch width in degrees */
  width: number
  metal: [string, string]
}

const VAULTS: Vault[] = [
  { pins: 3, speed: 140, width: 34, metal: ['#7b8ea3', '#2a3744'] },
  { pins: 4, speed: 165, width: 30, metal: ['#66778d', '#1f2935'] },
  { pins: 4, speed: 190, width: 27, metal: ['#b98a5c', '#4a2f1c'] },
  { pins: 5, speed: 215, width: 24, metal: ['#c3ccd7', '#545f6c'] },
  { pins: 5, speed: 240, width: 21, metal: ['#e1bd62', '#6b4f17'] },
  { pins: 6, speed: 265, width: 19, metal: ['#5fb594', '#173a2e'] },
  { pins: 6, speed: 290, width: 17, metal: ['#8c79d8', '#2a2156'] },
  { pins: 7, speed: 320, width: 15, metal: ['#b84a63', '#2a0f18'] },
]

/** forgiveness on each side of the notch, in degrees */
const GRACE = 2
const SPEED_STEP = 1.035
const GEM_CHANCE = 0.2
const gemBonus = (v: number) => Math.max(2, Math.round(HEIST_LOOT[v] * 0.08))

type Phase = 'idle' | 'armed' | 'picking' | 'opening' | 'cracked' | 'alarm'
type Outcome = { kind: 'banked' | 'alarm'; amount: number; vaults: number; why?: 'early' | 'late'; practice: boolean; id: number }

interface Notch {
  /** centre angle, degrees clockwise from 12 o'clock */
  angle: number
  width: number
  gem: boolean
  id: number
}

const C = 200
const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const
}
const arc = (r: number, from: number, to: number) => {
  const [x1, y1] = polar(r, from)
  const [x2, y2] = polar(r, to)
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export default function Heist() {
  const heist = useWallet((s) => s.heist)
  const heistStart = useWallet((s) => s.heistStart)
  const heistEnd = useWallet((s) => s.heistEnd)
  const pushToast = useWallet((s) => s.pushToast)
  const now = useNow(1000)
  const picks = heistPicks(heist, now)

  const [phase, setPhase] = useState<Phase>('idle')
  const [vault, setVault] = useState(0)
  /** vaults opened this run */
  const [cracked, setCracked] = useState(0)
  const [gems, setGems] = useState(0)
  const [pinsLeft, setPinsLeft] = useState(VAULTS[0].pins)
  const [notch, setNotch] = useState<Notch>({ angle: 130, width: VAULTS[0].width, gem: false, id: 0 })
  const [sparks, setSparks] = useState<{ id: number; angle: number; gem: boolean; bonus: number }[]>([])
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [hubPulse, setHubPulse] = useState(0)
  /** a practice run costs no lockpick and pays nothing */
  const [practice, setPractice] = useState(false)

  const bag = (cracked ? HEIST_LOOT[cracked - 1] : 0) + gems
  const running = phase !== 'idle' && phase !== 'alarm'

  // needle simulation lives in a ref so the animation loop never waits on React
  const sim = useRef({ a0: 0, dir: 1, speed: 30, travel: 0, d0: 90, width: 34, last: 0, moving: false })
  const needleRef = useRef<SVGGElement>(null)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const live = useRef({ vault: 0, cracked: 0, gems: 0, pinsLeft: 0, notch, practice, seq: 1 })
  live.current = { ...live.current, vault, cracked, gems, pinsLeft, notch, practice }
  if (import.meta.env.DEV) (window as unknown as { __heist: unknown }).__heist = { sim: sim.current, live: live.current }
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))

  /** How far the needle had travelled at time t (an input event's timestamp), between animation frames. */
  const travelAt = (t: number) => {
    const s = sim.current
    if (!s.moving) return s.travel
    const nowT = performance.now()
    if (!(Math.abs(t - nowT) < 1000)) t = nowT // some browsers stamp events on another clock
    return s.travel + (s.speed * Math.max(-100, Math.min(t - s.last, 34))) / 1000
  }

  /** Re-anchor the needle at its current spot (optionally at a given travel) so speed or direction can change. */
  const freeze = (travel = sim.current.travel) => {
    const s = sim.current
    s.a0 = s.a0 + s.dir * travel
    s.travel = 0
  }

  const placeNotch = (v: number) => {
    const s = sim.current
    freeze()
    const angle = s.a0
    const width = VAULTS[v].width
    s.width = width
    s.d0 = 55 + rand() * 215
    s.last = performance.now()
    const gem = v >= 1 && rand() < GEM_CHANCE
    const center = angle + s.dir * (s.d0 + width / 2)
    setNotch({ angle: ((center % 360) + 360) % 360, width, gem, id: live.current.seq++ })
  }

  // the animation loop: idle drift when nothing is happening, the real sweep while picking
  useEffect(() => {
    let raf = 0
    const tick = (t: number) => {
      const s = sim.current
      const dt = Math.min(Math.max(0, t - s.last), 34) // a stalled frame slows the needle, never skips the notch
      s.last = t
      const ph = phaseRef.current
      if (ph === 'picking') {
        s.travel += (s.speed * dt) / 1000
        // a short beat after the needle clears the notch, so a tap already in the queue is judged first
        if (s.travel > s.d0 + s.width + GRACE + s.speed * 0.035) fail('late')
      } else if (ph === 'idle') {
        s.travel += (24 * dt) / 1000
      }
      needleRef.current?.setAttribute('transform', `rotate(${(s.a0 + s.dir * s.travel).toFixed(2)} ${C} ${C})`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // leaving with an open vault walks out with the bag; leaving mid-lock forfeits it
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      const ph = phaseRef.current
      const l = live.current
      if (l.practice) return
      if (ph === 'cracked' || ph === 'opening') heistEnd(l.cracked, (l.cracked ? HEIST_LOOT[l.cracked - 1] : 0) + l.gems)
      else if (ph === 'armed' || ph === 'picking') heistEnd(l.cracked, 0)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const arm = (v: number) => {
    const s = sim.current
    s.moving = false
    freeze()
    s.speed = VAULTS[v].speed
    s.dir = 1
    setVault(v)
    setPinsLeft(VAULTS[v].pins)
    placeNotch(v)
    setPhase('armed')
  }

  const start = (practiceRun = false) => {
    if (running) return
    if (!practiceRun && !heistStart()) {
      pushToast({ kind: 'info', title: 'No lockpicks left. A new one arrives every 45 minutes.' })
      return
    }
    sfx.bet()
    setPractice(practiceRun)
    live.current.practice = practiceRun
    setOutcome(null)
    setCracked(0)
    setGems(0)
    setSparks([])
    arm(0)
  }

  const fail = (why: 'early' | 'late') => {
    if (phaseRef.current !== 'picking') return
    phaseRef.current = 'alarm'
    sim.current.moving = false
    const l = live.current
    setPhase('alarm')
    sfx.alarm()
    if (!l.practice) heistEnd(l.cracked, 0)
    setOutcome({ kind: 'alarm', amount: (l.cracked ? HEIST_LOOT[l.cracked - 1] : 0) + l.gems, vaults: l.cracked, why, practice: l.practice, id: l.seq++ })
  }

  const bank = (vaults: number, amount: number) => {
    const l = live.current
    if (l.practice) sfx.win()
    else {
      heistEnd(vaults, amount)
      ;(vaults >= 5 ? sfx.bigWin : sfx.win)()
      pushToast({ kind: 'reward', title: vaults >= VAULTS.length ? 'Every vault cracked!' : 'Heist banked', amount })
    }
    setOutcome({ kind: 'banked', amount, vaults, practice: l.practice, id: l.seq++ })
    setPhase('idle')
    setVault(0)
  }

  const tap = (t: number) => {
    const ph = phaseRef.current
    if (ph === 'armed') {
      sim.current.moving = true
      sim.current.last = performance.now()
      phaseRef.current = 'picking'
      setPhase('picking')
      sfx.click()
      return
    }
    if (ph !== 'picking') return
    const s = sim.current
    const travel = travelAt(t)
    if (travel < s.d0 - GRACE) return fail('early')
    if (travel > s.d0 + s.width + GRACE) return fail('late')

    const l = live.current
    const v = l.vault
    const bonus = l.notch.gem ? gemBonus(v) : 0
    const left = l.pinsLeft - 1
    sfx.pin(VAULTS[v].pins - left)
    if (bonus) sfx.gem()
    setSparks((x) => [...x.slice(-4), { id: l.seq++, angle: l.notch.angle, gem: l.notch.gem, bonus }])
    setHubPulse((n) => n + 1)
    if (bonus) setGems((g) => g + bonus)
    setPinsLeft(left)
    if (navigator.vibrate) navigator.vibrate(12)

    if (left > 0) {
      // the needle stops where it was tapped, then reverses
      freeze(travel)
      s.dir = -s.dir
      s.speed *= SPEED_STEP
      placeNotch(v)
      return
    }

    // vault open
    freeze(travel)
    s.moving = false
    phaseRef.current = 'opening'
    setPhase('opening')
    setCracked(v + 1)
    sfx.vault()
    later(() => {
      if (v + 1 >= VAULTS.length) bank(VAULTS.length, HEIST_LOOT[v] + live.current.gems)
      else setPhase('cracked')
    }, 1250)
  }

  const next = () => {
    if (phase !== 'cracked') return
    sfx.click()
    arm(vault + 1)
  }

  // keyboard: space picks
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.repeat) return
      if (e.code === 'Space' && (phaseRef.current === 'armed' || phaseRef.current === 'picking')) {
        e.preventDefault()
        tap(e.timeStamp)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const v = VAULTS[vault]
  const open = phase === 'opening' || phase === 'cracked'
  const nextLoot = HEIST_LOOT[Math.min(cracked, VAULTS.length - 1)]

  /* ---------------- panel ---------------- */

  const panel = (
    <>
      <div className="rounded-xl bg-stage p-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-dim">Lockpicks</span>
          <span className="tnum text-[12px] font-bold text-muted">{picks.next ? `Next in ${fmtDuration(picks.next)}` : 'Full'}</span>
        </div>
        <div className="mt-2 flex gap-2">
          {Array.from({ length: HEIST_MAX_PICKS }, (_, i) => (
            <motion.div
              key={i}
              animate={{ scale: i < picks.picks ? 1 : 0.92, opacity: i < picks.picks ? 1 : 0.5 }}
              className={`flex h-12 flex-1 items-center justify-center rounded-lg ${i < picks.picks ? 'bg-gold/10 ring-1 ring-gold/30' : 'bg-panel2'}`}
            >
              <Lockpick on={i < picks.picks} />
            </motion.div>
          ))}
        </div>
      </div>

      <div className="max-lg:order-first flex flex-col gap-2 lg:order-none">
        {phase === 'armed' || phase === 'picking' ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onPointerDown={(e) => {
              e.preventDefault()
              tap(e.timeStamp)
            }}
            className="flex min-h-[64px] w-full touch-manipulation select-none flex-col items-center justify-center rounded-lg bg-accent px-4 text-[18px] font-black text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)]"
          >
            {phase === 'armed' ? 'Start the dial' : 'Pick'}
            <span className="hidden text-[12px] font-bold opacity-70 lg:block">or press Space</span>
          </motion.button>
        ) : phase === 'cracked' ? (
          <>
            <ActionButton onClick={next} sub={`Bag becomes ${fmt(HEIST_LOOT[vault + 1] + gems, 0)}`}>
              Crack vault {vault + 2}
            </ActionButton>
            <ActionButton tone="gold" onClick={() => bank(cracked, bag)}>
              Bank {fmt(bag, 0)} <Coin size={17} />
            </ActionButton>
          </>
        ) : phase === 'opening' ? (
          <ActionButton disabled>Opening…</ActionButton>
        ) : (
          <>
            <ActionButton onClick={() => start()} disabled={picks.picks < 1} sub={picks.picks < 1 ? `Next lockpick in ${fmtDuration(picks.next)}` : 'Uses 1 lockpick'}>
              Start heist
            </ActionButton>
            <button onClick={() => start(true)} className="h-10 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
              Practice run <span className="font-semibold text-dim">· no coins</span>
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Bag" value={<span className="inline-flex items-center gap-1">{fmt(running ? bag : 0, 0)} <Coin size={14} /></span>} tone="gold" />
        <Stat label={running ? 'Bag if it opens' : 'Top prize'} value={fmt(running ? nextLoot + gems : HEIST_LOOT[VAULTS.length - 1], 0)} tone="accent" />
        <Stat label="Best run" value={heist.best ? `Vault ${heist.best}` : 'None yet'} />
        <Stat label="Coins earned" value={fmt(heist.earned ?? 0, 0)} />
      </div>

      <div className="rounded-xl bg-stage p-3 text-[13px] leading-relaxed text-muted lg:mt-auto">
        Tap as the needle crosses the glowing notch to set a pin. Set them all and the vault opens. Bank the bag, or go deeper for more. Tap off the notch or let it slip past and the alarm takes the bag.{' '}
        <span className="text-gold">Gold notches</span> add a bonus.
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const [boxRef, box] = useSize<HTMLDivElement>({ w: 600, h: 480 })
  const D = Math.max(220, Math.min(box.w - 24, box.h - 24, 560))

  const stage = (
    <div
      className="absolute inset-0 flex touch-manipulation select-none flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_42%,#1b2a38_0%,#0b141c_72%)]"
      onPointerDown={(e) => {
        if (phaseRef.current === 'armed' || phaseRef.current === 'picking') {
          if ((e.target as HTMLElement).closest('button')) return
          e.preventDefault()
          tap(e.timeStamp)
        }
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[.35] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.025)_0_2px,transparent_2px_14px),repeating-linear-gradient(-45deg,rgba(255,255,255,.025)_0_2px,transparent_2px_14px)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-[radial-gradient(ellipse_at_50%_0%,rgba(127,227,255,.08),transparent_70%)]" />

      <Ladder vault={vault} cracked={cracked} running={running || phase === 'alarm'} gems={gems} />
      <AnimatePresence>
        {practice && (running || phase === 'alarm') && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute left-3 top-[68px] z-10 rounded-full bg-sky/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-sky sm:left-4 sm:top-[72px]"
          >
            Practice
          </motion.span>
        )}
      </AnimatePresence>

      <div ref={boxRef} className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="relative"
            style={{ width: D, height: D, perspective: 1300 }}
            animate={phase === 'alarm' ? { x: [0, -12, 11, -9, 7, -4, 0] } : { x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Interior size={D} loot={cracked ? HEIST_LOOT[cracked - 1] : HEIST_LOOT[0]} bag={bag} open={open} />
            <motion.div
              className="absolute inset-0"
              // the swung-open door sits in front of the frame; closed, the frame hides the bolts
              style={{ transformOrigin: '9% 50%', zIndex: open ? 2 : 0, transition: `z-index 0s linear ${open ? 0.3 : 0.5}s` }}
              initial={false}
              animate={{ rotateY: open ? -68 : 0, opacity: open ? 0.96 : 1 }}
              transition={open ? { delay: 0.32, type: 'spring', stiffness: 60, damping: 13 } : { type: 'spring', stiffness: 120, damping: 18 }}
            >
              <Door
                key={vault}
                vault={v}
                pins={v.pins}
                pinsLeft={running || phase === 'alarm' ? pinsLeft : v.pins}
                notch={phase === 'armed' || phase === 'picking' ? notch : null}
                retracted={open}
                alarm={phase === 'alarm'}
                hubPulse={hubPulse}
                needleRef={needleRef}
              />
            </motion.div>
            <Frame />
            {sparks.map((s) => (
              <Spark key={s.id} size={D} angle={s.angle} gem={s.gem} bonus={s.bonus} onDone={() => setSparks((x) => x.filter((y) => y.id !== s.id))} />
            ))}
          </motion.div>
        </div>

        <AnimatePresence>
          {phase === 'armed' && (
            <motion.div
              key="hint"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
            >
              <span className="rounded-full bg-black/65 px-4 py-2 text-[13px] font-bold text-ink">Tap anywhere to start the dial</span>
            </motion.div>
          )}
          {outcome && phase !== 'opening' && !running && <OutcomeCard key={outcome.id} outcome={outcome} />}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {phase === 'alarm' && (
          <motion.div
            key="alarm"
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.2, 1, 0.2, 0.7, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.2, times: [0, 0.1, 0.25, 0.4, 0.55, 0.7, 1] }}
            onAnimationComplete={() => phaseRef.current === 'alarm' && setPhase('idle')}
            style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 35%, rgba(255,40,70,.45) 100%)' }}
          />
        )}
      </AnimatePresence>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}

/* ---------------- pieces ---------------- */

function Ladder({ vault, cracked, running, gems }: { vault: number; cracked: number; running: boolean; gems: number }) {
  return (
    <div className="relative z-10 flex items-stretch gap-1 px-3 pt-3 sm:gap-1.5 sm:px-4 sm:pt-4">
      {HEIST_LOOT.map((loot, i) => {
        const done = i < cracked
        const here = running && i === vault && !done
        return (
          <motion.div
            key={i}
            animate={here ? { scale: [1, 1.05, 1] } : { scale: 1 }}
            transition={here ? { duration: 1.4, repeat: Infinity } : undefined}
            className={`tnum relative flex h-11 flex-1 flex-col items-center justify-center rounded-lg text-[12px] font-extrabold leading-none transition-colors sm:text-[13px] ${
              done ? 'bg-accent text-[#032412]' : here ? 'bg-raised text-ink ring-2 ring-accent' : 'bg-panel/70 text-muted'
            }`}
          >
            <span className="mb-1 text-[9px] font-bold uppercase tracking-wider opacity-60 sm:text-[10px]">{done ? <IconCheck size={10} strokeWidth={4} /> : i + 1}</span>
            {loot}
          </motion.div>
        )
      })}
      <AnimatePresence>
        {gems > 0 && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="tnum absolute -bottom-7 right-3 flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-extrabold text-gold sm:right-4"
          >
            +{gems} bonus
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

function Frame() {
  const u = useUid()
  return (
    <svg viewBox="0 0 400 400" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a5c6e" />
          <stop offset=".5" stopColor="#2a3644" />
          <stop offset="1" stopColor="#141c25" />
        </linearGradient>
        <linearGradient id={`${u}h`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1b242e" />
          <stop offset=".5" stopColor="#7d8ea0" />
          <stop offset="1" stopColor="#2a3542" />
        </linearGradient>
      </defs>
      {/* the wall ring the door sits in */}
      <path
        fillRule="evenodd"
        d={`M${C} 2a198 198 0 1 1 0 396a198 198 0 1 1 0-396zM${C} 32a168 168 0 1 0 0 336a168 168 0 1 0 0-336z`}
        fill={`url(#${u}f)`}
      />
      <circle cx={C} cy={C} r="197" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1.5" />
      <circle cx={C} cy={C} r="168.5" fill="none" stroke="rgba(0,0,0,.7)" strokeWidth="3" />
      {Array.from({ length: 24 }, (_, i) => {
        const [x, y] = polar(183, i * 15 + 7.5)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="3.6" fill="#141c25" />
            <circle cx={x - 0.6} cy={y - 0.6} r="2.6" fill="#8796a8" />
          </g>
        )
      })}
      {/* hinges */}
      {[128, 272].map((y) => (
        <rect key={y} x="-6" y={y - 22} width="26" height="44" rx="6" fill={`url(#${u}h)`} stroke="rgba(0,0,0,.5)" />
      ))}
    </svg>
  )
}

function Door({
  vault,
  pins,
  pinsLeft,
  notch,
  retracted,
  alarm,
  hubPulse,
  needleRef,
}: {
  vault: Vault
  pins: number
  pinsLeft: number
  notch: Notch | null
  retracted: boolean
  alarm: boolean
  hubPulse: number
  needleRef: React.RefObject<SVGGElement | null>
}) {
  const u = useUid()
  const [m0, m1] = vault.metal
  const notchColor = notch?.gem ? '#f7c548' : '#22d36f'
  const set = pins - pinsLeft
  return (
    <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <defs>
        <radialGradient id={`${u}d`} cx=".36" cy=".28" r=".95">
          <stop offset="0" stopColor={m0} />
          <stop offset=".55" stopColor={m1} />
          <stop offset="1" stopColor="#0b1118" />
        </radialGradient>
        <linearGradient id={`${u}b`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5d6b7b" />
          <stop offset=".45" stopColor="#e9eff6" />
          <stop offset="1" stopColor="#6b7889" />
        </linearGradient>
        <radialGradient id={`${u}hub`} cx=".38" cy=".3" r=".9">
          <stop offset="0" stopColor="#5a6a7c" />
          <stop offset=".7" stopColor="#1a232e" />
          <stop offset="1" stopColor="#0d141b" />
        </radialGradient>
        <linearGradient id={`${u}n`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".7" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <filter id={`${u}g`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* locking bolts slide out into the frame and back in when the vault opens */}
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i} transform={`rotate(${i * 30 + 15} ${C} ${C})`}>
          <motion.rect
            x={C - 9}
            width="18"
            height="34"
            rx="4"
            fill={`url(#${u}b)`}
            stroke="rgba(0,0,0,.45)"
            initial={false}
            animate={{ y: retracted ? 50 : 22 }}
            transition={{ duration: 0.28, delay: retracted ? (i % 4) * 0.02 : 0 }}
          />
        </g>
      ))}

      {/* door slab */}
      <circle cx={C} cy={C} r="166" fill={`url(#${u}d)`} />
      <circle cx={C} cy={C} r="165" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="1.5" />
      <circle cx={C} cy={C} r="152" fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="5" />
      <circle cx={C} cy={C} r="147" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />
      {Array.from({ length: 8 }, (_, i) => {
        const [x, y] = polar(158, i * 45 + 22.5)
        return <circle key={i} cx={x} cy={y} r="3" fill="rgba(0,0,0,.45)" />
      })}

      {/* dial track */}
      <circle cx={C} cy={C} r="116" fill="none" stroke="#071017" strokeWidth="38" />
      <circle cx={C} cy={C} r="135.5" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
      <circle cx={C} cy={C} r="96.5" fill="none" stroke="rgba(0,0,0,.6)" strokeWidth="2" />
      {Array.from({ length: 72 }, (_, i) => {
        const big = i % 6 === 0
        const [x1, y1] = polar(big ? 99 : 100, i * 5)
        const [x2, y2] = polar(big ? 108 : 104, i * 5)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={big ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.18)'} strokeWidth={big ? 2 : 1} />
      })}

      {/* the notch */}
      <AnimatePresence>
        {notch && (
          <motion.g key={notch.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.12 }}>
            <path d={arc(118, notch.angle - notch.width / 2, notch.angle + notch.width / 2)} stroke={notchColor} strokeWidth="30" fill="none" filter={`url(#${u}g)`} opacity=".75" />
            <path d={arc(118, notch.angle - notch.width / 2, notch.angle + notch.width / 2)} stroke={notchColor} strokeWidth="26" fill="none" />
            <path d={arc(128, notch.angle - notch.width / 2 + 1, notch.angle + notch.width / 2 - 1)} stroke="rgba(255,255,255,.55)" strokeWidth="2" fill="none" />
            {notch.gem && (() => {
              const [x, y] = polar(118, notch.angle)
              return <path d={`M${x} ${y - 7}l6 7-6 7-6-7z`} fill="#fff" />
            })()}
          </motion.g>
        )}
      </AnimatePresence>

      {/* needle */}
      <g ref={needleRef}>
        <path d={`M${C - 5} ${C} L${C - 2} ${C - 136} L${C + 2} ${C - 136} L${C + 5} ${C} Z`} fill={alarm ? '#ff4d61' : `url(#${u}n)`} filter={`url(#${u}g)`} opacity=".55" />
        <path d={`M${C - 4} ${C} L${C - 1.6} ${C - 136} L${C + 1.6} ${C - 136} L${C + 4} ${C} Z`} fill={alarm ? '#ff4d61' : `url(#${u}n)`} />
        <path d={`M${C - 4} ${C} L${C + 4} ${C} L${C + 3} ${C + 34} L${C - 3} ${C + 34} Z`} fill="#26313d" />
      </g>

      {/* hub */}
      <circle cx={C} cy={C} r="54" fill="rgba(0,0,0,.35)" />
      {Array.from({ length: 24 }, (_, i) => {
        const [x, y] = polar(52, i * 15)
        return <circle key={i} cx={x} cy={y} r="4.2" fill="#1e2833" stroke="rgba(255,255,255,.1)" />
      })}
      <circle cx={C} cy={C} r="48" fill={`url(#${u}hub)`} stroke="rgba(255,255,255,.14)" strokeWidth="1.5" />
      <motion.text
        key={hubPulse}
        x={C}
        y={C + 4}
        textAnchor="middle"
        fontSize="40"
        fontWeight="900"
        fill={alarm ? '#ff4d61' : pinsLeft === 0 ? '#22d36f' : '#ffffff'}
        fontFamily="Manrope, system-ui, sans-serif"
        initial={{ scale: hubPulse ? 1.35 : 1 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 16 }}
      >
        {pinsLeft}
      </motion.text>
      <text x={C} y={C + 24} textAnchor="middle" fontSize="10" fontWeight="800" letterSpacing="2" fill="rgba(255,255,255,.45)" fontFamily="Manrope, system-ui, sans-serif">
        {pinsLeft === 1 ? 'PIN' : 'PINS'}
      </text>

      {/* pin lights */}
      {Array.from({ length: pins }, (_, i) => {
        const x = C + (i - (pins - 1) / 2) * 15
        const on = i < set
        return (
          <g key={i}>
            <circle cx={x} cy={C + 72} r="5" fill={on ? '#22d36f' : alarm ? '#5a1622' : '#0a1218'} stroke="rgba(0,0,0,.5)" />
            {on && <circle cx={x} cy={C + 72} r="9" fill="#22d36f" opacity=".35" filter={`url(#${u}g)`} />}
          </g>
        )
      })}
    </svg>
  )
}

function Interior({ size, loot, bag, open }: { size: number; loot: number; bag: number; open: boolean }) {
  const u = useUid()
  // more gold behind deeper doors
  const bars = loot >= 250 ? 6 : loot >= 90 ? 3 : 1
  return (
    <div className="absolute inset-0 overflow-hidden rounded-full" style={{ clipPath: 'circle(42% at 50% 50%)' }}>
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id={`${u}i`} cx=".5" cy=".7" r=".6">
            <stop offset="0" stopColor="#5a4210" />
            <stop offset=".55" stopColor="#1d160a" />
            <stop offset="1" stopColor="#07080a" />
          </radialGradient>
          <linearGradient id={`${u}bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe9a3" />
            <stop offset=".5" stopColor="#f7c548" />
            <stop offset="1" stopColor="#b07b14" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r="170" fill={`url(#${u}i)`} />
        {[0, 1, 2].map((i) => (
          <line key={i} x1="40" x2="360" y1={150 + i * 50} y2={150 + i * 50} stroke="rgba(255,220,140,.08)" strokeWidth="3" />
        ))}
        {/* gold bars: a little pyramid */}
        {Array.from({ length: bars }, (_, i) => {
          const row = bars === 6 ? (i < 3 ? 0 : i < 5 ? 1 : 2) : bars === 3 ? (i < 2 ? 0 : 1) : 0
          const inRow = bars === 6 ? [3, 2, 1][row] : bars === 3 ? [2, 1][row] : 1
          const idx = bars === 6 ? [0, 1, 2, 0, 1, 0][i] : bars === 3 ? [0, 1, 0][i] : 0
          const x = C + (idx - (inRow - 1) / 2) * 62
          const y = 300 - row * 26
          return <path key={i} d={`M${x - 28} ${y}l8 -24h40l8 24z`} fill={`url(#${u}bar)`} stroke="#7a5408" strokeWidth="1.5" />
        })}
        {Array.from({ length: 9 }, (_, i) => (
          <ellipse key={i} cx={110 + ((i * 47) % 190)} cy={316 - (i % 3) * 5} rx="13" ry="5" fill="#f7c548" stroke="#a87412" />
        ))}
      </svg>
      <AnimatePresence>
        {open && (
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.45, type: 'spring', stiffness: 260, damping: 18 }}
          >
            <div className="absolute h-1/2 w-1/2 rounded-full bg-gold/30 blur-3xl" />
            <span className="relative text-[11px] font-extrabold uppercase tracking-[.2em] text-gold/80" style={{ fontSize: Math.max(10, size * 0.028) }}>
              Bag
            </span>
            <span className="tnum relative flex items-center gap-2 font-black text-white drop-shadow-[0_4px_18px_rgba(247,197,72,.6)]" style={{ fontSize: Math.max(28, size * 0.13) }}>
              {fmt(bag, 0)} <Coin size={Math.max(22, size * 0.09)} />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Spark({ size, angle, gem, bonus, onDone }: { size: number; angle: number; gem: boolean; bonus: number; onDone: () => void }) {
  const [x, y] = polar(118, angle)
  const k = size / 400
  const color = gem ? '#f7c548' : '#22d36f'
  return (
    <div className="pointer-events-none absolute" style={{ left: x * k, top: y * k }}>
      <motion.span
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
        style={{ width: 54 * k + 10, height: 54 * k + 10, borderColor: color }}
        initial={{ opacity: 0.9, scale: 0.4 }}
        animate={{ opacity: 0, scale: 1.8 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        onAnimationComplete={onDone}
      />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <motion.span
            key={i}
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: color }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: Math.cos(a) * 34 * (k + 0.4), y: Math.sin(a) * 34 * (k + 0.4), opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        )
      })}
      {bonus > 0 && (
        <motion.span
          className="tnum absolute -translate-x-1/2 whitespace-nowrap text-[15px] font-black text-gold drop-shadow"
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: -42, opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1 }}
        >
          +{bonus}
        </motion.span>
      )}
    </div>
  )
}

function OutcomeCard({ outcome }: { outcome: Outcome }) {
  const alarm = outcome.kind === 'alarm'
  let title: ReactNode
  let sub: ReactNode
  if (alarm) {
    title = 'Alarm tripped'
    sub = outcome.amount > 0 ? `${outcome.why === 'early' ? 'Too early.' : 'Too late.'} The ${fmt(outcome.amount, 0)} coin bag is gone.` : outcome.why === 'early' ? 'Too early. Wait for the notch.' : 'Too late. The needle slipped past.'
  } else {
    title = (
      <span className="inline-flex items-center gap-2">
        +{fmt(outcome.amount, 0)} <Coin size={26} />
      </span>
    )
    sub = outcome.practice
      ? `Practice run, nothing paid. A real run would bank this after ${outcome.vaults} ${outcome.vaults === 1 ? 'vault' : 'vaults'}.`
      : `Banked after ${outcome.vaults} ${outcome.vaults === 1 ? 'vault' : 'vaults'}`
  }
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6"
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 320, damping: 22, delay: alarm ? 0.35 : 0 }}
    >
      <div
        className={`max-w-[300px] rounded-2xl border-[3px] bg-panel px-7 py-5 text-center shadow-[0_24px_60px_-12px_rgba(0,0,0,.75)] ${
          alarm ? 'border-danger shadow-[0_0_48px_-10px_rgba(255,77,97,.6)]' : 'border-gold shadow-[0_0_48px_-10px_rgba(247,197,72,.6)]'
        }`}
      >
        <div className={`tnum text-[28px] font-black leading-none tracking-tight ${alarm ? 'text-danger' : 'text-gold'}`}>{title}</div>
        <div className="mx-auto my-3 h-[3px] w-10 rounded-full bg-raised" />
        <div className="text-[14px] font-semibold text-muted">{sub}</div>
      </div>
    </motion.div>
  )
}
