import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Stat, Toggle, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'
import {
  BUY_PRICE,
  COLS,
  FREE_SPINS,
  MAX_FREE_SPINS,
  MAX_WIN,
  MIN_COUNT,
  PAYS,
  PAY_SYMS,
  RETRIGGER_SPINS,
  RETRIGGER_STARS,
  STARS_TO_TRIGGER,
  STAR_PAYS,
  playRound,
  type Cell,
  type Grid,
  type Round,
  type Spin,
  type Sym,
} from './rules'
import { SYMBOL_COLOR, SYMBOL_NAME, orbColor } from './meta'
import type { SlotScene } from './scene'

/*
  Slots: a 6 × 5 pay-anywhere grid in 3D. The round is drawn in full when the spin is placed (rules.ts);
  this screen plays it back through the scene, step by step, and settles when the show is over.
*/

type BannerData =
  | { kind: 'intro'; spins: number; bought: boolean }
  | { kind: 'retrigger'; spins: number }
  | { kind: 'end'; amount: number; spins: number }
  | { kind: 'big'; amount: number; mult: number }
  | { kind: 'max'; amount: number }
type Banner = BannerData & { id: number }
type Pop = { id: number; x: number; y: number; amount: number; color: string }
type Hud = { win: number; free: { left: number; played: number } | null; mult: { base: number; sum: number; done: boolean } | null }

const EMPTY_HUD: Hud = { win: 0, free: null, mult: null }

/** Ids of every cell of one kind, column by column. */
const cellsOf = (grid: Grid, sym: Sym): Cell[] => grid.flatMap((col) => col.filter((c) => c.sym === sym))

/** Once three stars are showing, the remaining columns hold back and glow. Returns the first such column, or -1. */
function teaseColumn(grid: Grid) {
  let stars = 0
  for (let c = 0; c < COLS - 1; c++) {
    stars += grid[c].filter((x) => x.sym === 'star').length
    if (stars >= STARS_TO_TRIGGER - 1) return c + 1
  }
  return -1
}

/** A calm opening grid: no wins, fewer than three stars. */
function startGrid(): Grid {
  for (let i = 0; i < 40; i++) {
    const r = playRound(rand)
    const g = r.base!.tumbles[r.base!.tumbles.length - 1].grid
    if (cellsOf(g, 'star').length < 2) return g
  }
  return playRound(rand).base!.tumbles[0].grid
}

const tier = (mult: number) => (mult >= 100 ? 'Epic win' : mult >= 40 ? 'Mega win' : 'Big win')

