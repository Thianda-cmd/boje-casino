import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Toggle, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { clawSfx } from './sound'
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { DRAW, FAILURES, PRIZES, RTP, chanceLabel, drawPlan, multLabel, prizeIndex, type Failure, type Plan, type Prize, type PrizeId } from './rules'
import type { ClawScene } from './scene'

/*
  Lucky Claw: a toon claw machine full of plushies. Pick a prize, see its exact chance (0.97 / multiplier), drop the
  claw. The grab is decided the moment it drops (rules.ts) and the 3D scene acts it out; the round settles once, as
  soon as the outcome shows, or straight away if the page is left mid-grab. A round whose page died without paying is
  paid on the next visit.
*/

type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; key: string }
const pendingKey = (uid: string | null) => `lumen.claw.pending.${uid ?? 'guest'}`
const PICK_KEY = 'lumen.claw.pick'
const TURBO_KEY = 'lumen.claw.turbo'

type Grab = { id: number; index: number; won: boolean }
type Banner = { id: number; kind: 'win'; index: number; amount: number } | { id: number; kind: 'miss'; text: string } | { id: number; kind: 'scare'; text: string }

const MISS_TEXT: Record<Failure, string[]> = {
  slip: ['It slipped on the way up!', 'Slippery one!', 'So close, it slid out!'],
  wriggle: ['It wriggled free!', 'It got away mid-air!', 'Wriggled out of the claw!'],
  edge: ['Bounced off the chute!', 'Right on the edge... no!', 'Teetered and fell back!'],
  neighbour: ['Grabbed the neighbour!', 'Wrong plushie!', 'Nudged it aside!'],
}
const SCARE_TEXT = ['Whoa, hold on!', 'Careful...', 'It is slipping...!']
const pickOne = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

/** the win's headline by multiplier */
const winTitle = (m: number) => (m >= 50 ? 'Jackpot grab!' : m >= 10 ? 'Amazing grab!' : m >= 3 ? 'Great grab!' : 'Nice grab!')

// dev only: window.__clawForce = 'win' | 'slip' | 'wriggle' | 'edge' | 'neighbour' | 'lift' | 'carry' plays that next
function forced(plan: Plan): Plan {
  const f = (window as unknown as { __clawForce?: string }).__clawForce
  if (!f) return plan
  if (f === 'win' || f === 'lift' || f === 'carry') return { ...plan, won: true, failure: null, scare: f === 'win' ? 'none' : f, at: plan.at }
  if ((FAILURES.map((x) => x.kind) as string[]).includes(f)) return { ...plan, won: false, failure: f as Failure, scare: 'none' }
  return plan
}

