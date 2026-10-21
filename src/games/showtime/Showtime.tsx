import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion'
import { useStake } from '../../components/ui'
import { Coin } from '../../components/icons'
import { Modal } from '../../components/Modal'
import { Chip, chipLabel } from '../../art/Chip'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { MAX_BET, useWallet } from '../../store/wallet'
import { Kbd } from '../blackjack/table'
import {
  BONUS_SPOTS,
  BOOST,
  BOOST_CHANCE,
  BOOST_MISS,
  COUNT,
  MAX_WIN,
  RTP,
  SEGMENTS,
  SPOTS,
  bonusValue,
  drawRound,
  isBonus,
  settle,
  stakeTotal,
  type Round,
  type Spot,
  type Stakes,
} from './rules'
import { showtimeSfx } from './sound'
import { MoneyWheel, STEP, restAngle } from './Wheel'
import { BoosterPanel } from './Booster'
import { Board } from './Board'
import { SpotBadge } from './art'
import { LOOK, fmtX } from './words'
import { CoinTossShow } from './bonus/CoinToss'
import { PegDropShow } from './bonus/PegDrop'
import { PrizeWallShow } from './bonus/PrizeWall'
import { MegaSpinShow } from './bonus/MegaSpin'
import {
  LIVE_MS,
  clearPending,
  loadChip,
  loadHistory,
  loadLast,
  pendingAge,
  pendingKey,
  pendingTaken,
  saveChip,
  saveHistory,
  saveLast,
  saveNotice,
  savePending,
  takeNotice,
  takePending,
  withPast,
  type Past,
  type PendingRound,
} from './storage'

/*
  Showtime: a game-show money wheel. Chips go on the eight spots; Spin takes the stake and draws the whole round at
  once (rules.ts): the Booster, the segment and, if it is one, the bonus round, settled against the board there and
  then. The round is kept as a pending payout, in memory and in localStorage, and paid exactly once: when its show
  ends, straight away if the page is left mid-show (the next visit says what it came to), or on the next visit if the
  page died (storage.ts, the same scheme as Sic Bo's).

  The show: the Booster's reels run and light a spot (its tile and segments wear the multiplier), the wheel is pushed
  off and slows past the flapper onto the drawn segment, and a number pays at once while a bonus round takes over
  the stage. The chips stay on the board, so Space spins the same bets again.

  Dev hook (dev builds only): window.__stForce = 'coin' | 'peg' | 'wall' | 'mega' | '1' | '2' | '5' | '10' lands the
  next spin on that spot; { spot, boost } also boosts it.
*/

const CHIPS = [1, 5, 10, 25, 100, 500, 1000, 5000]
/** the most one spot may hold in a round */
const SPOT_LIMIT = 10_000
const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'

type Phase = 'bet' | 'boost' | 'spin' | 'bonus' | 'result'

interface Play {
  id: number
  round: Round
  stakes: Stakes
  total: number
  ret: number
}

/** the dev hook's round: drawn until it lands on the spot asked for, boosted if asked */
function forced(r: Round): Round {
  const w = (window as unknown as { __stForce?: Spot | { spot: Spot; boost?: number } }).__stForce
  if (!w) return r
  const want = typeof w === 'string' ? { spot: w } : w
  ;(window as unknown as { __stForce?: unknown }).__stForce = undefined
  let x = r
  for (let i = 0; i < 20000 && x.spot !== want.spot; i++) x = drawRound(rand)
  if ('boost' in want && want.boost) {
    const booster = { spot: x.spot, mult: want.boost }
    x = { ...x, booster, bonusWin: x.bonus ? Math.min(MAX_WIN, bonusValue(x.bonus) * want.boost) : 0 }
  }
  return x
}

