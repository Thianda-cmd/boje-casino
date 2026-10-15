import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Label, Segmented, Stat, useStake } from '../../components/ui'
import { HudChip, PIXEL_FONT, PixelCard, mx } from '../../components/pixelui'
import { fmt, fmtMult, round2 } from '../../lib/format'
import { rand, randInt } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { pixelated, type Sprite } from '../../lib/pixel'
import { useWallet } from '../../store/wallet'
import {
  CAR_COLORS,
  asphalt,
  barrier,
  bush,
  chicken,
  coin,
  curb,
  flower,
  goldenEgg,
  grass,
  manhole,
  stoneBricks,
  vehicle,
  type ManholeState,
  type VehicleKind,
} from './sprites'

/* ------------------------------------------------------------------ */
/*  Rules                                                              */
/* ------------------------------------------------------------------ */

type Difficulty = 'easy' | 'medium' | 'hard' | 'daredevil'
const DIFFS: Record<Difficulty, { label: string; lanes: number; survive: number }> = {
  easy: { label: 'Easy', lanes: 24, survive: 0.9 },
  medium: { label: 'Medium', lanes: 22, survive: 0.8 },
  hard: { label: 'Hard', lanes: 20, survive: 0.7 },
  daredevil: { label: 'Daredevil', lanes: 15, survive: 0.55 },
}
const RTP = 0.97
const multipliers = (d: Difficulty) => {
  const { lanes, survive } = DIFFS[d]
  return Array.from({ length: lanes }, (_, i) => round2(RTP / Math.pow(survive, i + 1)))
}

type Phase = 'idle' | 'playing' | 'dead' | 'cashed'

interface Car {
  id: number
  lane: number
  kind: VehicleKind
  color: string
  dur: number
}

interface Burst {
  id: number
  x: number
  y: number
  kind: 'dust' | 'feathers' | 'coins'
}

let seq = 1

function pickVehicle(): Pick<Car, 'kind' | 'color'> {
  const r = rand()
  const kind: VehicleKind = r < 0.16 ? 'truck' : r < 0.26 ? 'taxi' : r < 0.32 ? 'police' : 'sedan'
  return { kind, color: CAR_COLORS[randInt(CAR_COLORS.length)] }
}

/* ------------------------------------------------------------------ */