export default function LuckyClaw() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const [pick, setPick] = useState(() => {
    const i = prizeIndex(safeStorage.getItem(PICK_KEY) ?? '')
    return i >= 0 ? i : 4
  })
  const [turbo, setTurbo] = useState(() => safeStorage.getItem(TURBO_KEY) === '1')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const [failed, setFailed] = useState(false)
  const [thumbs, setThumbs] = useState<Partial<Record<PrizeId, string>>>({})
  const [grabs, setGrabs] = useState<Grab[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [winAt, setWinAt] = useState<{ x: number; y: number } | null>(null)
  const [info, setInfo] = useState(false)
  const [flash, setFlash] = useState(0)
  /** a won prize is up in the spotlight (the grab itself is over) */
  const [prizeShow, setPrizeShow] = useState(false)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ClawScene | null>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const pending = useRef<Pending | null>(null)
  const seq = useRef(1)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const autoRef = useRef(false)
  const bannerTimer = useRef(0)

  const prize = PRIZES[pick]

  /** pays the round in play, once: when its outcome shows, or as soon as the player leaves (it is already drawn) */
  const settlePending = () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    safeStorage.removeItem(p.key)
    useWallet.getState().settle({ game: 'claw', bet: p.bet, payout: p.payout, meta: p.meta })
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let live = true
    const host = hostRef.current!
    let sc: ClawScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ ClawScene }) => {
        if (!live) return
        setProgress(0.1)
        sc = new ClawScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __claw?: ClawScene }).__claw = sc
        sc.setTurbo(turboRef.current)
        sc.select(pick, true)
        sc.onProgress = (p) => alive.current && setProgress(0.1 + p * 0.9)
        sc.onPick = (i) => choose(i)
        sc.onMarker = (at) => {
          const el = markerRef.current
          if (!el) return
          if (!at) {
            el.style.opacity = '0'
            return
          }
          el.style.opacity = '1'
          el.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`
        }
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          setWinAt(sc!.presentRect())
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!live || !sc) return
          setThumbs(sc.thumbs)
          setWinAt(sc.presentRect())
          setReady(true)
        })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      alive.current = false
      ro?.disconnect()
      clearTimeout(bannerTimer.current)
      if (import.meta.env.DEV) {
        const w = window as unknown as { __claw?: ClawScene }
        if (w.__claw === sc) delete w.__claw
      }
      sc?.dispose()
      sceneRef.current = null
      settlePending()
    }
    // the scene lives as long as the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.setTurbo(turbo)
    safeStorage.setItem(TURBO_KEY, turbo ? '1' : '0')
  }, [turbo])

  // Reloading, closing the tab or going to another site mid-grab pays the round on the way out (not on a mere tab
  // switch: the header balance would give the result away).
  useEffect(() => {
    window.addEventListener('beforeunload', settlePending)
    window.addEventListener('pagehide', settlePending)
    return () => {
      window.removeEventListener('beforeunload', settlePending)
      window.removeEventListener('pagehide', settlePending)
    }
    // settlePending only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a round whose page went away with no chance to pay it is paid on the next visit, into the wallet that staked it
  useEffect(() => {
    if (authStatus === 'loading' || pending.current) return
    const key = pendingKey(uid)
    const raw = safeStorage.getItem(key)
    if (raw == null) return
    safeStorage.removeItem(key)
    let p: Partial<Pending> | null = null
    try {
      p = JSON.parse(raw)
    } catch {
      /* a damaged entry */
    }
    if (typeof p?.bet !== 'number' || typeof p.payout !== 'number') return
    useWallet.getState().settle({ game: 'claw', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Lucky Claw grab paid out', amount: p.payout })
  }, [authStatus, uid])

  /* ---------------- picking ---------------- */

  const choose = (i: number) => {
    if (busyRef.current || autoRef.current) return
    setPick(i)
    sceneRef.current?.select(i)
    safeStorage.setItem(PICK_KEY, PRIZES[i].id)
  }

  /* ---------------- a grab ---------------- */

  const say = (b: Banner, ms: number) => {
    clearTimeout(bannerTimer.current)
    setBanner(b)
    if (ms > 0) bannerTimer.current = window.setTimeout(() => alive.current && setBanner((x) => (x?.id === b.id ? null : x)), ms)
  }

  const play = async (): Promise<number | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !ready) return null
    const index = pick
    const pz = PRIZES[index]
    const unit = bet
    if (!stake(unit)) return null
    busyRef.current = true
    setBusy(true)
    setBanner(null)
    let plan = drawPlan(pz, rand)
    if (import.meta.env.DEV) plan = forced(plan)
    const payout = plan.won ? round2(unit * pz.mult) : 0
    const meta = { mult: pz.mult, prize: pz.id, won: plan.won }
    // stored before the claw moves, so even a page that never gets to settle can't lose the round
    const key = pendingKey(uid)
    pending.current = { bet: unit, payout, meta, key }
    safeStorage.setItem(key, JSON.stringify({ bet: unit, payout, meta }))
    const turboNow = turboRef.current
    try {
      await grab(sc, index, pz, plan, payout, turboNow)
    } catch {
      // never expected: a scene error must not lock the game. Pay the round if drop() hasn't, and free the controls
      settlePending()
    }
    if (!alive.current) return null
    busyRef.current = false
    setBusy(false)
    setPrizeShow(false)
    return payout - unit
  }

  /** acts one grab out in the scene: pays it when the outcome shows, then shows off and restocks a won prize */
  const grab = async (sc: ClawScene, index: number, pz: Prize, plan: Plan, payout: number, turboNow: boolean) => {
    await sc.drop(index, plan, {
      result: () => {
        // a no-op if the page already paid it on its way out
        settlePending()
        if (!alive.current) return
        setGrabs((g) => [{ id: seq.current++, index, won: plan.won }, ...g].slice(0, 14))
        if (!plan.won) {
          clawSfx.aww()
          say({ id: seq.current++, kind: 'miss', text: pickOne(MISS_TEXT[plan.failure ?? 'slip']) }, turboNow ? 1300 : 1900)
        }
      },
      moment: (what) => {
        if (!alive.current) return
        if (what === 'scare') say({ id: seq.current++, kind: 'scare', text: pickOne(SCARE_TEXT) }, 900)
        else if (what === 'present') {
          // the prize is up in the spotlight: show what it paid
          say({ id: seq.current++, kind: 'win', index, amount: payout }, 0)
          setPrizeShow(true)
          sfx.coin()
          if (pz.mult >= 25) setFlash((f) => f + 1)
        }
      },
    })
    if (!alive.current || !plan.won) return
    const hold = autoRef.current ? (turboRef.current ? 0.5 : 0.9) : turboRef.current ? 0.9 : 1.6
    await sc.restock(index, hold + Math.min(1, pz.mult / 100), () => alive.current && setBanner((b) => (b?.kind === 'win' ? null : b)))
  }

  const auto = useAutoBet(play, turbo ? 200 : 450)
  autoRef.current = auto.running
  const locked = busy || auto.running

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.code !== 'Space' || info) return
      e.preventDefault()
      if (e.repeat) return
      if (busyRef.current) sceneRef.current?.hurry()
      else if (mode === 'manual') void play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const profit = round2(bet * prize.mult - bet)
  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <BetInput value={bet} onChange={setBet} disabled={locked} />
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>Prize</span>
          <button onClick={() => (sfx.click(), setInfo(true))} className="text-dim transition hover:text-ink">
            How it works
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Prize">
          {PRIZES.map((p, i) => (
            <PrizeTile key={p.id} prize={p} thumb={thumbs[p.id]} on={i === pick} disabled={locked} onClick={() => (sfx.click(), choose(i))} />
          ))}
        </div>
      </div>
      <div className="rounded-lg bg-stage px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-extrabold">
              {prize.name} <span className="font-semibold text-dim">· {prize.kind}</span>
            </div>
            <div className="text-[11px] font-semibold text-dim">Pays {multLabel(prize.mult)} your bet</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="tnum text-[17px] font-black leading-tight text-gold">{chanceLabel(prize)}</div>
            <div className="text-[10.5px] font-semibold text-dim">win chance</div>
          </div>
        </div>
        <ChanceBar prize={prize} />
        <div className="mt-2 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>Profit on win</span>
          <span className="tnum flex items-center gap-1 font-extrabold text-accent">
            {fmt(profit)} <Coin size={13} />
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2.5">
        <div>
          <div className="text-[13px] font-bold">Turbo</div>
          <div className="text-[11px] text-dim">A quicker claw</div>
        </div>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div className="max-lg:order-first lg:mt-auto">
        {auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop} sub={auto.left != null ? `${auto.left} left` : undefined}>
            Stop autobet
          </ActionButton>
        ) : busy ? (
          <ActionButton tone="neutral" onClick={() => sceneRef.current?.hurry()} sub="Tap to speed up">
            {prizeShow ? 'Prize won!' : 'Grabbing…'}
          </ActionButton>
        ) : mode === 'manual' ? (
          <ActionButton onClick={() => void play()} disabled={!ready || balance < bet} sub={`${prize.name} · ${multLabel(prize.mult)} · ${chanceLabel(prize)}`}>
            Drop the claw
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={!ready || balance < bet} sub={`${prize.name} · ${multLabel(prize.mult)}`}>
            Start autobet
          </ActionButton>
        )}
      </div>
      {mode === 'manual' && <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Tap a plushie in the machine or pick one here. Space drops the claw. Every prize returns 97%.</p>}
    </>
  )

  /* ---------------- stage ---------------- */

  const winning = banner?.kind === 'win' ? banner : null
  const stage = (
    // a tap hurries a grab along (a click, so a finger scrolling the page past the machine doesn't)
    <div className="absolute inset-0 overflow-hidden bg-[#1a0b33]" onClick={() => busyRef.current && sceneRef.current?.hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* recent grabs */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-start p-2.5 sm:p-3">
        <HistoryPills
          className="max-w-full"
          items={grabs.map((g) => {
            const p = PRIZES[g.index]
            return {
              key: g.id,
              tone: g.won ? 'win' : 'loss',
              label: (
                <span className="flex items-center gap-1">
                  {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" width={16} height={16} className={`-my-1 -ml-1.5 h-4 w-4 ${g.won ? '' : 'opacity-60 grayscale'}`} /> : null}
                  {multLabel(p.mult)}
                </span>
              ),
            }
          })}
        />
      </div>

      {/* the selected prize's pin */}
      <div ref={markerRef} className="pointer-events-none absolute left-0 top-0 z-[6] opacity-0 transition-opacity duration-200" style={{ willChange: 'transform' }}>
        <div className="-translate-x-1/2 -translate-y-full">
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }} className="flex flex-col items-center">
            <div className="tnum whitespace-nowrap rounded-full border-2 border-[#1d0f30] bg-white px-2 py-0.5 text-[11px] font-black leading-tight text-[#1d0f30] shadow-[0_3px_0_rgba(29,15,48,.45)] sm:px-2.5 sm:text-[12.5px]">
              {chanceLabel(prize)}
            </div>
            <svg width="14" height="9" viewBox="0 0 14 9" className="-mt-[2px]" aria-hidden>
              <path d="M1 1h12L7 8Z" fill="#fff" stroke="#1d0f30" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </motion.div>
        </div>
      </div>

      {/* captions: a near miss or a scare */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[30%] z-20 flex justify-center px-3">
        <AnimatePresence mode="popLayout">
          {banner && banner.kind !== 'win' && (
            <motion.div
              key={banner.id}
              initial={{ opacity: 0, y: 14, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
              className={`rounded-2xl border-[2.5px] border-[#1d0f30] px-4 py-1.5 text-[14px] font-black text-[#1d0f30] shadow-[0_5px_0_rgba(29,15,48,.4)] sm:text-[16px] ${banner.kind === 'scare' ? 'bg-[#ffe36b]' : 'bg-white'}`}
            >
              {banner.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* a golden flash for the top prizes */}
      <AnimatePresence>
        {flash > 0 && <motion.div key={flash} className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_50%_45%,rgba(255,236,150,.85),rgba(255,180,60,.35)_45%,transparent_75%)]" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.7, ease: 'easeOut' }} />}
      </AnimatePresence>

      {/* the win */}
      <AnimatePresence>{winning && winAt && <WinCard key={winning.id} at={winAt} prize={PRIZES[winning.index]} amount={winning.amount} />}</AnimatePresence>

      <AnimatePresence>
        {!ready && (
          <motion.div key="loading" className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_42%,#3b1c60_0%,#1a0b33_72%)]" exit={{ opacity: 0, transition: { duration: 0.45 } }}>
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-white/85">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Fluffing the plushies" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100vw+112px)] max-sm:min-h-[430px]" />
      <AnimatePresence>{info && <InfoModal thumbs={thumbs} bet={bet} onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- pieces ---------------- */

function PrizeTile({ prize, thumb, on, disabled, onClick }: { prize: Prize; thumb?: string; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      aria-label={`${prize.name}, ${multLabel(prize.mult)}, ${chanceLabel(prize)} chance`}
      disabled={disabled && !on}
      onClick={onClick}
      className={`relative flex flex-col items-center rounded-lg pb-1 pt-0.5 transition ${on ? 'bg-raised ring-2 ring-[color:var(--tag)]' : 'bg-stage hover:bg-raised/70'} disabled:cursor-not-allowed disabled:opacity-45`}
      style={{ ['--tag' as string]: prize.tag }}
    >
      <span className="flex h-[44px] w-[44px] items-center justify-center">
        {thumb ? <img src={thumb} alt="" width={44} height={44} className="h-[44px] w-[44px]" draggable={false} /> : <span className="h-6 w-6 rounded-full" style={{ background: prize.color }} />}
      </span>
      <span className="tnum -mt-0.5 rounded-full px-1.5 text-[11.5px] font-black leading-[16px] text-[#1d0f30]" style={{ background: prize.tag }}>
        {multLabel(prize.mult)}
      </span>
    </button>
  )
}

/** the chance as a bar to scale (a sliver at least, so the long shots still show one): what you see is the real chance */
function ChanceBar({ prize }: { prize: Prize }) {
  const w = Math.max(1.5, (prize.ways / DRAW) * 100)
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel2">
      <motion.div className="h-full rounded-full" style={{ background: prize.tag }} initial={false} animate={{ width: `${Math.min(100, w)}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} />
    </div>
  )
}

function WinCard({ at, prize, amount }: { at: { x: number; y: number }; prize: Prize; amount: number }) {
  const big = prize.mult >= 50
  return (
    <motion.div className="pointer-events-none absolute z-30 -translate-x-1/2" style={{ left: at.x, top: at.y + 8 }} initial={{ opacity: 0, y: 24, scale: 0.6 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.08 }}>
      <div className="flex flex-col items-center">
        <div
          className={`whitespace-nowrap bg-clip-text text-[26px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_3px_0_#1d0f30)] sm:text-[34px] ${big ? 'bg-[linear-gradient(100deg,#ff4fd8_0%,#ffe23d_30%,#6dff5a_55%,#2fd3ff_78%,#b38bff_100%)]' : 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]'}`}
          style={{ WebkitTextStroke: '1px rgba(29,15,48,.5)' }}
        >
          {winTitle(prize.mult)}
        </div>
        <div className="mt-1.5 flex items-center gap-2 rounded-full border-[3px] border-[#1d0f30] bg-white py-1 pl-1.5 pr-4 shadow-[0_6px_0_rgba(29,15,48,.45)]">
          <span className="tnum rounded-full px-2.5 py-0.5 text-[15px] font-black text-[#1d0f30] sm:text-[17px]" style={{ background: prize.tag }}>
            {multLabel(prize.mult)}
          </span>
          <span className="tnum flex items-center gap-1.5 text-[18px] font-black text-[#1d0f30] sm:text-[22px]">
            {fmt(amount)} <Coin size={20} />
          </span>
        </div>
      </div>
    </motion.div>
  )
}

function InfoModal({ thumbs, bet, onClose }: { thumbs: Partial<Record<PrizeId, string>>; bet: number; onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="How Lucky Claw works" width={480}>
      <p className="text-[13px] leading-relaxed text-muted">
        Pick a plushie, set your bet and drop the claw. Each prize wears its multiplier on a tag, and its win chance is exactly {Math.round(RTP * 100)}% divided by that multiplier. So
        every prize returns {Math.round(RTP * 100)}% of your bet over time; the big ones are just rarer.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        The grab is decided the moment the claw drops. The claw is never weaker for one prize than another: a slip, a wriggle, a bounce off the chute or a grab on the wrong plushie
        happens just as often whichever one you pick.
      </p>
      <div className="mt-3 flex flex-col gap-1">
        <div className="grid grid-cols-[40px_1fr_auto_auto] items-center gap-x-3 px-2 text-[10.5px] font-bold uppercase tracking-wider text-dim">
          <span />
          <span>Prize</span>
          <span className="text-right">Chance</span>
          <span className="w-[52px] text-right sm:w-[124px]">Pays</span>
        </div>
        {PRIZES.map((p) => (
          <div key={p.id} className="grid grid-cols-[40px_1fr_auto_auto] items-center gap-x-3 rounded-lg bg-stage px-2 py-1">
            {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" width={40} height={40} /> : <span className="mx-2 h-6 w-6 rounded-full" style={{ background: p.color }} />}
            <span className="min-w-0 truncate text-[13px] font-bold">
              {p.name} <span className="font-semibold text-dim">· {p.kind}</span>
            </span>
            <span className="tnum text-right text-[13px] font-extrabold text-gold">{chanceLabel(p)}</span>
            <span className="tnum w-[52px] whitespace-nowrap text-right text-[13px] font-extrabold sm:w-[124px]">
              <span className="mr-1 rounded-full px-1.5 text-[11px] text-[#1d0f30]" style={{ background: p.tag }}>
                {multLabel(p.mult)}
              </span>
              <span className="hidden sm:inline">{fmt(round2(bet * p.mult), bet * p.mult >= 1000 ? 0 : 2)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-dim">Auto mode keeps grabbing the same prize. Turbo speeds the claw up; tap the machine or press Space during a grab to hurry it along.</p>
    </Modal>
  )
}