export default function Showtime() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [chip, setChipState] = useState(() => loadChip(CHIPS, 10))
  const [stakes, setStakesState] = useState<Stakes>({})
  const stakesRef = useRef<Stakes>({})
  const [undo, setUndo] = useState<Stakes[]>([])
  const [last, setLast] = useState<Stakes | null>(loadLast)
  const [hist, setHist] = useState<Past[]>(loadHistory)
  const histRef = useRef(hist)
  const [phase, setPhaseState] = useState<Phase>('bet')
  const phaseRef = useRef<Phase>('bet')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const setStakes = (s: Stakes) => {
    stakesRef.current = s
    setStakesState(s)
  }
  const setChip = (v: number) => {
    setChipState(v)
    saveChip(v)
  }
  const [boostSpin, setBoostSpin] = useState(0)
  const [boostResult, setBoostResult] = useState<Round['booster']>(null)
  const [boostLanded, setBoostLanded] = useState(true)
  const [winner, setWinner] = useState<Spot | null>(null)
  const [bonusOn, setBonusOn] = useState(false)
  const [winShow, setWinShow] = useState<{ id: number; amount: number; total: number; spot: Spot; x: number } | null>(null)
  const [info, setInfo] = useState(false)
  const [say, setSay] = useState('')
  const rot = useMotionValue(0)
  const flap = useMotionValue(0)
  const [stageRef, size] = useSize<HTMLDivElement>({ w: 900, h: 520 })

  /* ---------------- money ---------------- */

  const run = useRef(0)
  const alive = useRef(true)
  const timers = useRef<number[]>([])
  const play = useRef<Play | null>(null)
  const pending = useRef<{ key: string; round: PendingRound } | null>(null)

  const settlePending = () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    const taken = pendingTaken(p.key)
    clearPending(p.key)
    if (taken) return null
    useWallet.getState().settle({ game: 'showtime', bet: p.round.bet, payout: p.round.payout, meta: p.round.meta })
    return p.round
  }
  const logPast = (p: Past) => {
    const next = withPast(histRef.current, p)
    histRef.current = next
    saveHistory(next)
    if (alive.current) setHist(next)
  }

  useEffect(() => {
    alive.current = true
    const onHide = () => {
      const p = settlePending()
      if (!p) return
      saveNotice({ amount: p.payout, spot: p.spot })
      saveHistory(withPast(histRef.current, { t: p.t, spot: p.spot, win: p.win, boosted: p.boosted }))
    }
    const beat = window.setInterval(() => {
      const p = pending.current
      if (p && !pendingTaken(p.key)) savePending(p.key, { ...p.round, at: Date.now() })
    }, 1000)
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      alive.current = false
      clearInterval(beat)
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
      timers.current.forEach(clearTimeout)
      timers.current = []
      // leaving the page mid-show pays the round at once, and says what it came to
      const p = settlePending()
      if (p) {
        logPast({ t: p.t, spot: p.spot, win: p.win, boosted: p.boosted })
        if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your Showtime spin (${LOOK[p.spot].name}) paid out as you left`, amount: p.payout })
        else useWallet.getState().pushToast({ kind: 'info', title: `Your Showtime spin landed on ${LOOK[p.spot].name}: no win` })
      }
    }
    // settlePending and logPast only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a round whose page went away before it could pay is paid on the next visit, once sign-in has settled
  useEffect(() => {
    if (authStatus === 'loading') return
    const n = takeNotice()
    if (n) {
      if (n.amount > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your last Showtime spin (${LOOK[n.spot].name}) paid out when you left`, amount: n.amount })
      else useWallet.getState().pushToast({ kind: 'info', title: `Your last Showtime spin landed on ${LOOK[n.spot].name}: no win` })
    }
    let timer = 0
    const recover = () => {
      if (pending.current || !alive.current) return
      const key = pendingKey(uid)
      const age = pendingAge(key)
      if (age == null) return
      if (age < LIVE_MS) {
        timer = window.setTimeout(recover, LIVE_MS - age + 300)
        return
      }
      const p = takePending(key)
      if (!p) return
      useWallet.getState().settle({ game: 'showtime', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
      logPast({ t: p.t, spot: p.spot, win: p.win, boosted: p.boosted })
      if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your unfinished Showtime spin (${LOOK[p.spot].name}) paid out`, amount: p.payout })
      else useWallet.getState().pushToast({ kind: 'info', title: `Your unfinished Showtime spin landed on ${LOOK[p.spot].name}: no win` })
    }
    recover()
    return () => clearTimeout(timer)
    // logPast only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, uid])

  /* ---------------- betting ---------------- */

  const open = phase === 'bet' || phase === 'result'
  const total = stakeTotal(stakes)

  const bet = useCallback(
    (s: Spot) => {
      if (phaseRef.current !== 'bet' && phaseRef.current !== 'result') return
      const cur = stakesRef.current
      const have = useWallet.getState().balance
      const room = Math.min(SPOT_LIMIT - (cur[s] ?? 0), MAX_BET - stakeTotal(cur), have - stakeTotal(cur))
      const add = round2(Math.min(chip, room))
      if (add < 1) {
        pushToast({ kind: 'info', title: SPOT_LIMIT - (cur[s] ?? 0) < 1 ? `Limit reached: ${fmt(SPOT_LIMIT, 0)} on ${LOOK[s].name}` : have - stakeTotal(cur) < 1 ? NO_COINS : `Table limit: ${fmt(MAX_BET, 0)} a spin` })
        return
      }
      setUndo((u) => [...u.slice(-40), cur])
      setStakes({ ...cur, [s]: round2((cur[s] ?? 0) + add) })
      showtimeSfx.chip(SPOTS.indexOf(s))
    },
    // pushToast is stable; the chip is read fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chip],
  )
  const doUndo = () => {
    if (!open || !undo.length) return
    setStakes(undo[undo.length - 1])
    setUndo((u) => u.slice(0, -1))
  }
  const clear = () => {
    if (!open || !total) return
    setUndo((u) => [...u.slice(-40), stakesRef.current])
    setStakes({})
  }
  const double = () => {
    if (!open || !total) return
    const cur = stakesRef.current
    if (stakeTotal(cur) * 2 > useWallet.getState().balance) return void pushToast({ kind: 'info', title: NO_COINS })
    if (stakeTotal(cur) * 2 > MAX_BET || SPOTS.some((s) => (cur[s] ?? 0) * 2 > SPOT_LIMIT)) return void pushToast({ kind: 'info', title: 'That would go over the table limit' })
    setUndo((u) => [...u.slice(-40), cur])
    setStakes(Object.fromEntries(SPOTS.filter((s) => cur[s]).map((s) => [s, round2(cur[s]! * 2)])) as Stakes)
  }
  const repeat = () => {
    if (!open || !last) return
    if (stakeTotal(last) > useWallet.getState().balance) return void pushToast({ kind: 'info', title: NO_COINS })
    setUndo((u) => [...u.slice(-40), stakesRef.current])
    setStakes(last)
  }

  /* ---------------- the round ---------------- */

  const wait = (ms: number) => new Promise<void>((r) => timers.current.push(window.setTimeout(r, ms)))
  const live = (id: number) => alive.current && run.current === id

  async function spin() {
    if (phaseRef.current !== 'bet' && phaseRef.current !== 'result') return
    const placed = stakesRef.current
    const t0 = stakeTotal(placed)
    if (!t0) return void pushToast({ kind: 'info', title: last ? 'Put chips on a spot, or Repeat (R)' : 'Put chips on a spot first' })
    if (!stake(t0)) return
    const id = ++run.current
    timers.current.forEach(clearTimeout)
    timers.current = []

    // the round is decided, settled and stored before anything moves, so leaving mid-show can't change or lose it
    let round = drawRound(rand)
    if (import.meta.env.DEV) round = forced(round)
    const pay = settle(placed, round)
    const boosted = round.booster?.spot === round.spot
    const t = Date.now()
    const p: PendingRound = {
      bet: t0,
      payout: pay.ret,
      meta: { spot: round.spot, win: pay.win, boosted, boost: round.booster?.mult ?? 0, bonus: isBonus(round.spot) },
      spot: round.spot,
      win: pay.win,
      boosted,
      t,
      at: t,
    }
    const key = pendingKey(uid)
    pending.current = { key, round: p }
    savePending(key, p)
    play.current = { id, round, stakes: placed, total: t0, ret: pay.ret }
    setLast(placed)
    saveLast(placed)

    // the Booster
    setPhase('boost')
    setWinner(null)
    setWinShow(null)
    setBoostLanded(false)
    setBoostResult(round.booster)
    setBoostSpin((n) => n + 1)
    setSay('The Booster is spinning')
    showtimeSfx.boostStart()
    await wait(1950)
    if (!live(id)) return
    setBoostLanded(true)
    showtimeSfx.boost(round.booster?.mult ?? 0)
    setSay(round.booster ? `${LOOK[round.booster.spot].name} boosted times ${round.booster.mult}` : 'No boost this spin')
    await wait(round.booster ? 1000 : 500)
    if (!live(id)) return

    // the wheel
    setPhase('spin')
    showtimeSfx.spin()
    const from = rot.get()
    const want = restAngle(round.segment, (rand() - 0.5) * 0.7)
    const base = from + 360 * 5
    const target = base + ((((want - base) % 360) + 360) % 360)
    let peg = Math.floor((from + STEP / 2) / STEP)
    let lastT = performance.now()
    let lastV = from
    await animate(rot, target, {
      duration: 7,
      ease: [0.1, 0.55, 0.08, 1],
      onUpdate: (v) => {
        const now = performance.now()
        const speed = Math.min(1, Math.abs(v - lastV) / Math.max(1, now - lastT) / 1.2)
        lastT = now
        lastV = v
        const k = Math.floor((v + STEP / 2) / STEP)
        if (k !== peg) {
          peg = k
          showtimeSfx.tick(speed)
          flap.set(-14 - 16 * (1 - speed))
          void animate(flap, 0, { type: 'spring', stiffness: 700, damping: 14 })
        }
      },
    })
    if (!live(id)) return
    setWinner(round.spot)
    const bonus = isBonus(round.spot)
    showtimeSfx.land(bonus)
    setSay(`The wheel stops on ${LOOK[round.spot].name}`)
    if (bonus) {
      await wait(1900)
      if (!live(id)) return
      setPhase('bonus')
      setBonusOn(true)
      // the bonus round calls finish when its show ends
    } else {
      await wait(500)
      if (live(id)) finish(id)
    }
  }

  function finish(id: number) {
    if (!live(id)) return
    const pl = play.current
    if (!pl) return
    setBonusOn(false)
    const paid = settlePending()
    const r = pl.round
    logPast({ t: Date.now(), spot: r.spot, win: settle(pl.stakes, r).win, boosted: r.booster?.spot === r.spot })
    setPhase('result')
    if (paid && pl.ret > 0) {
      setWinShow({ id, amount: pl.ret, total: pl.total, spot: r.spot, x: settle(pl.stakes, r).win })
      showtimeSfx.win(pl.ret >= pl.total * 10)
      setSay(`You win ${fmt(pl.ret)}`)
    } else {
      showtimeSfx.lose()
      setSay('No win this time')
    }
    timers.current.push(
      window.setTimeout(() => {
        if (!live(id)) return
        setWinShow(null)
        setWinner(null)
        setPhase('bet')
      }, 3200),
    )
  }

  // the keyboard: Space spins, R repeats, U undoes, X clears, D doubles, 1-8 put the chip on a spot
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey || info) return
      if (e.code === 'Space') {
        e.preventDefault()
        void spin()
      } else if (e.key === 'r' || e.key === 'R') repeat()
      else if (e.key === 'u' || e.key === 'U') doUndo()
      else if (e.key === 'x' || e.key === 'X') clear()
      else if (e.key === 'd' || e.key === 'D') double()
      else if (/^[1-8]$/.test(e.key)) bet(SPOTS[Number(e.key) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- layout ---------------- */

  const wide = size.w >= 760
  // the wheel is big, its top under the flapper near the top of the stage and its lower part running off the bottom
  const wheelSize = Math.max(240, Math.min(size.w * (wide ? 0.6 : 0.98), size.h * (wide ? 1.3 : 1.18)))
  const pl = play.current
  const roundBoost = pl && pl.round.booster?.spot === pl.round.spot ? pl.round.booster.mult : 1
  const shownBoost = boostLanded ? boostResult : null

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-line bg-[#0d0a1c] shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
        <div ref={stageRef} className="relative h-[min(52vh,470px)] min-h-[330px] select-none overflow-hidden lg:h-[calc(100dvh-108px-262px)] lg:min-h-[400px]">
          {/* the studio: a purple glow behind the wheel, two spotlights and a lit floor */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,#3b2380_0%,#1a1040_45%,#0d0a1c_80%)]" />
          <div className="pointer-events-none absolute -left-[10%] -top-1/4 h-[150%] w-[38%] origin-top rotate-[20deg] bg-[linear-gradient(180deg,rgba(255,236,170,.13),transparent_65%)] blur-2xl" />
          <div className="pointer-events-none absolute -right-[10%] -top-1/4 h-[150%] w-[38%] origin-top -rotate-[20deg] bg-[linear-gradient(180deg,rgba(170,220,255,.12),transparent_65%)] blur-2xl" />
          <div className="absolute" style={{ width: wheelSize, height: wheelSize, left: (size.w - wheelSize) / 2, top: wide ? 30 : 24 }}>
            <MoneyWheel rot={rot} flap={flap} boosted={shownBoost?.spot ?? null} boost={shownBoost?.mult ?? 1} chase={phase === 'spin'} win={phase === 'spin' ? null : winner} />
          </div>
          <div className="absolute left-2 top-2 z-10 origin-top-left max-sm:scale-[.8] sm:left-3 sm:top-3">
            <BoosterPanel result={boostResult} spin={boostSpin} landed={boostLanded} onStop={(i) => showtimeSfx.reelStop(i)} compact={!wide} />
          </div>
          <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-2 sm:right-3 sm:top-3">
            <button onClick={() => setInfo(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-black/40 px-3 text-[12.5px] font-bold text-white/85 ring-1 ring-white/10 transition hover:bg-black/60">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/85 text-[10px] font-black text-[#140e33]">?</span>
              <span className="hidden sm:inline">How it works</span>
            </button>
            {wide && <HistoryColumn hist={hist} />}
          </div>
          {/* what is happening, at the foot of the stage */}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <motion.div key={phase} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-full bg-black/55 px-4 py-1.5 text-[13px] font-bold text-white/90 ring-1 ring-white/10 backdrop-blur">
              {phase === 'bet' && (total ? `${fmt(total)} on the board. Spin when you're ready` : 'Place your bets')}
              {phase === 'boost' && 'The Booster is choosing a spot…'}
              {phase === 'spin' && 'Round and round it goes…'}
              {phase === 'bonus' && pl && LOOK[pl.round.spot].name}
              {phase === 'result' && pl && (pl.ret > 0 ? `${LOOK[pl.round.spot].name} pays ${fmtX(settle(pl.stakes, pl.round).win)}` : `${LOOK[pl.round.spot].name}. No win this time`)}
            </motion.div>
          </div>
          <AnimatePresence>
            {bonusOn && pl && pl.round.bonus && (
              <BonusRound key={pl.id} play={pl} boost={roundBoost} onDone={() => finish(pl.id)} />
            )}
          </AnimatePresence>
          <AnimatePresence>{winShow && <WinPlate key={winShow.id} show={winShow} />}</AnimatePresence>
          <div className="sr-only" aria-live="polite">
            {say}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 bg-panel2 p-2.5 sm:p-3">
          {!wide && <HistoryStrip hist={hist} />}
          <Board stakes={stakes} onBet={bet} open={open} boost={shownBoost} winner={phase === 'result' || phase === 'bonus' ? winner : null} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="no-scrollbar -mx-1 flex w-full min-w-0 gap-1 overflow-x-auto px-1 py-0.5 sm:w-auto sm:flex-1">
              {CHIPS.map((v) => (
                <button
                  key={v}
                  onClick={() => setChip(v)}
                  aria-label={`Chip ${v}`}
                  aria-pressed={chip === v}
                  className={`shrink-0 rounded-full transition ${chip === v ? '-translate-y-1 ring-2 ring-white ring-offset-2 ring-offset-panel2' : 'opacity-70 hover:opacity-100'}`}
                >
                  <Chip value={v} size={38} label={chipLabel(v)} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Small onClick={doUndo} off={!open || !undo.length}>
                Undo<Kbd>U</Kbd>
              </Small>
              <Small onClick={clear} off={!open || !total}>
                Clear<Kbd>X</Kbd>
              </Small>
              <Small onClick={double} off={!open || !total}>
                ×2<Kbd>D</Kbd>
              </Small>
              <Small onClick={repeat} off={!open || !last}>
                Repeat<Kbd>R</Kbd>
              </Small>
            </div>
            <button
              onClick={() => void spin()}
              disabled={!open}
              className="flex h-12 min-w-[150px] flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-[16px] font-black text-[#032412] shadow-[0_10px_28px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:brightness-110 disabled:opacity-50 sm:flex-none"
            >
              {open ? (
                <>
                  Spin
                  {total > 0 && (
                    <span className="tnum flex items-center gap-1 rounded-md bg-black/15 px-1.5 py-0.5 text-[13px]">
                      {fmt(total)} <Coin size={13} />
                    </span>
                  )}
                  <Kbd>Space</Kbd>
                </>
              ) : (
                'Spinning…'
              )}
            </button>
          </div>
          {total > balance && open && <div className="text-[12px] font-semibold text-gold">Your bets come to more than your balance. Clear some chips to spin.</div>}
        </div>
      </div>
      <AnimatePresence>{info && <HowItWorks onClose={() => setInfo(false)} />}</AnimatePresence>
    </div>
  )
}

function Small({ onClick, off, children }: { onClick: () => void; off: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={off} className="flex h-10 items-center rounded-lg bg-raised px-2.5 text-[12.5px] font-bold text-ink transition hover:bg-hover disabled:opacity-40 sm:px-3">
      {children}
    </button>
  )
}

/** the bonus round the wheel stopped on, over the stage */
function BonusRound({ play, boost, onDone }: { play: Play; boost: number; onDone: () => void }) {
  const r = play.round
  const b = r.bonus!
  const stake = play.stakes[r.spot] ?? 0
  const common = { boost, stake, win: r.bonusWin, onDone }
  if (b.kind === 'coin') return <CoinTossShow round={b} {...common} />
  if (b.kind === 'peg') return <PegDropShow round={b} {...common} />
  if (b.kind === 'wall') return <PrizeWallShow round={b} {...common} />
  return <MegaSpinShow round={b} {...common} />
}

/** the round's payout, over the stage */
function WinPlate({ show }: { show: { amount: number; total: number; spot: Spot; x: number } }) {
  const big = show.amount >= show.total * 10
  const L = LOOK[show.spot]
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        initial={{ scale: 0.5, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 16 }}
        className="rounded-3xl border-4 bg-[#140e33]/92 px-8 py-4 text-center backdrop-blur"
        style={{ borderColor: big ? '#f7c548' : '#22d36f', boxShadow: `0 0 70px -10px ${big ? '#f7c548' : '#22d36f'}` }}
      >
        <div className="flex items-center justify-center gap-2 text-[12px] font-black uppercase tracking-[.2em] text-white/70">
          <SpotBadge spot={show.spot} size={20} /> {L.name} {fmtX(show.x)}
        </div>
        <div className={`tnum mt-1 flex items-center justify-center gap-2 text-[40px] font-black leading-none sm:text-[52px] ${big ? 'text-gold' : 'text-accent'}`}>
          +{fmt(show.amount)} <Coin size={34} />
        </div>
        {big && <div className="mt-1 text-[13px] font-black uppercase tracking-widest text-gold">Big win!</div>}
      </motion.div>
    </motion.div>
  )
}

/** the last results, newest at the top, beside the wheel */
function HistoryColumn({ hist }: { hist: Past[] }) {
  const items = hist.slice(-9).reverse()
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-black/35 p-1.5 ring-1 ring-white/10">
      {items.map((h, i) => (
        <motion.div key={h.t} initial={{ opacity: 0, x: 10 }} animate={{ opacity: i ? 0.85 : 1, x: 0 }} className="flex items-center gap-1.5 rounded-lg px-1 py-0.5">
          <SpotBadge spot={h.spot} size={22} />
          {isBonus(h.spot) && <span className="tnum text-[11.5px] font-black text-white">{fmtX(h.win)}</span>}
          {h.boosted && <span className="tnum rounded bg-gold/90 px-1 text-[10px] font-black text-[#3a2400]">B</span>}
        </motion.div>
      ))}
    </div>
  )
}

/** the last results in a row, newest first, on narrow screens */
function HistoryStrip({ hist }: { hist: Past[] }) {
  const items = hist.slice(-14).reverse()
  if (!items.length) return null
  return (
    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-dim">Last</span>
      {items.map((h) => (
        <span key={h.t} className="flex shrink-0 items-center gap-1 rounded-full bg-black/30 py-0.5 pl-0.5 pr-2">
          <SpotBadge spot={h.spot} size={20} />
          <span className="tnum text-[11px] font-black text-white/85">{fmtX(h.win)}</span>
        </span>
      ))}
    </div>
  )
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="How Showtime works" width={560}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-muted">
        <p>
          Put chips on any of the eight spots and spin the wheel. It has {SEGMENTS} segments; the spot it stops on wins and the rest lose. Numbers pay their value to 1, and a bonus round pays the multiplier it ends on, to 1.
          Your stake comes back on every win.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SPOTS.map((s) => (
            <div key={s} className="flex items-center gap-2 rounded-xl bg-stage px-2.5 py-2">
              <SpotBadge spot={s} size={28} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-ink">{s.length <= 2 ? `Number ${s}` : LOOK[s].name}</div>
                <div className="text-[11.5px] text-dim">
                  {COUNT[s]} of {SEGMENTS} segments
                </div>
              </div>
            </div>
          ))}
        </div>
        <p>
          <b className="text-ink">The Booster</b> runs before every spin and lights one spot with a multiplier from ×{BOOST[0][0]} to ×{BOOST[BOOST.length - 1][0]} (or misses, {Math.round(BOOST_MISS * 100)}% of the time). If the wheel stops on that
          spot, its win is multiplied: a boosted bonus round has all of its multipliers boosted.
        </p>
        <ul className="flex flex-col gap-1.5">
          {BONUS_SPOTS.map((s) => (
            <li key={s} className="flex gap-2">
              <SpotBadge spot={s} size={20} className="mt-0.5 shrink-0" />
              <span>
                <b className="text-ink">{LOOK[s].name}.</b>{' '}
                {s === 'coin' && 'A coin with a multiplier on each face is tossed; the face that lands up pays.'}
                {s === 'peg' && 'A puck drops down the pegs onto 16 slots. A DOUBLE doubles every slot and drops the puck again.'}
                {s === 'wall' && 'Sixty prizes hide behind the tiles. Pick one before the timer runs out.'}
                {s === 'mega' && 'Pick one of three flappers and spin the giant wheel. DOUBLE and TRIPLE multiply the whole wheel and spin it again.'}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-dim">
          Every spot returns {(RTP * 100).toFixed(0)}% over time (the Booster's chances are set so that each one does: {SPOTS.map((s) => `${LOOK[s].short} ${(BOOST_CHANCE[s] * 100).toFixed(1)}%`).join(', ')}). A bonus round pays
          at most {fmtX(MAX_WIN)} your stake. One spot holds up to {fmt(SPOT_LIMIT, 0)} a spin. Rounds are drawn when you press Spin, so leaving the page never changes one.
        </p>
      </div>
    </Modal>
  )
}