export default function Slots() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const [turbo, setTurbo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const [failed, setFailed] = useState(false)
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [pops, setPops] = useState<Pop[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [lastWin, setLastWin] = useState(0)
  const [paytable, setPaytable] = useState(false)
  const [buying, setBuying] = useState(false)
  const [thumbs, setThumbs] = useState<Partial<Record<Sym, string>>>({})
  const [frameTop, setFrameTop] = useState(80)

  const hostRef = useRef<HTMLDivElement>(null)
  const multRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SlotScene | null>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const seq = useRef(1)
  const bannerDone = useRef<(() => void) | null>(null)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  /** a round already paid for but not yet settled; settled on the way out if the player leaves */
  const pending = useRef<{ bet: number; payout: number; feature: boolean; mult: number } | null>(null)

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    // per run of this effect, so a remount never ends up with two scenes
    let live = true
    const host = hostRef.current!
    let sc: SlotScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ SlotScene }) => {
        if (!live) return
        setProgress(0.12)
        sc = new SlotScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __slotsScene?: SlotScene }).__slotsScene = sc
        sc.setTurbo(turboRef.current)
        sc.onProgress = (p) => alive.current && setProgress(0.12 + p * 0.88)
        sc.onLand = (heavy) => sfx.drop(heavy)
        sc.onCoin = () => sfx.coin()
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          setFrameTop(sc!.frameRect().top)
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!live || !sc) return
          setThumbs(sc.thumbs)
          setReady(true)
          void sc.drop(startGrid())
        })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      alive.current = false
      ro?.disconnect()
      bannerDone.current?.()
      sc?.dispose()
      sceneRef.current = null
      const p = pending.current
      if (p) useWallet.getState().settle({ game: 'slots', bet: p.bet, payout: p.payout, meta: { feature: p.feature, mult: p.mult } })
      pending.current = null
    }
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo])

  /* ---------------- playback ---------------- */

  const showBanner = (b: BannerData, ms: number) =>
    new Promise<void>((resolve) => {
      setBanner({ ...b, id: seq.current++ } as Banner)
      if (b.kind === 'intro' || b.kind === 'retrigger') sfx.feature()
      else sfx.bigWin()
      const sc = sceneRef.current
      if (sc && (b.kind === 'big' || b.kind === 'max' || (b.kind === 'end' && b.amount >= bet * 20))) sc.coinShower(b.kind === 'big' ? 2.2 : 2.8)
      const finish = () => {
        clearTimeout(t)
        bannerDone.current = null
        sceneRef.current?.stopShower()
        setBanner(null)
        resolve()
      }
      const t = setTimeout(finish, turboRef.current ? ms * 0.7 : ms)
      bannerDone.current = finish
    })

  /** plays one spin of a round; `before` is the win already on the counter, returns the new total */
  const playSpin = async (sc: SlotScene, spin: Spin, free: boolean, before: number, unit: number) => {
    const coins = (m: number) => round2(m * unit)
    const first = spin.tumbles[0].grid
    const tease = free ? -1 : teaseColumn(first)
    if (tease >= 0) void sc.wait(0.42 + tease * 0.075).then(() => alive.current && sfx.tease())
    await sc.drop(first, tease)
    let run = before
    for (let i = 0; i < spin.tumbles.length - 1; i++) {
      if (!alive.current) return run
      const t = spin.tumbles[i]
      const ids = t.wins.flatMap((w) => w.ids)
      setPops(
        t.wins.map((w) => {
          const at = sc.screenOf(w.ids) ?? { x: 0, y: 0 }
          return { id: seq.current++, x: at.x, y: at.y, amount: coins(w.pay), color: SYMBOL_COLOR[w.sym] }
        }),
      )
      sfx.cascade(i)
      run = round2(run + coins(t.win))
      setHud((h) => ({ ...h, win: run }))
      await sc.highlight(ids)
      sfx.shatter()
      await sc.shatter(ids)
      setPops([])
      await sc.tumble(spin.tumbles[i + 1].grid)
    }
    if (!alive.current) return run
    const last = spin.tumbles[spin.tumbles.length - 1].grid
    const stars = cellsOf(last, 'star')
    if ((!free && spin.stars >= STARS_TO_TRIGGER) || (free && spin.award > 0)) {
      sfx.star()
      if (spin.starPay > 0) {
        const at = sc.screenOf(stars.map((c) => c.id)) ?? { x: 0, y: 0 }
        setPops([{ id: seq.current++, x: at.x, y: at.y, amount: coins(spin.starPay), color: SYMBOL_COLOR.star }])
        run = round2(run + coins(spin.starPay))
        setHud((h) => ({ ...h, win: run }))
      }
      await sc.celebrate(stars.map((c) => c.id))
      setPops([])
    }
    if (free && spin.orbSum > 0 && spin.tumbleWin > 0 && alive.current) {
      const orbs = cellsOf(last, 'orb')
      const base = coins(spin.tumbleWin)
      let sum = 0
      setHud((h) => ({ ...h, mult: { base, sum: 0, done: false } }))
      const host = hostRef.current!.getBoundingClientRect()
      const m = multRef.current?.getBoundingClientRect()
      const target = m ? { x: m.left + m.width / 2 - host.left, y: m.top + m.height / 2 - host.top } : { x: host.width / 2, y: 40 }
      sfx.orb()
      await sc.collect(
        orbs.map((c) => c.id),
        target,
        (i) => {
          sum += orbs[i].mult ?? 0
          sfx.orbHit(i)
          setHud((h) => ({ ...h, mult: { base, sum, done: false } }))
        },
      )
      run = round2(run - base + coins(spin.tumbleWin * spin.orbSum))
      setHud((h) => ({ ...h, win: run, mult: { base, sum: spin.orbSum, done: true } }))
      sfx.win()
      await sc.wait(1)
    }
    return run
  }

  const play = async (buy: boolean): Promise<number | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !ready) return null
    const unit = bet
    const cost = round2(buy ? unit * BUY_PRICE : unit)
    if (!stake(cost)) return null
    busyRef.current = true
    setBusy(true)
    setPops([])
    setHud(EMPTY_HUD)
    sfx.spinStart()

    let round: Round = playRound(rand, buy)
    // dev only: window.__slotsForce = 'feature' | 'big' replays until that happens, for testing
    if (import.meta.env.DEV) {
      const force = (window as unknown as { __slotsForce?: string }).__slotsForce
      if (force === 'feature' && !buy) while (!round.free.length) round = playRound(rand)
      if (force === 'big') while (round.total < 20 || round.free.length) round = playRound(rand)
    }
    const payout = round2(unit * round.total)
    const feature = !buy && round.free.length > 0
    pending.current = { bet: cost, payout, feature, mult: payout / cost }

    let shown = 0
    if (round.base) shown = await playSpin(sc, round.base, false, 0, unit)
    if (!alive.current) return null

    if (round.free.length) {
      const first = round.base ? round.base.award : FREE_SPINS
      await showBanner({ kind: 'intro', spins: first, bought: buy }, 2600)
      if (!alive.current) return null
      sc.setFree(true)
      let left = first
      let given = first
      let played = 0
      for (const fs of round.free) {
        left--
        played++
        setHud((h) => ({ ...h, win: shown, free: { left, played }, mult: null }))
        shown = await playSpin(sc, fs, true, shown, unit)
        if (!alive.current) return null
        if (fs.award && given < MAX_FREE_SPINS) {
          const add = Math.min(fs.award, MAX_FREE_SPINS - given)
          left += add
          given += add
          setHud((h) => ({ ...h, free: { left, played } }))
          await showBanner({ kind: 'retrigger', spins: add }, 1500)
        }
        await sc.wait(0.3)
        if (!alive.current) return null
      }
      sc.setFree(false)
      await showBanner(round.capped ? { kind: 'max', amount: payout } : { kind: 'end', amount: payout, spins: played }, 3400)
      setHud((h) => ({ ...h, free: null, mult: null, win: payout }))
    } else if (round.capped) await showBanner({ kind: 'max', amount: payout }, 3400)
    if (!alive.current) return null

    pending.current = null
    useWallet.getState().settle({ game: 'slots', bet: cost, payout, meta: { feature, mult: payout / cost } })
    setLastWin(payout)
    if (!round.free.length && !round.capped && payout >= unit * 15) await showBanner({ kind: 'big', amount: payout, mult: payout / unit }, auto.running ? 2400 : 3200)
    sc.calm()
    busyRef.current = false
    setBusy(false)
    return payout - cost
  }

  const auto = useAutoBet(() => play(false), turbo ? 150 : 400)
  const locked = busy || auto.running

  const hurry = () => {
    if (bannerDone.current) bannerDone.current()
    else sceneRef.current?.hurry()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.code !== 'Space' || paytable || buying) return
      e.preventDefault()
      if (busyRef.current) hurry()
      else if (mode === 'manual') void play(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const buyCost = round2(bet * BUY_PRICE)
  const inFree = hud.free != null

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <BetInput value={bet} onChange={setBet} disabled={locked} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Last win" value={fmt(lastWin)} tone={lastWin > 0 ? 'accent' : undefined} />
        <Stat label="Max win" value={`${fmt(MAX_WIN, 0)}×`} />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2.5">
        <span className="text-[13px] font-semibold text-muted">Turbo</span>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          onClick={() => (sfx.click(), setBuying(true))}
          disabled={locked || !ready || balance < buyCost}
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[linear-gradient(180deg,#ffd768,#f0a91c)] px-3 text-[14px] font-extrabold text-[#2a1800] shadow-[inset_0_-3px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Buy free spins
          <span className="tnum rounded bg-black/15 px-1.5 py-0.5 text-[12px]">{fmt(buyCost, buyCost >= 1000 ? 0 : 2)}</span>
        </button>
        <button onClick={() => (sfx.click(), setPaytable(true))} className="h-11 rounded-lg bg-raised px-4 text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
          Paytable
        </button>
      </div>
      <div className="max-lg:order-first lg:mt-auto">
        {inFree ? (
          <ActionButton tone="gold" onClick={hurry} sub="Tap to speed up">
            Free spin {hud.free!.played} · {hud.free!.left} left
          </ActionButton>
        ) : mode === 'manual' ? (
          busy ? (
            <ActionButton tone="neutral" onClick={hurry} sub="Tap to speed up">
              Spinning…
            </ActionButton>
          ) : (
            <ActionButton onClick={() => void play(false)} disabled={!ready || balance < bet}>
              Spin
            </ActionButton>
          )
        ) : auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop}>
            Stop autospin
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={!ready || busy || balance < bet}>
            Start autospin
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const hudTop = Math.max(6, frameTop / 2 - 22)

  const stage = (
    <div className="absolute inset-0 overflow-hidden bg-[#08051a]" onPointerDown={() => busyRef.current && hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* counters above the frame */}
      <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center gap-2 px-2" style={{ top: hudTop }}>
        <AnimatePresence>
          {inFree && (
            <motion.div key="fs" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={pill}>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#d9c9ff]/80">Spins</span>
              <span className="tnum text-[18px] font-black text-white">{hud.free!.left}</span>
            </motion.div>
          )}
          {(inFree || hud.win > 0) && (
            <motion.div key="win" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={pill}>
              <span className="text-[11px] font-bold uppercase tracking-wider text-gold/80">{inFree ? 'Total' : 'Win'}</span>
              <Counter value={hud.win} className="text-[18px] font-black text-gold" />
            </motion.div>
          )}
          {inFree && (
            <motion.div key="mult" ref={multRef} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={`${pill} min-w-[64px] justify-center`}>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={hud.mult?.sum ?? 0}
                  initial={{ scale: 1.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="tnum text-[18px] font-black"
                  style={{ color: hud.mult?.sum ? orbColor(hud.mult.sum) : 'rgba(255,255,255,.35)' }}
                >
                  {hud.mult?.sum ? `${hud.mult.sum}×` : '×'}
                </motion.span>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {hud.mult?.done && (
          <motion.div
            key="multdone"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="tnum pointer-events-none absolute inset-x-0 z-10 text-center text-[13px] font-extrabold text-white/90"
            style={{ top: hudTop + 44 }}
          >
            {fmt(hud.mult.base)} × {hud.mult.sum} = <span className="text-gold">{fmt(round2(hud.mult.base * hud.mult.sum))}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* amounts over each winning cluster */}
      <AnimatePresence>
        {pops.map((p) => (
          <motion.div
            key={p.id}
            className="tnum pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[22px] font-black sm:text-[28px]"
            style={{ left: p.x, top: p.y, color: '#fff', textShadow: `0 0 18px ${p.color}, 0 2px 0 rgba(0,0,0,.6), 0 0 2px #000` }}
            initial={{ opacity: 0, scale: 0.4, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: -6 }}
            exit={{ opacity: 0, scale: 1.15, y: -26, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            {fmt(p.amount)}
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>{banner && <BannerCard key={banner.id} banner={banner} bet={bet} onDone={() => bannerDone.current?.()} />}</AnimatePresence>

      <AnimatePresence>
        {!ready && (
          <motion.div
            key="loading"
            className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_35%,#22134a_0%,#08051a_70%)]"
            exit={{ opacity: 0, transition: { duration: 0.45 } }}
          >
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-muted">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Polishing the gems" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(80vw+120px)] max-sm:min-h-[380px]" />
      <AnimatePresence>{paytable && <PaytableModal bet={bet} thumbs={thumbs} onClose={() => setPaytable(false)} />}</AnimatePresence>
      <AnimatePresence>
        {buying && (
          <Modal onClose={() => setBuying(false)} title="Buy free spins" width={400}>
            <p className="text-[14px] text-muted">
              Go straight to {FREE_SPINS} free spins with multiplier orbs for <span className="font-bold text-ink">{fmt(buyCost)}</span> coins, {BUY_PRICE}× your bet of {fmt(bet)}.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ActionButton tone="neutral" onClick={() => setBuying(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="gold"
                disabled={balance < buyCost}
                onClick={() => {
                  setBuying(false)
                  void play(true)
                }}
              >
                Buy
              </ActionButton>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}

const pill = 'flex h-10 items-center gap-2 rounded-full bg-[#0b0720]/85 px-4 ring-1 ring-white/10'

/** A number that counts up to its value. */
function Counter({ value, className = '' }: { value: number; className?: string }) {
  const [n, setN] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const c = animate(from.current, value, { duration: value > from.current ? 0.6 : 0, ease: 'easeOut', onUpdate: (v) => ((from.current = v), setN(v)) })
    return () => c.stop()
  }, [value])
  return <span className={`tnum ${className}`}>{fmt(n)}</span>
}

function Star({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 1.8l3 6.4 7 .8-5.2 4.8 1.4 6.9L12 17.2l-6.2 3.5 1.4-6.9L2 9l7-.8 3-6.4Z" fill="currentColor" />
    </svg>
  )
}

function BannerCard({ banner, bet, onDone }: { banner: Banner; bet: number; onDone: () => void }) {
  const [n, setN] = useState(0)
  const amount = 'amount' in banner ? banner.amount : null
  useEffect(() => {
    if (amount == null) return
    const c = animate(0, amount, { duration: banner.kind === 'end' || banner.kind === 'max' ? 2 : 1.6, ease: [0.2, 0.7, 0.3, 1], onUpdate: setN })
    return () => c.stop()
  }, [amount, banner.kind])

  let title: ReactNode
  let sub: ReactNode = null
  const gold = banner.kind !== 'intro' && banner.kind !== 'retrigger'
  if (banner.kind === 'intro') {
    title = (
      <>
        <div className="text-[64px] font-black leading-none sm:text-[84px]">{banner.spins}</div>
        <div className="mt-1 text-[22px] font-black uppercase tracking-tight sm:text-[28px]">Free spins</div>
      </>
    )
    sub = banner.bought ? 'Multiplier orbs are in play' : 'Multiplier orbs are in play. Good luck!'
  } else if (banner.kind === 'retrigger') {
    title = <div className="text-[30px] font-black uppercase leading-none sm:text-[40px]">+{banner.spins} free spins</div>
  } else {
    const head = banner.kind === 'big' ? tier(banner.mult) : banner.kind === 'max' ? 'Max win' : 'Total win'
    title = <div className="text-[28px] font-black uppercase leading-none tracking-tight sm:text-[40px]">{head}</div>
    sub =
      banner.kind === 'end' ? `${banner.spins} free spins · ${fmt(banner.amount / bet, 2)}×` : banner.kind === 'big' ? `${fmt(banner.mult, 2)}× your bet` : `${fmt(MAX_WIN, 0)}× your bet`
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-black/60 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      onClick={onDone}
    >
      <motion.div
        initial={{ scale: 0.5, y: 30, rotate: -4 }}
        animate={{ scale: 1, y: 0, rotate: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 16 }}
        className="relative flex flex-col items-center text-center"
      >
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 opacity-60"
          animate={{ rotate: 360 }}
          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
        >
          <div
            className={`h-full w-full rounded-full ${
              gold
                ? 'bg-[repeating-conic-gradient(from_0deg,rgba(255,200,61,.32)_0deg_8deg,transparent_8deg_24deg)]'
                : 'bg-[repeating-conic-gradient(from_0deg,rgba(176,92,255,.34)_0deg_8deg,transparent_8deg_24deg)]'
            } [mask-image:radial-gradient(circle,black_20%,transparent_68%)]`}
          />
        </motion.div>
        {(banner.kind === 'intro' || banner.kind === 'retrigger') && (
          <div className="relative mb-2 flex items-end gap-1 text-gold drop-shadow-[0_0_12px_rgba(255,200,61,.8)]">
            <Star className="h-7 w-7 -rotate-12" />
            <Star className="h-10 w-10" />
            <Star className="h-7 w-7 rotate-12" />
          </div>
        )}
        <div
          className={`relative bg-clip-text text-transparent drop-shadow-[0_4px_0_rgba(0,0,0,.45)] ${
            gold ? 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]' : 'bg-[linear-gradient(180deg,#ffffff_0%,#e6d4ff_45%,#b07bff_100%)]'
          }`}
        >
          {title}
        </div>
        {amount != null && (
          <div className="tnum relative mt-3 flex items-center gap-2 text-[34px] font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,.5)] sm:text-[44px]">
            {fmt(n)} <Coin size={34} />
          </div>
        )}
        {sub && <div className="relative mt-2 text-[14px] font-bold text-white/80">{sub}</div>}
        <div className="relative mt-4 text-[11px] font-semibold uppercase tracking-widest text-white/40">Tap to continue</div>
      </motion.div>
    </motion.div>
  )
}

function PaytableModal({ bet, thumbs, onClose }: { bet: number; thumbs: Partial<Record<Sym, string>>; onClose: () => void }) {
  const pic = (s: Sym, size = 44) =>
    thumbs[s] ? (
      <img src={thumbs[s]} alt="" width={size} height={size} className="shrink-0" />
    ) : (
      <span className="shrink-0 rounded-full" style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2, background: SYMBOL_COLOR[s] }} />
    )
  const money = (m: number) => fmt(bet * m, bet * m >= 1000 ? 0 : 2)
  return (
    <Modal onClose={onClose} title="Paytable" width={560}>
      <p className="text-[13px] text-muted">
        {MIN_COUNT} or more of a symbol anywhere on the grid win. Winners shatter and new symbols tumble in, so one spin can win again and again. Amounts are for your bet of {fmt(bet)}.
      </p>
      <div className="mt-3 grid grid-cols-[1fr_repeat(3,64px)] items-center gap-x-2 px-2 text-center text-[11px] font-bold uppercase tracking-wider text-dim">
        <span className="text-left">Symbol</span>
        <span>8–9</span>
        <span>10–11</span>
        <span>12+</span>
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {PAY_SYMS.map((s) => (
          <div key={s} className="grid grid-cols-[1fr_repeat(3,64px)] items-center gap-x-2 rounded-lg bg-stage px-2 py-1">
            <div className="flex min-w-0 items-center gap-2">
              {pic(s)}
              <span className="truncate text-[13px] font-bold">{SYMBOL_NAME[s]}</span>
            </div>
            {PAYS[s].map((m, i) => (
              <span key={i} className="tnum text-center text-[13px] font-extrabold">
                {money(m)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-start gap-3 rounded-lg bg-gold/10 px-3 py-3 ring-1 ring-gold/25">
        {pic('star', 52)}
        <div className="text-[13px] text-muted">
          <span className="font-bold text-ink">Stars start free spins.</span> {STARS_TO_TRIGGER}, 5 or 6+ stars anywhere pay {STAR_PAYS.map(money).join(', ')} and start {FREE_SPINS} free spins. During
          free spins, {RETRIGGER_STARS} or more stars add {RETRIGGER_SPINS} more (up to {MAX_FREE_SPINS}).
        </div>
      </div>
      <div className="mt-2 flex items-start gap-3 rounded-lg bg-violet/10 px-3 py-3 ring-1 ring-violet/25">
        {pic('orb', 52)}
        <div className="text-[13px] text-muted">
          <span className="font-bold text-ink">Multiplier orbs</span> land only in free spins, worth 2× to 100×. When a free spin wins, every orb on the grid is added up and multiplies that spin's win.
        </div>
      </div>
      <p className="mt-3 text-[12px] text-dim">
        Buy free spins for {BUY_PRICE}× the bet. A round pays at most {fmt(MAX_WIN, 0)}× the bet. Return to player about 96.5% over the long run.
      </p>
    </Modal>
  )
}
