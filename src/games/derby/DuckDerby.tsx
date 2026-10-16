import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Toggle, useStake } from '../../components/ui'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { safeStorage } from '../../lib/storage'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { DuckArt, DuckBadge } from './art'
import { COURSE, planning, type Caption, type Plan } from './race'
import { DerbyScene, laneRow, stageLayout } from './scene'
import {
  DUCKS,
  LANES,
  LONGSHOT,
  MAX_BETS,
  betKey,
  betMult,
  betPayout,
  betWins,
  bestReturn,
  dealChances,
  drawOrder,
  oddsLabel,
  ordinal,
  probs,
  type Bet,
  type BetKind,
} from './rules'

/*
  Duck Derby: six rubber ducks race down a wild river. Before each race the ducks get fresh chances (shown as odds on
  their lanes); the player puts Win, Place and Forecast bets on a slip, one stake for the whole slip, and the race
  runs. The finishing order is drawn the moment the race starts (rules.ts) and the race is built to end in it
  (race.ts); the canvas (scene.ts) plays it out. The round settles once, when the podium shows, or straight away if
  the page is left mid-race; a round whose page died without paying is paid on the next visit.
*/

interface Result {
  race: number
  order: number[]
  /** each lane's chance in whole percent */
  chances: number[]
  at: number
}
interface Store {
  /** the next race's number and its chances */
  race: number
  next: number[]
  /** newest first */
  results: Result[]
}
interface Pending {
  bet: number
  payout: number
  meta: Record<string, number | string | boolean>
  result: Result
  key: string
}
interface SlipLine {
  bet: Bet
  mult: number
  won: boolean
  payout: number
}
interface Podium {
  race: number
  order: number[]
  chances: number[]
  lines: SlipLine[]
  stake: number
  payout: number
}
type Phase = 'betting' | 'countdown' | 'racing' | 'podium'

const KEEP = 40
const storeKey = (uid: string | null) => `lumen.derby.${uid ?? 'guest'}`
const pendingKey = (uid: string | null) => `lumen.derby.pending.${uid ?? 'guest'}`
const TURBO_KEY = 'lumen.derby.turbo'

/** a first visit gets a few earlier races, so the form guide has something to say */
function seedStore(): Store {
  const results: Result[] = []
  for (let r = 1; r <= 6; r++) {
    const chances = dealChances(rand)
    results.unshift({ race: r, chances, order: drawOrder(probs(chances), rand), at: Date.now() - (7 - r) * 90_000 })
  }
  return { race: 7, next: dealChances(rand), results }
}

function loadStore(uid: string | null): Store {
  try {
    const s = JSON.parse(safeStorage.getItem(storeKey(uid)) ?? 'null') as Store | null
    if (s && Array.isArray(s.next) && s.next.length === LANES && Array.isArray(s.results) && typeof s.race === 'number') return s
  } catch {
    /* a damaged entry: start over */
  }
  const s = seedStore()
  safeStorage.setItem(storeKey(uid), JSON.stringify(s))
  return s
}

/** records a finished race and deals the next one; a race already recorded is left alone */
function commitResult(uid: string | null, r: Result): Store {
  const s = loadStore(uid)
  if (s.results.some((x) => x.race === r.race)) return s
  const next: Store = { race: Math.max(s.race, r.race) + 1, next: dealChances(rand), results: [r, ...s.results].slice(0, KEEP) }
  safeStorage.setItem(storeKey(uid), JSON.stringify(next))
  return next
}

const KIND_LABEL: Record<BetKind, string> = { win: 'Win', place: 'Place', forecast: 'Forecast' }
const KIND_SHORT: Record<BetKind, string> = { win: 'WIN', place: 'PLC', forecast: 'FC' }
const KIND_HINT: Record<BetKind, string> = {
  win: 'Back a duck to finish first.',
  place: 'Pays if your duck finishes first or second.',
  forecast: 'Pick first and second in the exact order.',
}

function verdict(gap: number) {
  return gap < 0.2 ? 'by a beak' : gap < 0.42 ? 'by a head' : gap < 0.75 ? 'by a neck' : 'by a length'
}

const PLACE_TONE = ['#f7c548', '#c9d6e3', '#d79a63']