export default function ChickenRoad() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)

  const [bet, setBet] = useState(10)
  const [diff, setDiff] = useState<Difficulty>('medium')
  const [phase, setPhase] = useState<Phase>('idle')
  const [pos, setPos] = useState(-1) // -1 = sidewalk, lanes = finish
  const [busy, setBusy] = useState(false)
  const [hop, setHop] = useState(0)
  const [hopping, setHopping] = useState(false)
  const [blink, setBlink] = useState(false)
  const [deathLane, setDeathLane] = useState<number | null>(null)
  const [killer, setKiller] = useState<{ lane: number; id: number; kind: VehicleKind; color: string } | null>(null)
  const [shaking, setShaking] = useState(false)
  const [result, setResult] = useState<{ win: boolean; mult: number; amount: number } | null>(null)
  const [cars, setCars] = useState<Car[]>([])
  const [bursts, setBursts] = useState<Burst[]>([])
  const [roundBet, setRoundBet] = useState(0)

  const mults = useMemo(() => multipliers(diff), [diff])
  const lanes = DIFFS[diff].lanes
  const cur = pos >= 0 ? mults[Math.min(pos, lanes - 1)] : 0
  const next = pos + 1 < lanes ? mults[pos + 1] : null

  /* ---------------- geometry (everything snaps to the pixel unit P) ---------------- */
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 640 })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const P = Math.max(4, Math.min(7, Math.round(Math.min(size.w / 165, size.h / 110))))
  const laneW = 22 * P
  const sideW = 34 * P
  const trackW = sideW * 2 + lanes * laneW
  const roadY = Math.round((size.h * 0.6) / P) * P // manhole centre line
  const xOf = (p: number) => (p < 0 ? sideW / 2 + 4 * P : p >= lanes ? sideW + lanes * laneW + sideW / 2 : sideW + p * laneW + laneW / 2)
  const camX = Math.round(Math.min(0, Math.max(size.w - trackW, size.w * 0.3 - xOf(pos))))
  const chickenTop = roadY - 15 * P
  const barrierTop = roadY - 24 * P

  // latest values for timers
  const st = useRef({ phase, pos, lanes, camX, laneW, sideW, w: size.w })
  st.current = { phase, pos, lanes, camX, laneW, sideW, w: size.w }

  /* ---------------- sprites (rendered once, cached) ---------------- */
  const spr = useMemo(
    () => ({
      idle: chicken.idle(),
      blink: chicken.blink(),
      hop: chicken.hop(),
      cooked: chicken.cooked(),
      barrier: barrier(),
      egg: goldenEgg(),
      bush: bush(),
      flowerR: flower('#ff5d7a'),
      flowerB: flower('#7fb2ff'),
      asphalt: asphalt(),
      stone: stoneBricks(),
      grass: grass(),
      curb: curb(),
      manhole: {
        idle: manhole('idle'),
        current: manhole('current'),
        passed: manhole('passed'),
        dead: manhole('dead'),
      } as Record<ManholeState, Sprite>,
    }),
    [],
  )

  // idle blinking
  useEffect(() => {
    const t = setInterval(() => {
      setBlink(true)
      setTimeout(() => setBlink(false), 140)
    }, 2600)
    return () => clearInterval(t)
  }, [])

  /* ---------------- ambient traffic ---------------- */
  const lastSpawn = useRef<Record<number, number>>({})
  useEffect(() => {
    const t = setInterval(() => {
      const s = st.current
      if (document.hidden) return
      const first = Math.max(s.pos + 1, Math.floor((-s.camX - s.sideW) / s.laneW))
      const last = Math.min(s.lanes - 1, Math.ceil((-s.camX + s.w - s.sideW) / s.laneW))
      if (last < first) return
      const lane = first + randInt(last - first + 1)
      const now = performance.now()
      if (now - (lastSpawn.current[lane] ?? 0) < 2100) return
      lastSpawn.current[lane] = now
      const v = pickVehicle()
      setCars((c) => [...c.slice(-40), { id: seq++, lane, ...v, dur: v.kind === 'truck' ? 2.8 + rand() * 0.8 : 1.5 + rand() * 1.1 }])
    }, 240)
    return () => clearInterval(t)
  }, [])

  const removeCar = useCallback((id: number) => setCars((c) => c.filter((x) => x.id !== id)), [])
  const addBurst = (b: Omit<Burst, 'id'>) => {
    const id = seq++
    setBursts((x) => [...x, { ...b, id }])
    setTimeout(() => setBursts((x) => x.filter((y) => y.id !== id)), 1400)
  }

  /** Cars already in the lane the chicken enters: stop behind the barrier, drive on if past, vanish if overlapping. */
  const clearLane = (lane: number) => {
    const root = stageRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>(`[data-lane="${lane}"]`).forEach((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      const top = m.m42
      const bottom = top + el.offsetHeight
      if (bottom < barrierTop + P) el.style.animationPlayState = 'paused'
      else if (top > roadY + 6 * P) {
        /* already past the chicken */
      } else {
        el.style.transition = 'opacity .12s'
        el.style.opacity = '0'
      }
    })
  }

  /* ---------------- round flow ---------------- */
  const finish = (win: boolean, lanesCrossed: number, betAmt: number) => {
    const mult = win ? mults[Math.min(lanesCrossed, lanes) - 1] : 0
    const payout = round2(betAmt * mult)
    settle({ game: 'chicken', bet: betAmt, payout, meta: { difficulty: diff, lanes: lanesCrossed } })
    setResult({ win, mult, amount: payout })
    if (win) (mult >= 10 ? sfx.bigWin : sfx.win)()
  }

  const step = (fromPos: number, betAmt: number) => {
    const target = fromPos + 1
    if (target >= lanes) return
    setBusy(true)
    setHop((h) => h + 1)
    setHopping(true)
    setPos(target)
    sfx.step()
    const survives = rand() < DIFFS[diff].survive
    clearLane(target)
    setTimeout(() => {
      setHopping(false)
      addBurst({ x: sideW + target * laneW + laneW / 2, y: roadY + 2 * P, kind: 'dust' })
    }, 360)

    if (survives) {
      setTimeout(() => {
        setBusy(false)
        if (target === lanes - 1) {
          setTimeout(() => {
            setHop((h) => h + 1)
            setHopping(true)
            setPos(lanes)
            setPhase('cashed')
            setTimeout(() => setHopping(false), 360)
            finish(true, lanes, betAmt)
            addBurst({ x: sideW + lanes * laneW + sideW / 2, y: chickenTop, kind: 'coins' })
          }, 250)
        }
      }, 380)
    } else {
      const v = { kind: (rand() < 0.3 ? 'truck' : 'sedan') as VehicleKind, color: '#ff4d61' }
      setTimeout(() => setKiller({ lane: target, id: seq++, ...v }), 300)
    }
  }

  const onKillerImpact = () => {
    const lane = st.current.pos
    setDeathLane(lane)
    setPhase('dead')
    setShaking(true)
    setTimeout(() => setShaking(false), 450)
    sfx.lose()
    setBusy(false)
    addBurst({ x: sideW + lane * laneW + laneW / 2, y: chickenTop + 8 * P, kind: 'feathers' })
    finish(false, lane, roundBet)
  }

  const play = () => {
    if (busy) return
    if (!stake(bet)) return
    setRoundBet(bet)
    setResult(null)
    setDeathLane(null)
    setKiller(null)
    setCars([])
    lastSpawn.current = {}
    const wasAtStart = pos === -1
    setPos(-1)
    setPhase('playing')
    setBusy(true)
    setTimeout(() => step(-1, bet), wasAtStart ? 60 : 520)
  }

  const go = () => {
    if (phase !== 'playing' || busy) return
    step(pos, roundBet)
  }

  const cashOut = () => {
    if (phase !== 'playing' || busy || pos < 0) return
    setPhase('cashed')
    finish(true, pos + 1, roundBet)
    addBurst({ x: xOf(pos), y: chickenTop, kind: 'coins' })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        phase === 'playing' ? go() : play()
      } else if (e.code === 'Enter' && phase === 'playing') {
        e.preventDefault()
        cashOut()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const killerSprite = killer ? vehicle(killer.kind, killer.color) : null
  const killerH = killerSprite ? killerSprite.h * P : 0
  const killerFrom = -killerH - 8 * P
  const killerTo = size.h + 40
  const killerDur = killer?.kind === 'truck' ? 0.72 : 0.6
  const impactAt = (chickenTop + 2 * P - killerH - killerFrom) / (killerTo - killerFrom)

  /* ---------------- render ---------------- */
  const playing = phase === 'playing'
  const chickenSprite = phase === 'dead' ? spr.cooked : hopping ? spr.hop : blink ? spr.blink : spr.idle
  const px = (s: Sprite, scale = P, style?: CSSProperties) => (
    <img src={s.url} width={s.w * scale} height={s.h * scale} style={{ ...pixelated, ...style }} draggable={false} alt="" />
  )
  const tile = (s: Sprite, scale = P): CSSProperties => ({
    backgroundImage: `url(${s.url})`,
    backgroundSize: `${s.w * scale}px ${s.h * scale}px`,
    ...pixelated,
  })

  const panel = (
    <>
      <BetInput value={bet} onChange={setBet} disabled={playing} />
      <div>
        <Label>Difficulty</Label>
        <Segmented
          value={diff}
          disabled={playing}
          onChange={(d) => {
            setDiff(d)
            if (phase !== 'playing') {
              setPos(-1)
              setResult(null)
              setDeathLane(null)
              setPhase('idle')
              setCars([])
            }
          }}
          options={(Object.keys(DIFFS) as Difficulty[]).map((d) => ({ value: d, label: DIFFS[d].label }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Lanes" value={lanes} />
        <Stat label="Survive / lane" value={`${Math.round(DIFFS[diff].survive * 100)}%`} />
        <Stat label="First lane" value={fmtMult(mults[0])} />
        <Stat label="Max win" value={fmtMult(mults[lanes - 1])} tone="gold" />
      </div>

      <div className="flex flex-col gap-2 max-lg:order-first lg:mt-auto">
        {playing ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <ActionButton onClick={go} disabled={busy} sub={next ? `Next lane ${fmtMult(next)}` : undefined}>
              Go
            </ActionButton>
            <ActionButton tone="gold" onClick={cashOut} disabled={busy || pos < 0} sub={pos >= 0 ? `${fmt(roundBet * cur)} coins` : 'Cross a lane first'}>
              Cash out {pos >= 0 ? fmtMult(cur) : ''}
            </ActionButton>
          </div>
        ) : (
          <ActionButton onClick={play} disabled={busy}>
            {phase === 'idle' ? 'Play' : 'Play again'}
          </ActionButton>
        )}
        <p className="hidden text-center text-[11px] text-dim lg:block">Space to go · Enter to cash out</p>
      </div>
    </>
  )

  const labelShadow = `${P / 2}px 0 #0b0f14, -${P / 2}px 0 #0b0f14, 0 ${P / 2}px #0b0f14, 0 -${P / 2}px #0b0f14`

  const stage = (
    <div
      ref={stageRef}
      className={`absolute inset-0 select-none overflow-hidden bg-[#2a3039] ${shaking ? 'shake' : ''}`}
      style={{ ['--stage-h' as string]: `${size.h}px`, fontFamily: PIXEL_FONT }}
    >
      <motion.div className="absolute inset-y-0 left-0" style={{ width: trackW }} animate={{ x: camX }} transition={{ type: 'spring', stiffness: 90, damping: 20, mass: 0.9 }}>
        {/* ---------- start: grass verge + stone sidewalk ---------- */}
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: sideW }}>
          <div className="absolute inset-0" style={tile(spr.stone)} />
          <div className="absolute inset-y-0 left-0" style={{ width: 9 * P, ...tile(spr.grass) }} />
          <div className="absolute inset-y-0" style={{ left: 9 * P, width: P, background: '#2b6b34' }} />
          <div className="absolute inset-y-0 right-0" style={{ width: 4 * P, ...tile(spr.curb) }} />
          {/* props */}
          <div className="absolute" style={{ left: P, top: roadY - 40 * P }}>
            {px(spr.bush)}
          </div>
          <div className="absolute" style={{ left: 2 * P, top: roadY + 24 * P }}>
            {px(spr.bush)}
          </div>
          <div className="absolute" style={{ left: 3 * P, top: roadY - 6 * P }}>
            {px(spr.flowerR)}
          </div>
          <div className="absolute" style={{ left: 5 * P, top: roadY + 10 * P }}>
            {px(spr.flowerB)}
          </div>
          <div className="absolute" style={{ left: 2 * P, top: roadY - 22 * P }}>
            {px(spr.flowerB)}
          </div>
          <div className="absolute" style={{ left: 4 * P, top: roadY + 44 * P }}>
            {px(spr.flowerR)}
          </div>
          <div className="absolute" style={{ left: 2 * P, top: roadY - 64 * P }}>
            {px(spr.flowerR)}
          </div>
        </div>

        {/* ---------- lanes ---------- */}
        <div className="absolute inset-y-0" style={{ left: sideW, width: lanes * laneW, ...tile(spr.asphalt) }} />
        {mults.map((m, i) => {
          const passed = pos > i || (phase === 'cashed' && pos >= i)
          const isCur = pos === i && phase !== 'idle'
          const dead = deathLane === i
          const showBarrier = (passed || (isCur && phase !== 'dead')) && !dead
          const mh: ManholeState = dead ? 'dead' : isCur ? 'current' : passed ? 'passed' : 'idle'
          return (
            <div key={i} className="absolute inset-y-0" style={{ left: sideW + i * laneW, width: laneW }}>
              {i > 0 && (
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: P,
                    transform: `translateX(-${P / 2}px)`,
                    background: `repeating-linear-gradient(to bottom, rgba(236,241,247,.7) 0 ${6 * P}px, transparent ${6 * P}px ${12 * P}px)`,
                  }}
                />
              )}
              {passed && <div className="absolute inset-0 bg-[#22d36f]/[0.05]" />}
              {dead && <div className="absolute inset-0 bg-[#ff4d61]/[0.12]" />}

              <AnimatePresence>
                {showBarrier && (
                  <motion.div
                    className="absolute z-20"
                    style={{ top: barrierTop, left: 2 * P }}
                    initial={{ y: -roadY, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                  >
                    {px(spr.barrier)}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* manhole + multiplier */}
              <div className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: laneW / 2, top: roadY }}>
                <motion.div animate={{ scale: isCur ? 1.08 : 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} className="relative">
                  {isCur && phase !== 'dead' && <div className="glow-pulse absolute inset-[12%] rounded-full" />}
                  {px(spr.manhole[mh])}
                  <span
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      fontSize: Math.round(P * (m >= 100 ? 1.8 : 2.2)),
                      color: dead ? '#ffd0d6' : isCur ? '#fff4c2' : passed ? '#c9ffe0' : '#e8eff6',
                      textShadow: labelShadow,
                    }}
                  >
                    {mx(m)}
                  </span>
                </motion.div>
              </div>
            </div>
          )
        })}

        {/* ---------- finish ---------- */}
        <div className="absolute inset-y-0 overflow-hidden" style={{ left: sideW + lanes * laneW, width: sideW }}>
          <div className="absolute inset-0" style={tile(spr.grass)} />
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: 4 * P, ...pixelated, background: `repeating-conic-gradient(#f4f6f8 0 25%, #151a20 0 50%) 0 0 / ${4 * P}px ${4 * P}px` }}
          />
          <div className="absolute" style={{ left: sideW / 2 - 7 * P, top: roadY - 34 * P }}>
            <div className="float-y relative">
              <div className="absolute -inset-3 rounded-full bg-[#f7c548]/25 blur-xl" />
              {px(spr.egg)}
            </div>
            <div className="mx-auto" style={{ width: 14 * P, height: 6 * P, marginTop: P, ...tile(spr.stone), boxShadow: `0 ${P}px 0 #3d454e` }} />
          </div>
          <div className="absolute inset-x-0 text-center" style={{ top: roadY + 10 * P }}>
            <div className="uppercase text-[#fff4c2]" style={{ fontSize: 2 * P, textShadow: labelShadow }}>
              Finish
            </div>
            <div className="mt-2 text-[#f7c548]" style={{ fontSize: 3 * P, textShadow: labelShadow }}>
              {mx(mults[lanes - 1])}
            </div>
          </div>
          <div className="absolute" style={{ right: 2 * P, top: roadY + 26 * P }}>
            {px(spr.bush)}
          </div>
          <div className="absolute" style={{ right: 3 * P, top: roadY - 52 * P }}>
            {px(spr.bush)}
          </div>
        </div>

        {/* ---------- ambient traffic ---------- */}
        {cars.map((c) => {
          const s = vehicle(c.kind, c.color)
          return (
            <div
              key={c.id}
              data-lane={c.lane}
              className="car-drive absolute top-0 z-30"
              style={{
                left: sideW + c.lane * laneW + (laneW - s.w * P) / 2,
                animationDuration: `${c.dur}s`,
                ['--car-from' as string]: `${-s.h * P - 8 * P}px`,
                filter: 'drop-shadow(0 6px 0 rgba(0,0,0,.28))',
              }}
              onAnimationEnd={() => removeCar(c.id)}
            >
              {px(s)}
            </div>
          )
        })}

        {/* ---------- the car that ends the run ---------- */}
        {killer && killerSprite && (
          <motion.div
            key={killer.id}
            className="absolute top-0 z-40"
            style={{ left: sideW + killer.lane * laneW + (laneW - killerSprite.w * P) / 2, filter: 'drop-shadow(0 6px 0 rgba(0,0,0,.28))' }}
            initial={{ y: killerFrom }}
            animate={{ y: killerTo }}
            transition={{ duration: killerDur, ease: 'linear' }}
            onAnimationStart={() => setTimeout(onKillerImpact, killerDur * impactAt * 1000)}
          >
            {px(killerSprite)}
          </motion.div>
        )}

        {/* ---------- chicken ---------- */}
        <motion.div
          className="absolute z-[35]"
          style={{ top: chickenTop, left: 0 }}
          animate={{ x: xOf(pos) - 9 * P }}
          transition={{ duration: 0.36, ease: [0.3, 0.7, 0.4, 1] }}
        >
          <div className="absolute rounded-[50%] bg-black/30" style={{ left: 3 * P, right: 3 * P, bottom: -P, height: 2 * P }} />
          <motion.div
            key={hop}
            initial={false}
            animate={phase === 'dead' ? { y: 4 * P, rotate: 0 } : { y: [0, -8 * P, 0, 0], scaleY: [1, 1.06, 0.88, 1], scaleX: [1, 0.96, 1.1, 1] }}
            transition={phase === 'dead' ? { duration: 0.12 } : { duration: 0.42, times: [0, 0.45, 0.82, 1], ease: 'easeOut' }}
            style={{ originY: 1 }}
            className={phase !== 'dead' && !hopping ? 'px-bob' : ''}
          >
            {px(chickenSprite)}
          </motion.div>
        </motion.div>

        {/* ---------- particles ---------- */}
        {bursts.map((b) => (
          <Particles key={b.id} burst={b} P={P} coinUrl={b.kind === 'coins' ? coin().url : undefined} />
        ))}
      </motion.div>

      {/* top & bottom haze */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(11,21,32,.5),transparent_16%,transparent_84%,rgba(11,21,32,.6))]" />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-start justify-between gap-2 p-3 sm:p-4">
        <div className="flex gap-2">
          <HudChip label="Multiplier" value={pos >= 0 ? mx(cur) : '-'} tone={pos >= 0 ? 'gold' : undefined} />
          {playing && next && <HudChip label="Next" value={mx(next)} />}
        </div>
        {playing && <HudChip label="Lane" value={`${Math.max(0, pos + 1)}/${lanes}`} />}
      </div>

      {/* result */}
      <AnimatePresence>
        {result && (
          <motion.div
            key={`${result.win}-${result.mult}-${result.amount}`}
            className="pointer-events-none absolute inset-x-0 top-[14%] z-50 flex justify-center"
            initial={{ opacity: 0, scale: 0.6, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 360, damping: 18, delay: result.win ? 0.05 : 0.35 }}
          >
            {result.win ? (
              <PixelCard tone="win">
                <div className="text-[32px] leading-none text-[#7dffb2]" style={{ textShadow: '3px 3px 0 #0a3b22' }}>
                  {mx(result.mult)}
                </div>
                <div className="mt-3 text-[13px] text-white">+{fmt(result.amount)} coins</div>
              </PixelCard>
            ) : (
              <PixelCard tone="loss">
                <div className="text-[22px] leading-none text-[#ffd0d6]" style={{ textShadow: '3px 3px 0 #4a0d17' }}>
                  Roadkill!
                </div>
                <div className="mt-3 text-[11px] text-white/70">Hit on lane {(deathLane ?? 0) + 1}</div>
              </PixelCard>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === 'idle' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center">
            <div className="bg-black/55 px-4 py-2.5 text-[11px] text-white/85" style={{ boxShadow: '0 0 0 3px rgba(0,0,0,.35)' }}>
              Press Play to start crossing
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}



/** Square pixel particles: dust on landing, feathers on a hit, coins on a cash out. */
function Particles({ burst, P, coinUrl }: { burst: Burst; P: number; coinUrl?: string }) {
  const parts = useMemo(() => {
    const n = burst.kind === 'dust' ? 7 : burst.kind === 'feathers' ? 16 : 14
    return Array.from({ length: n }, (_, i) => {
      const a = burst.kind === 'dust' ? Math.PI + (i / (n - 1)) * Math.PI : (i / n) * Math.PI * 2 + rand() * 0.5
      const d = burst.kind === 'dust' ? (3 + rand() * 5) * P : (6 + rand() * 12) * P
      return {
        x: Math.cos(a) * d,
        y: burst.kind === 'coins' ? -(8 + rand() * 16) * P : Math.sin(a) * d * (burst.kind === 'dust' ? 0.4 : 1),
        drop: burst.kind === 'dust' ? 0 : (6 + rand() * 6) * P,
        s: burst.kind === 'dust' ? P * (1 + Math.round(rand())) : P * (1 + Math.round(rand() * 1.4)),
        r: Math.round(rand() * 4) * 90,
        c: burst.kind === 'dust' ? (rand() > 0.5 ? '#9aa4ae' : '#c3cbd3') : rand() > 0.3 ? '#ffffff' : '#dde2e9',
      }
    })
  }, [burst, P])
  return (
    <div className="pointer-events-none absolute z-[45]" style={{ left: burst.x, top: burst.y }}>
      {parts.map((p, i) =>
        coinUrl ? (
          <motion.img
            key={i}
            src={coinUrl}
            alt=""
            className="absolute"
            style={{ width: 8 * P * 0.6, height: 8 * P * 0.6, imageRendering: 'pixelated' }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: p.x * 0.8, y: [0, p.y, p.y + 14 * P], opacity: [1, 1, 0] }}
            transition={{ duration: 1.2, ease: 'easeOut', times: [0, 0.45, 1] }}
          />
        ) : (
          <motion.div
            key={i}
            className="absolute"
            style={{ width: p.s, height: p.s, background: p.c }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: p.x, y: [0, p.y, p.y + p.drop], opacity: [1, 1, 0], rotate: p.r }}
            transition={{ duration: burst.kind === 'dust' ? 0.5 : 1.1, ease: 'easeOut', times: [0, 0.4, 1] }}
          />
        ),
      )}
    </div>
  )
}