export default function DuckDerby() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [store, setStore] = useState<Store>(() => loadStore(uid))
  const [bet, setBet] = useState(10)
  const [kind, setKind] = useState<BetKind>('win')
  const [slip, setSlip] = useState<Bet[]>([])
  const [lastSlip, setLastSlip] = useState<Bet[]>([])
  const [fcFirst, setFcFirst] = useState<number | null>(null)
  const [turbo, setTurbo] = useState(() => safeStorage.getItem(TURBO_KEY) === '1')
  const [phase, setPhase] = useState<Phase>('betting')
  const [count, setCount] = useState<string | null>(null)
  const [rank, setRank] = useState<number[]>([0, 1, 2, 3, 4, 5])
  const [caption, setCaption] = useState<{ id: number; text: string; pri: number } | null>(null)
  const [photo, setPhoto] = useState<{ shot: HTMLCanvasElement; fx: number; winner: number; text: string } | null>(null)
  const [showPhoto, setShowPhoto] = useState(false)
  const [flash, setFlash] = useState(0)
  const [podium, setPodium] = useState<Podium | null>(null)
  const [hurried, setHurried] = useState(false)
  const [form, setForm] = useState<number | null | 'all'>(null)
  const [curtain, setCurtain] = useState(false)
  const [stageRef, size] = useSize<HTMLDivElement>()

  const sceneHost = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<DerbyScene | null>(null)
  const pending = useRef<Pending | null>(null)
  const planRef = useRef<Plan | null>(null)
  const podiumRef = useRef<Podium | null>(null)
  const capRef = useRef<{ at: number; pri: number }>({ at: 0, pri: 0 })
  const capTimer = useRef(0)
  const timers = useRef<number[]>([])
  const alive = useRef(true)
  const dots = useRef<(HTMLDivElement | null)[]>([])
  const mapRef = useRef<HTMLDivElement>(null)
  const mapW = useRef(0)
  const uidRef = useRef(uid)
  uidRef.current = uid
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const seq = useRef(1)

  const p = useMemo(() => probs(store.next), [store.next])
  const fav = useMemo(() => store.next.indexOf(Math.max(...store.next)), [store.next])
  const lay = stageLayout(size.w, size.h)
  const total = round2(bet * slip.length)
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(() => alive.current && fn(), ms))
  }

  /* ---------------- settling ---------------- */

  /** pays the race in play, once: when the podium shows, or as soon as the player leaves (the order is already drawn) */
  const settlePending = useCallback(() => {
    const pd = pending.current
    if (!pd) return
    pending.current = null
    safeStorage.removeItem(pd.key)
    useWallet.getState().settle({ game: 'derby', bet: pd.bet, payout: pd.payout, meta: pd.meta })
    const s = commitResult(uidRef.current, pd.result)
    if (alive.current) setStore(s)
  }, [])

  // reloading, closing the tab or leaving the site mid-race pays on the way out (not on a mere tab switch: the header
  // balance would give the result away)
  useEffect(() => {
    window.addEventListener('beforeunload', settlePending)
    window.addEventListener('pagehide', settlePending)
    return () => {
      window.removeEventListener('beforeunload', settlePending)
      window.removeEventListener('pagehide', settlePending)
    }
  }, [settlePending])

  // a different player: their own form book; and a race whose page died before paying is paid now
  useEffect(() => {
    if (authStatus === 'loading' || pending.current) return
    setStore(loadStore(uid))
    const key = pendingKey(uid)
    const raw = safeStorage.getItem(key)
    if (raw == null) return
    safeStorage.removeItem(key)
    let pd: Partial<Pending> | null = null
    try {
      pd = JSON.parse(raw)
    } catch {
      /* a damaged entry */
    }
    if (typeof pd?.bet !== 'number' || typeof pd.payout !== 'number') return
    useWallet.getState().settle({ game: 'derby', bet: pd.bet, payout: pd.payout, meta: { ...pd.meta, recovered: true } })
    if (pd.result && Array.isArray(pd.result.order)) setStore(commitResult(uid, pd.result))
    if (pd.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Duck Derby race paid out', amount: pd.payout })
  }, [authStatus, uid])

  /* ---------------- the scene ---------------- */

  const say = useCallback((c: Caption) => {
    const now = performance.now()
    const hold = turboRef.current ? 750 : 1300
    if (now - capRef.current.at < hold && c.pri <= capRef.current.pri) return
    capRef.current = { at: now, pri: c.pri }
    setCaption({ id: seq.current++, text: c.text, pri: c.pri })
    clearTimeout(capTimer.current)
    capTimer.current = window.setTimeout(() => alive.current && setCaption(null), turboRef.current ? 1500 : 2600)
  }, [])

  useEffect(() => {
    alive.current = true
    const sc = new DerbyScene(sceneHost.current!, {
      rank: (o) => setRank(o),
      caption: say,
      progress: (pr) => {
        const w = mapW.current
        for (let i = 0; i < LANES; i++) {
          const el = dots.current[i]
          if (el) el.style.transform = `translate3d(${(Math.min(1.02, Math.max(0, pr[i])) * w).toFixed(1)}px,0,0)`
        }
      },
      cross: (_lane, place) => {
        if (place === 1) later(() => setShowPhoto(true), 250)
      },
      photo: (shot, fx) => {
        const plan = planRef.current!
        setFlash((f) => f + 1)
        setPhoto({ shot, fx, winner: plan.order[0], text: `${DUCKS[plan.order[0]].name} ${verdict(plan.gapDL)}!` })
      },
      end: () => finish(),
      tapDuck: (lane) => {
        sceneRef.current?.poke(lane)
        setForm(lane)
      },
    })
    sceneRef.current = sc
    // screenshots of a given moment (tools/derby-*.mjs); not in a production build
    const devHook = window as unknown as { __derby?: DerbyScene }
    if (import.meta.env.DEV) devHook.__derby = sc
    return () => {
      // (and the hook must not keep a disposed scene alive)
      if (devHook.__derby === sc) delete devHook.__derby
      alive.current = false
      timers.current.forEach(clearTimeout)
      clearTimeout(capTimer.current)
      sc.dispose()
      sceneRef.current = null
      settlePending()
    }
    // the scene lives as long as the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    sceneRef.current?.resize(size.w, size.h)
    mapW.current = mapRef.current?.clientWidth ?? 0
  }, [size.w, size.h])

  useEffect(() => {
    sceneRef.current?.setTurbo(turbo)
    safeStorage.setItem(TURBO_KEY, turbo ? '1' : '0')
  }, [turbo])

  /* ---------------- the slip ---------------- */

  const has = (b: Bet) => slip.some((x) => betKey(x) === betKey(b))
  const toggle = (b: Bet) => {
    if (phase !== 'betting') return
    if (has(b)) {
      setSlip((s) => s.filter((x) => betKey(x) !== betKey(b)))
      sfx.derby.release()
      return
    }
    if (slip.length >= MAX_BETS) {
      useWallet.getState().pushToast({ kind: 'info', title: `Up to ${MAX_BETS} bets per race` })
      return
    }
    setSlip((s) => [...s, b])
    sfx.derby.squeeze()
  }
  const pickForecast = (lane: number) => {
    if (phase !== 'betting') return
    if (fcFirst == null) {
      setFcFirst(lane)
      sfx.click()
    } else if (fcFirst === lane) {
      setFcFirst(null)
      sfx.derby.release()
    } else {
      toggle({ kind: 'forecast', a: fcFirst, b: lane })
      setFcFirst(null)
    }
  }
  useEffect(() => {
    if (kind !== 'forecast') setFcFirst(null)
  }, [kind])

  /* ---------------- a race ---------------- */

  const start = () => {
    if (phase !== 'betting' || !slip.length || !sceneRef.current) return
    const stakeAll = round2(bet * slip.length)
    if (!stake(stakeAll)) return
    const chances = store.next
    const pr = probs(chances)
    const order = drawOrder(pr, rand)
    // the race itself is planned a few candidates per slice while the countdown runs (it is only needed at GO)
    const steps = planning(order, rand)
    planRef.current = null
    let step = steps.next()
    const pump = () => {
      const t0 = performance.now()
      while (!step.done && performance.now() - t0 < 6) step = steps.next()
      if (step.done) planRef.current = step.value
      else timers.current.push(window.setTimeout(pump, 0))
    }
    timers.current.push(window.setTimeout(pump, 0))
    const lines: SlipLine[] = slip.map((b) => ({ bet: b, mult: betMult(pr, b), won: betWins(b, order), payout: betPayout(pr, b, bet, order) }))
    const payout = round2(lines.reduce((a, l) => a + l.payout, 0))
    const longshot = lines.some((l) => l.bet.kind === 'win' && l.won && l.mult >= LONGSHOT)
    const result: Result = { race: store.race, order, chances, at: Date.now() }
    const meta = { longshot, bets: slip.length, winner: DUCKS[order[0]].name, mult: round2(payout / stakeAll) }
    const key = pendingKey(uid)
    // stored before the race starts, so even a page that never gets to settle can't lose it
    pending.current = { bet: stakeAll, payout, meta, result, key }
    safeStorage.setItem(key, JSON.stringify({ bet: stakeAll, payout, meta, result }))
    podiumRef.current = { race: store.race, order, chances, lines, stake: stakeAll, payout }
    setLastSlip(slip)
    setFcFirst(null)
    setPhoto(null)
    setShowPhoto(false)
    setPodium(null)
    setHurried(false)
    setCaption(null)
    capRef.current = { at: 0, pri: 0 }
    setPhase('countdown')
    sceneRef.current.ready()
    if (size.w < 1024) stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const beat = turbo ? 380 : 620
    const counts = ['3', '2', '1']
    counts.forEach((n, i) =>
      later(() => {
        setCount(n)
        sfx.derby.pip()
      }, i * beat),
    )
    later(() => {
      // finish the plan here if the slices have not (a very slow device)
      while (!step.done) step = steps.next()
      const plan = step.value
      planRef.current = plan
      setCount('GO!')
      sfx.derby.horn()
      setRank([0, 1, 2, 3, 4, 5])
      sceneRef.current?.race(plan, turboRef.current)
      setPhase('racing')
    }, counts.length * beat)
    later(() => setCount(null), counts.length * beat + 650)
  }

  const finish = () => {
    const pd = podiumRef.current
    if (!pd) return
    settlePending()
    setShowPhoto(false)
    setPodium(pd)
    setPhase('podium')
    setCaption(null)
    if (pd.payout > 0) {
      sfx.derby.fanfare(pd.payout >= pd.stake * 5)
      later(() => sfx.coin(), 500)
    } else sfx.derby.lose()
  }

  const nextRace = () => {
    if (phase !== 'podium' || curtain) return
    sfx.click()
    // a quick wash of river blue while the field is carried back to the start
    setCurtain(true)
    later(() => {
      sceneRef.current?.reset()
      setPodium(null)
      setPhoto(null)
      setSlip([])
      setRank([0, 1, 2, 3, 4, 5])
      setPhase('betting')
      setCurtain(false)
    }, 260)
  }

  const hurry = () => {
    if (sceneRef.current?.hurry()) {
      setHurried(true)
      sfx.click()
    }
  }

  // Space starts the race, hurries it along and moves on to the next one
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || form != null) return
      if (e.code !== 'Space') return
      e.preventDefault()
      if (e.repeat) return
      if (phase === 'betting') start()
      else if (phase === 'racing') hurry()
      else if (phase === 'podium') nextRace()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  // the odds the slip was struck at (once the race is home the store already holds the next race's) and the most it can
  // return: its best finishing order, not the sum of bets that can't all win together
  const slipP = useMemo(() => (podium ? probs(podium.chances) : p), [podium, p])
  const best = useMemo(() => bestReturn(slipP, slip, bet), [slipP, slip, bet])
  const action =
    phase === 'betting' ? (
      <ActionButton onClick={start} disabled={!slip.length || total > balance} sub={!slip.length ? 'Add a bet from the race card' : total > balance ? `Not enough coins for ${fmt(total)}` : `${slip.length} bet${slip.length > 1 ? 's' : ''} · ${fmt(total)}`}>
        Start race
      </ActionButton>
    ) : phase === 'podium' ? (
      <ActionButton onClick={nextRace} sub="Fresh odds, new race">
        Next race
      </ActionButton>
    ) : (
      <ActionButton tone="neutral" onClick={hurry} disabled={phase !== 'racing' || hurried} sub={hurried ? 'Fast forward' : 'Or tap the river'}>
        {hurried ? 'Hurrying…' : 'Hurry up'}
      </ActionButton>
    )

  const panel = (
    <>
      <BetInput value={bet} onChange={setBet} disabled={phase !== 'betting'} />
      <SlipCard
        slip={slip}
        p={slipP}
        bet={bet}
        locked={phase !== 'betting'}
        podium={podium}
        onRemove={(b) => toggle(b)}
        onClear={() => {
          setSlip([])
          sfx.derby.release()
        }}
        onRebet={lastSlip.length && !slip.length && phase === 'betting' ? () => (setSlip(lastSlip.slice(0, MAX_BETS)), sfx.derby.squeeze()) : undefined}
        best={best}
      />
      {/* on a phone the button sits right under the river, where the bets are placed */}
      <div className="order-first lg:order-none">{action}</div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2.5">
        <div>
          <div className="text-[13px] font-bold">Turbo</div>
          <div className="text-[11px] text-dim">A seven-second race</div>
        </div>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Space starts the race, hurries it along and calls the next one. Every bet pays 97% of its true odds.</p>
    </>
  )

  /* ---------------- stage ---------------- */

  const betting = phase === 'betting'
  const recent = store.results.slice(0, 10)
  /** the ducks on the slip, marked in the live order and on the course map so the player can follow their own */
  const mine = useMemo(() => new Set(slip.flatMap((b) => (b.b != null ? [b.a, b.b] : [b.a]))), [slip])
  const stage = (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden"
      onPointerDown={() => {
        if (phase === 'racing') hurry()
      }}
    >
      <div ref={sceneHost} className="absolute inset-0" />

      {/* top: recent winners and the form guide while betting; the live order while racing */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-2.5 sm:p-3">
        <AnimatePresence mode="wait" initial={false}>
          {betting ? (
            <motion.div key="hist" className="flex items-center gap-2" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="tnum shrink-0 rounded-full bg-[#0b2233]/80 px-3 py-1.5 text-[12px] font-extrabold text-ink">Race {store.race}</div>
              <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-hidden">
                {recent.map((r) => (
                  <div key={r.race} title={`Race ${r.race}: ${r.order.map((l) => DUCKS[l].name).join(', ')}`} className="tnum flex shrink-0 items-center gap-1 rounded-full bg-[#0b2233]/80 py-0.5 pl-0.5 pr-2.5 text-[11.5px] font-extrabold" style={{ color: DUCKS[r.order[0]].light }}>
                    <DuckBadge lane={r.order[0]} size={22} />
                    {oddsLabel(0.97 / (r.chances[r.order[0]] / 100))}
                  </div>
                ))}
              </div>
              <button onClick={() => setForm('all')} className="pointer-events-auto shrink-0 rounded-full bg-[#0b2233]/85 px-3 py-1.5 text-[12px] font-extrabold text-ink transition hover:bg-[#123248]">
                Form guide
              </button>
            </motion.div>
          ) : (
            <motion.div key="race" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <RankStrip rank={rank} phone={lay.phone} mine={mine} />
            </motion.div>
          )}
        </AnimatePresence>
        {/* the course map: a dot per duck */}
        <div className={`mx-1 mt-2 transition-opacity duration-300 ${betting ? 'opacity-0' : 'opacity-100'}`}>
          <div ref={mapRef} className="relative h-4">
            <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#0b2233]/70" />
            {[
              [COURSE.rapids[0], '≈'],
              [COURSE.falls, '▼'],
              [1, '⚑'],
            ].map(([x, s]) => (
              <span key={String(s)} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-black text-white/80" style={{ left: `${(x as number) * 100}%` }}>
                {s}
              </span>
            ))}
            {DUCKS.map((d, i) => (
              <div
                key={i}
                ref={(el) => void (dots.current[i] = el)}
                className={`absolute left-0 top-1/2 rounded-full border-2 will-change-transform ${mine.has(i) ? '-ml-[8px] -mt-[8px] h-4 w-4 border-white shadow-[0_0_0_2px_#26182f]' : '-ml-[7px] -mt-[7px] h-[14px] w-[14px] border-[#26182f]'}`}
                style={{ background: d.color, zIndex: (mine.has(i) ? 20 : 10) - rank.indexOf(i) }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* the race card, laid on the lanes */}
      <AnimatePresence>
        {betting && size.w > 0 && (
          <motion.div key="card" className="absolute inset-0 z-[5]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
            <KindTabs kind={kind} onChange={setKind} top={laneRow(lay, 0).top - (lay.phone ? 66 : 60)} first={fcFirst} phone={lay.phone} />
            {DUCKS.map((_, lane) => (
              <LaneRow
                key={lane}
                lane={lane}
                row={laneRow(lay, lane)}
                width={size.w}
                phone={lay.phone}
                kind={kind}
                chance={store.next[lane]}
                p={p}
                fav={lane === fav}
                form={store.results.slice(0, 5).map((r) => r.order.indexOf(lane))}
                has={has}
                onToggle={toggle}
                fcFirst={fcFirst}
                onPick={pickForecast}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* commentary */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3 sm:bottom-5">
        <AnimatePresence mode="popLayout">
          {caption && !podium && (
            <motion.div
              key={caption.id}
              initial={{ opacity: 0, y: 14, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 30 }}
              className="flex max-w-[94%] items-center gap-2 rounded-2xl border-[2.5px] border-[#26182f] bg-white py-1.5 pl-1.5 pr-3.5 text-[13px] font-extrabold leading-tight text-[#26182f] shadow-[0_6px_0_rgba(38,24,47,.35)] sm:text-[15px]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ffd23f] sm:h-8 sm:w-8">
                <MicIcon />
              </span>
              {caption.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {phase === 'racing' && !hurried && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 1.2 } }} className="pointer-events-none absolute right-3 top-[74px] z-10 rounded-full bg-[#0b2233]/75 px-2.5 py-1 text-[11px] font-bold text-white/85 sm:top-[84px]">
          Tap to hurry ⏩
        </motion.div>
      )}

      {/* the countdown */}
      <AnimatePresence>
        {count && (
          <motion.div key={count} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.5, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 520, damping: 22 }}>
            <span className="text-[86px] font-black leading-none text-white sm:text-[120px]" style={{ WebkitTextStroke: '6px #26182f', paintOrder: 'stroke', textShadow: '0 8px 0 rgba(38,24,47,.45)', color: count === 'GO!' ? '#ffd23f' : '#fff' }}>
              {count}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* the finish-line camera */}
      <AnimatePresence>
        {flash > 0 && (
          <motion.div key={flash} className="pointer-events-none absolute inset-0 z-20 bg-white" initial={{ opacity: 0.85 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }} />
        )}
      </AnimatePresence>
      <AnimatePresence>{photo && showPhoto && !podium && <PhotoCard key="photo" photo={photo} phone={lay.phone} />}</AnimatePresence>

      {/* the podium */}
      <AnimatePresence>{podium && <PodiumCard key="podium" podium={podium} phone={lay.phone} onNext={nextRace} />}</AnimatePresence>
      <AnimatePresence>
        {curtain && <motion.div key="curtain" className="pointer-events-none absolute inset-0 z-40 bg-[#7fd6f5]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }} transition={{ duration: 0.22 }} />}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="!bg-[#5cc7ff]" />
      <AnimatePresence>{form != null && <FormGuide key="form" store={store} focus={form === 'all' ? null : form} onClose={() => setForm(null)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- pieces ---------------- */

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#26182f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="#fff" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  )
}

function KindTabs({ kind, onChange, top, first, phone }: { kind: BetKind; onChange: (k: BetKind) => void; top: number; first: number | null; phone: boolean }) {
  return (
    <div className={`absolute inset-x-0 flex flex-col gap-1 px-3 ${phone ? 'items-end' : 'items-center'}`} style={{ top }}>
      <div className="flex rounded-full border-2 border-[#26182f] bg-[#0b2233]/90 p-1 shadow-[0_4px_0_rgba(38,24,47,.35)]">
        {(['win', 'place', 'forecast'] as BetKind[]).map((k) => (
          <button
            key={k}
            onClick={() => {
              if (k === kind) return
              sfx.click()
              onChange(k)
            }}
            className={`relative rounded-full px-3.5 py-1 text-[12.5px] font-extrabold transition-colors sm:px-5 sm:py-1.5 sm:text-[13px] ${k === kind ? 'text-[#26182f]' : 'text-white/75 hover:text-white'}`}
          >
            {k === kind && <motion.span layoutId="derby-kind" className="absolute inset-0 -z-0 rounded-full bg-[#ffd23f]" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
            <span className="relative">{KIND_LABEL[k]}</span>
          </button>
        ))}
      </div>
      <div className="rounded-full bg-[#0b2233]/70 px-2.5 py-0.5 text-[11px] font-semibold text-white/85">{kind === 'forecast' && first != null ? `${DUCKS[first].name} first. Now pick second.` : KIND_HINT[kind]}</div>
    </div>
  )
}

const LaneRow = memo(function LaneRow({
  lane,
  row,
  width,
  phone,
  kind,
  chance,
  p,
  fav,
  form,
  has,
  onToggle,
  fcFirst,
  onPick,
}: {
  lane: number
  row: { top: number; h: number; left: number }
  width: number
  phone: boolean
  kind: BetKind
  chance: number
  p: number[]
  fav: boolean
  form: number[]
  has: (b: Bet) => boolean
  onToggle: (b: Bet) => void
  fcFirst: number | null
  onPick: (lane: number) => void
}) {
  const d = DUCKS[lane]
  const h = Math.min(row.h - 6, phone ? 38 : 50)
  const right = phone ? 8 : 18
  const maxW = phone ? 9999 : 640
  const w = Math.min(maxW, width - right - row.left)
  const bet: Bet = { kind: kind === 'forecast' ? 'win' : kind, a: lane }
  const on = kind !== 'forecast' && has(bet)
  const btn = 'tnum flex h-full shrink-0 flex-col items-center justify-center rounded-full border-2 font-black leading-none transition active:scale-95'
  return (
    <motion.div
      className="absolute flex items-center gap-2 rounded-full border-2 border-[#26182f] bg-[#0b2233]/85 py-1 pl-1 pr-1 shadow-[0_3px_0_rgba(38,24,47,.35)]"
      style={{ top: row.top + (row.h - h) / 2 - 2, left: row.left, width: w, height: h }}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: lane * 0.035, type: 'spring', stiffness: 420, damping: 32 }}
    >
      <span className="flex h-full shrink-0 items-center justify-center rounded-full px-1.5 text-[12px] font-black text-[#26182f]" style={{ background: d.color, minWidth: h - 8 }}>
        {lane + 1}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5 truncate text-[13px] font-extrabold text-white sm:text-[14px]">
          <span className="truncate">{d.name}</span>
          {fav && <span className="shrink-0 rounded bg-[#ffd23f] px-1 text-[9px] font-black text-[#26182f]">FAV</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-white/60">
          {!phone && <span className="truncate">{d.trait}</span>}
          <span className="tnum flex shrink-0 gap-[3px]" title="Last five races, newest first">
            {form.map((f, i) =>
              f < 0 ? null : (
                <span key={i} className="rounded-[3px] px-[3px] text-[9.5px] font-black leading-[13px]" style={{ background: f < 3 ? PLACE_TONE[f] : 'rgba(255,255,255,.14)', color: f < 3 ? '#26182f' : 'rgba(255,255,255,.75)' }}>
                  {f + 1}
                </span>
              ),
            )}
          </span>
          {!phone && <span className="tnum shrink-0 text-white/45">{chance}%</span>}
        </div>
      </div>
      {kind === 'forecast' ? (
        <>
          <button onClick={() => onPick(lane)} className={`${btn} w-[52px] text-[12px] sm:w-[64px] ${fcFirst === lane ? 'border-[#26182f] bg-[#ffd23f] text-[#26182f]' : 'border-white/15 bg-white/10 text-white hover:bg-white/20'}`} disabled={fcFirst != null && fcFirst !== lane && false}>
            {fcFirst === lane ? '1st ✓' : fcFirst == null ? '1st' : '2nd'}
            {fcFirst != null && fcFirst !== lane && <span className="mt-0.5 text-[10px] font-extrabold opacity-80">{oddsLabel(betMult(p, { kind: 'forecast', a: fcFirst, b: lane }))}</span>}
          </button>
        </>
      ) : (
        <button onClick={() => onToggle(bet)} className={`${btn} w-[70px] text-[14px] sm:w-[92px] sm:text-[16px] ${on ? 'border-[#26182f] bg-accent text-[#032412]' : 'border-white/15 bg-white/10 text-white hover:bg-white/20'}`} aria-pressed={on} aria-label={`${KIND_LABEL[kind]} ${d.name} at ${oddsLabel(betMult(p, bet))}`}>
          <span className="text-[8.5px] font-extrabold tracking-wider opacity-70">{on ? 'ON SLIP' : KIND_SHORT[kind]}</span>
          <span className="mt-0.5">{oddsLabel(betMult(p, bet))}</span>
        </button>
      )}
    </motion.div>
  )
})

function RankStrip({ rank, phone, mine }: { rank: number[]; phone: boolean; mine: Set<number> }) {
  return (
    <div className="flex gap-1 sm:gap-1.5">
      {rank.map((lane, i) => (
        <motion.div
          key={lane}
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          className="relative flex min-w-0 flex-1 items-center gap-1 rounded-full border-2 border-[#26182f] py-0.5 pl-0.5 pr-1.5 sm:pr-2.5"
          style={{ background: i === 0 ? '#ffd23f' : 'rgba(11,34,51,.85)' }}
          aria-label={`${ordinal(i)} ${DUCKS[lane].name}${mine.has(lane) ? ', on your slip' : ''}`}
        >
          {/* a ticket on the ducks you backed */}
          {mine.has(lane) && (
            <span className="absolute -right-1 -top-1.5 z-10 flex h-[15px] w-[15px] items-center justify-center rounded-full border-2 border-[#26182f] bg-white" aria-hidden>
              <svg viewBox="0 0 10 10" className="h-[8px] w-[8px]">
                <path d="M5 .6l1.3 2.7 3 .4-2.2 2.1.5 3L5 7.4 2.4 8.8l.5-3L.7 3.7l3-.4Z" fill="#f2a516" stroke="#26182f" strokeWidth=".9" strokeLinejoin="round" />
              </svg>
            </span>
          )}
          <span className="tnum flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-black sm:h-5 sm:w-5" style={{ background: i === 0 ? '#26182f' : 'rgba(255,255,255,.14)', color: i === 0 ? '#ffd23f' : '#fff' }}>
            {i + 1}
          </span>
          <DuckBadge lane={lane} size={phone ? 20 : 24} ring={false} />
          {!phone && <span className={`truncate text-[12px] font-extrabold ${i === 0 ? 'text-[#26182f]' : 'text-white'}`}>{DUCKS[lane].name}</span>}
        </motion.div>
      ))}
    </div>
  )
}

function SlipCard({
  slip,
  p,
  bet,
  locked,
  podium,
  onRemove,
  onClear,
  onRebet,
  best,
}: {
  slip: Bet[]
  p: number[]
  bet: number
  locked: boolean
  podium: Podium | null
  onRemove: (b: Bet) => void
  onClear: () => void
  onRebet?: () => void
  best: number
}) {
  const lines = podium?.lines
  return (
    <div className="rounded-xl bg-stage p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-extrabold">
          Bet slip <span className="tnum text-dim">({slip.length})</span>
        </div>
        {slip.length > 0 && !locked && (
          <button onClick={onClear} className="text-[12px] font-bold text-muted transition hover:text-ink">
            Clear
          </button>
        )}
      </div>
      {slip.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] leading-relaxed text-dim">
          Tap the odds on the river to add bets. Mix Win, Place and Forecast, as many as you like.
          {onRebet && (
            <button onClick={onRebet} className="mx-auto mt-2.5 block rounded-full bg-raised px-3.5 py-1.5 text-[12px] font-bold text-ink transition hover:bg-hover">
              Same bets again
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {slip.map((b, i) => {
              const res = lines?.[i]
              return (
                <motion.div
                  key={betKey(b)}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10, transition: { duration: 0.15 } }}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${res ? (res.won ? 'bg-accent/15' : 'bg-panel2 opacity-60') : 'bg-panel2'}`}
                >
                  <span className="w-[30px] shrink-0 rounded bg-raised py-0.5 text-center text-[9.5px] font-black text-muted">{KIND_SHORT[b.kind]}</span>
                  {b.kind === 'forecast' && b.b != null ? (
                    // first and second on a line each, so two long names never squeeze each other to a few letters
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12px] font-bold leading-tight" title={`${DUCKS[b.a].name} then ${DUCKS[b.b].name}`}>
                      {[b.a, b.b].map((lane, k) => (
                        <span key={k} className="flex min-w-0 items-center gap-1">
                          <DuckBadge lane={lane} size={17} ring={false} />
                          <span className="min-w-0 truncate">{DUCKS[lane].name}</span>
                          <span className="shrink-0 text-[9.5px] font-black text-dim">{k ? '2ND' : '1ST'}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px] font-bold" title={DUCKS[b.a].name}>
                      <DuckBadge lane={b.a} size={20} ring={false} />
                      <span className="min-w-0 truncate">{DUCKS[b.a].name}</span>
                    </div>
                  )}
                  {res ? (
                    <span className={`tnum shrink-0 text-right text-[12px] font-extrabold ${res.won ? 'text-accent' : 'text-dim'}`}>{res.won ? `+${fmt(res.payout)}` : 'Lost'}</span>
                  ) : (
                    <span className="tnum shrink-0 text-[12px] font-extrabold text-gold">{oddsLabel(betMult(p, b))}</span>
                  )}
                  {!res && !locked && (
                    <button onClick={() => onRemove(b)} aria-label="Remove bet" className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-dim transition hover:bg-raised hover:text-ink">
                      ×
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-[12px] font-semibold text-muted">
            <span>
              {slip.length} × {fmt(bet)}
            </span>
            {podium ? (
              <span className="tnum">
                Paid <span className={`font-extrabold ${podium.payout > 0 ? 'text-accent' : 'text-ink'}`}>{fmt(podium.payout)}</span>
              </span>
            ) : (
              <span className="tnum" title="What the slip pays if the race goes its way">
                Best return <span className="font-extrabold text-ink">{fmt(best)}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoCard({ photo, phone }: { photo: { shot: HTMLCanvasElement; fx: number; winner: number; text: string }; phone: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const c = photo.shot
    c.style.width = '100%'
    c.style.height = 'auto'
    c.style.display = 'block'
    el.appendChild(c)
    return () => void c.remove()
  }, [photo])
  const w = phone ? 220 : 320
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-[22%] z-20"
      style={{ width: w, marginLeft: -w / 2 }}
      initial={{ opacity: 0, y: -40, rotate: 8, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, rotate: -3, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
    >
      <div className="rounded-[6px] bg-[#fffaf0] p-2 pb-2.5 shadow-[0_18px_40px_-10px_rgba(0,0,0,.55)]">
        <div className="relative overflow-hidden rounded-[3px] bg-[#222]">
          <div ref={host} style={{ filter: 'sepia(.45) contrast(1.08) saturate(1.1)' }} />
          <div className="absolute inset-y-0 w-[2px] bg-[#ff3b4e]" style={{ left: `${photo.fx * 100}%` }} />
          <div className="absolute left-1.5 top-1.5 rounded-sm bg-black/55 px-1.5 py-0.5 text-[9px] font-black tracking-[0.18em] text-white">PHOTO FINISH</div>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[14px] font-black text-[#26182f]" style={{ fontFamily: 'Manrope, system-ui, sans-serif' }}>
          <DuckBadge lane={photo.winner} size={22} ring={false} />
          {photo.text}
        </div>
      </div>
    </motion.div>
  )
}

function PodiumCard({ podium, phone, onNext }: { podium: Podium; phone: boolean; onNext: () => void }) {
  const { order, lines, payout, stake, chances } = podium
  const won = payout > 0
  const steps = [1, 0, 2]
  const heights = phone ? [54, 70, 44] : [62, 84, 50]
  const duckSize = phone ? 64 : 92
  return (
    <motion.div className="absolute inset-0 z-30 flex items-center justify-center bg-[#071823]/55 p-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
      <motion.div
        className="flex max-h-full w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border-[3px] border-[#26182f] bg-[#fffaf0] text-[#26182f] shadow-[0_10px_0_rgba(38,24,47,.35),0_30px_60px_-20px_rgba(0,0,0,.6)]"
        initial={{ y: 40, scale: 0.9 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 26 }}
      >
        <div className="bg-[#5cc7ff] px-4 pb-0 pt-3" style={{ backgroundImage: 'radial-gradient(circle at 50% 120%, #c9f1ff 0, #5cc7ff 70%)' }}>
          <div className="text-center text-[11px] font-black uppercase tracking-[0.2em] text-[#26182f]/70">Race {podium.race} result</div>
          <div className="mt-1 flex items-end justify-center gap-2">
            {steps.map((place, i) => {
              const lane = order[place]
              return (
                <div key={place} className="flex w-[30%] flex-col items-center">
                  {/* the art has room below the duck for its wake: pull it down so it stands on its step */}
                  <motion.div style={{ marginBottom: -Math.round((place === 0 ? duckSize : duckSize * 0.8) * 0.125) }} initial={{ y: -30, opacity: 0 }} animate={{ y: [0, -6, 0], opacity: 1 }} transition={{ y: { repeat: Infinity, duration: place === 0 ? 0.7 : 1.1, delay: 0.4 + i * 0.1 }, opacity: { delay: 0.15 + i * 0.1 } }}>
                    <DuckArt lane={lane} size={place === 0 ? duckSize : duckSize * 0.8} expr={place === 0 ? 'joy' : 'happy'} beak={place === 0 ? 20 : 0} />
                  </motion.div>
                  <motion.div
                    className="flex w-full flex-col items-center justify-start rounded-t-lg border-[2.5px] border-b-0 border-[#26182f] pt-1"
                    style={{ height: heights[i], background: PLACE_TONE[place] }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: 0.1 + i * 0.08, type: 'spring', stiffness: 300, damping: 24 }}
                  >
                    <span className="text-[18px] font-black leading-none sm:text-[22px]">{place + 1}</span>
                    <span className="mt-0.5 max-w-full truncate px-1 text-[10.5px] font-extrabold sm:text-[12px]">{DUCKS[lane].name}</span>
                  </motion.div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 border-y-[2.5px] border-[#26182f] bg-[#f3ead7] px-3 py-1.5 text-[11px] font-extrabold">
          {order.slice(3).map((lane, i) => (
            <span key={lane} className="flex items-center gap-1">
              <span className="text-[#26182f]/50">{ordinal(i + 3)}</span>
              <DuckBadge lane={lane} size={18} ring={false} />
              {!phone && DUCKS[lane].name}
            </span>
          ))}
          <span className="ml-auto text-[#26182f]/60">Won at {oddsLabel(0.97 / (chances[order[0]] / 100))}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2 py-1 text-[12.5px] font-bold">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${l.won ? 'bg-accent text-[#032412]' : 'bg-[#26182f]/10 text-[#26182f]/40'}`}>{l.won ? '✓' : '×'}</span>
              <span className={`shrink-0 text-[10.5px] font-black text-[#26182f]/55 ${phone ? 'w-[30px]' : 'w-[54px]'}`}>{(phone ? KIND_SHORT : KIND_LABEL)[l.bet.kind].toUpperCase()}</span>
              {/* a forecast names two ducks: it may take two lines rather than lose the second name */}
              <span className={`min-w-0 flex-1 ${l.bet.kind === 'forecast' ? 'leading-tight' : 'truncate'}`}>
                {DUCKS[l.bet.a].name}
                {l.bet.kind === 'forecast' && l.bet.b != null ? ` → ${DUCKS[l.bet.b].name}` : ''}
              </span>
              <span className="tnum shrink-0 text-[#26182f]/60">{oddsLabel(l.mult)}</span>
              <span className={`tnum w-[64px] shrink-0 text-right font-extrabold ${l.won ? 'text-[#0d8a45]' : 'text-[#26182f]/35'}`}>{l.won ? `+${fmt(l.payout)}` : '0.00'}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t-[2.5px] border-[#26182f] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black uppercase tracking-wider text-[#26182f]/55">{won ? 'Your slip pays' : 'Not this time'}</div>
            <div className={`tnum flex items-center gap-1.5 text-[22px] font-black leading-tight ${won ? 'text-[#0d8a45]' : 'text-[#26182f]/45'}`}>
              {won ? fmt(payout) : `−${fmt(stake)}`}
              {won && <Coin size={20} />}
            </div>
          </div>
          <button onClick={onNext} className="rounded-xl border-[2.5px] border-[#26182f] bg-[#ffd23f] px-5 py-2.5 text-[15px] font-black text-[#26182f] shadow-[0_4px_0_#26182f] transition active:translate-y-[2px] active:shadow-[0_2px_0_#26182f]">
            Next race
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function FormGuide({ store, focus, onClose }: { store: Store; focus: number | null; onClose: () => void }) {
  const p = probs(store.next)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  useEffect(() => {
    if (focus != null) refs.current[focus]?.scrollIntoView({ block: 'center' })
  }, [focus])
  const rows: ReactNode[] = DUCKS.map((d, lane) => {
    const places = store.results.map((r) => r.order.indexOf(lane))
    const wins = places.filter((x) => x === 0).length
    const top2 = places.filter((x) => x <= 1).length
    return (
      <div key={lane} ref={(el) => void (refs.current[lane] = el)} className={`flex gap-3 rounded-xl p-3 ${focus === lane ? 'bg-raised ring-2 ring-gold/60' : 'bg-panel2'}`}>
        <div className="shrink-0 self-start rounded-xl p-1" style={{ background: `radial-gradient(circle at 40% 35%, ${d.light}, ${d.dark})` }}>
          <DuckArt lane={lane} size={64} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-extrabold">{d.name}</span>
            <span className="text-[11.5px] font-semibold text-muted">{d.trait}</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-muted">{d.blurb}</p>
          <div className="tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-bold">
            <span className="text-ink">Today {store.next[lane]}%</span>
            <span className="text-gold">Win {oddsLabel(0.97 / p[lane])}</span>
            <span className="text-muted">
              {wins} win{wins === 1 ? '' : 's'}, {top2} top-two in {places.length}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {places.slice(0, 12).map((f, i) => (
              <span key={i} className="tnum flex h-5 w-5 items-center justify-center rounded text-[10.5px] font-black" style={{ background: f < 3 ? PLACE_TONE[f] : 'rgba(255,255,255,.08)', color: f < 3 ? '#26182f' : '#90a4b8' }}>
                {f + 1}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  })
  return (
    <Modal onClose={onClose} title={`Form guide · Race ${store.race}`} width={520}>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">Chances are dealt fresh before every race, so the favourite changes. Finishes are newest first.</p>
      <div className="flex flex-col gap-2">{rows}</div>
    </Modal>
  )
}
