import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Stat, Toggle, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt, fmtCompact, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'
import {
  BUY_PRICE,
  BUY_SPINS,
  COLS,
  EGGS_TO_TRIGGER,
  EGG_PAYS,
  EGG_SPINS,
  LEVEL_MULTS,
  LEVEL_SPINS,
  MAX_WIN,
  PAYS,
  PAY_SYMS,
  WILDS_PER_LEVEL,
  cellsOf,
  playRound,
  type Grid,
  type Round,
  type Spin,
  type Sym,
} from './rules'
import { SYMBOL_COLOR, SYMBOL_NAME, donutColor } from './meta'
import type { ChompScene } from './scene'

/*
  Chompers: five reels of cartoon monsters, 1,024 ways. The round is drawn in full when the spin is placed
  (rules.ts); this screen plays it back through the 3D scene and settles when the show is over.
*/

type BannerData =
  | { kind: 'intro'; spins: number; bought: boolean }
  | { kind: 'level'; spins: number; mult: number }
  | { kind: 'end'; amount: number; spins: number }
  | { kind: 'big'; amount: number; mult: number }
  | { kind: 'max'; amount: number }
type Banner = BannerData & { id: number }
type Pop = { id: number; x: number; y: number; amount: number; color: string; big?: boolean }
type Meter = { wilds: number; level: number }
type Hud = { win: number; free: { left: number; played: number } | null; meter: Meter | null }

const EMPTY_HUD: Hud = { win: 0, free: null, meter: null }

/** the grid as the reels land it, before any wild sneaks in */
const landed = (s: Spin): Grid => (s.sneak ? s.grid.map((col, c) => col.map((cell, r) => (c === s.sneak!.col && r === s.sneak!.row ? s.sneak!.replaced : cell))) : s.grid)

/** with two eggs already showing, the reels after them hold back and glow; returns the first such reel, or -1 */
function teaseColumn(grid: Grid) {
  let eggs = 0
  for (let c = 0; c < COLS - 1; c++) {
    eggs += grid[c].filter((x) => x.sym === 'egg').length
    if (eggs >= EGGS_TO_TRIGGER - 1) return c + 1
  }
  return -1
}

/** a calm opening screen: no win, no feature */
function startGrid(): Grid {
  for (let i = 0; i < 60; i++) {
    const r = playRound(rand)
    const s = r.base!
    if (!s.win && !s.sneak && s.eggs < 2 && !cellsOf(s.grid, 'wild').length) return s.grid
  }
  return playRound(rand).base!.grid
}

const tier = (mult: number) => (mult >= 100 ? 'Epic win' : mult >= 40 ? 'Mega win' : 'Big win')

export default function Chompers() {
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
  const [hudTop, setHudTop] = useState(-100)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ChompScene | null>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const seq = useRef(1)
  const bannerDone = useRef<(() => void) | null>(null)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const betRef = useRef(bet)
  betRef.current = bet
  /** a round already paid for but not yet settled; settled on the way out if the player leaves */
  const pending = useRef<{ bet: number; payout: number; feature: boolean; mult: number } | null>(null)

  const donutText = (v: number) => {
    const a = round2(v * betRef.current)
    return a >= 10000 ? fmtCompact(a) : a >= 1000 ? fmt(a, 0) : fmt(a)
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let live = true
    const host = hostRef.current!
    let sc: ChompScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ ChompScene }) => {
        if (!live) return
        setProgress(0.12)
        sc = new ChompScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __chompScene?: ChompScene }).__chompScene = sc
        sc.setTurbo(turboRef.current)
        sc.donutText = donutText
        sc.onProgress = (p) => alive.current && setProgress(0.12 + p * 0.88)
        sc.onCoin = () => sfx.coin()
        sc.onReelStop = (col, syms) => {
          sfx.reelStop(col)
          if (syms.includes('wild')) sfx.boing()
          if (syms.includes('donut')) sfx.donutLand()
        }
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          // the counters sit in the space under the frame; the frame's eyes have the space above it
          const f = sc!.frameRect()
          setHudTop(Math.round(Math.min(r.height - 46, f.bottom + (r.height - f.bottom) / 2 - 20)))
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!live || !sc) return
          setThumbs(sc.thumbs)
          sc.show(startGrid())
          setReady(true)
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
      if (p) useWallet.getState().settle({ game: 'chompers', bet: p.bet, payout: p.payout, meta: { feature: p.feature, mult: p.mult } })
      pending.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo])
  useEffect(() => {
    if (!busyRef.current) sceneRef.current?.relabel()
  }, [bet])

  /* ---------------- playback ---------------- */

  const showBanner = (b: BannerData, ms: number) =>
    new Promise<void>((resolve) => {
      setBanner({ ...b, id: seq.current++ } as Banner)
      if (b.kind === 'intro') sfx.feature()
      else if (b.kind === 'level') sfx.levelUp()
      else sfx.bigWin()
      const sc = sceneRef.current
      if (sc && (b.kind === 'big' || b.kind === 'max' || (b.kind === 'end' && b.amount >= betRef.current * 20))) sc.coinShower(b.kind === 'big' ? 2.2 : 2.8)
      if (sc && (b.kind === 'intro' || b.kind === 'level' || b.kind === 'max')) sc.confettiBurst(80)
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

  const popAt = (ids: number[], amount: number, color: string, big = false): Pop => {
    const at = sceneRef.current?.screenOf(ids) ?? { x: 0, y: 0 }
    return { id: seq.current++, x: at.x, y: at.y, amount, color, big }
  }

  /** plays one spin of a round; `before` is the win already on the counter, returns the new total */
  const playSpin = async (sc: ChompScene, spin: Spin, free: boolean, before: number, unit: number) => {
    const coins = (m: number) => round2(m * unit)
    const grid = landed(spin)
    const tease = free ? -1 : teaseColumn(grid)
    if (tease >= 0) void sc.wait(0.5 + tease * 0.16).then(() => alive.current && sfx.tease())
    let eggsSeen = 0
    const prevStop = sc.onReelStop
    sc.onReelStop = (col, syms) => {
      prevStop?.(col, syms)
      const n = syms.filter((s) => s === 'egg').length
      for (let i = 0; i < n; i++) sfx.eggLand(eggsSeen++)
    }
    await sc.spin(grid, free, tease)
    sc.onReelStop = prevStop
    let run = before
    if (!alive.current) return run

    if (spin.sneak) {
      sfx.whoosh()
      await sc.wait(0.2)
      await sc.sneak(spin.sneak.col, spin.sneak.row, spin.sneak.cell, spin.sneak.replaced)
      sfx.boing()
      if (!alive.current) return run
    }

    // ways
    if (spin.ways.length) {
      setPops(spin.ways.map((w) => popAt(w.ids, coins(w.pay), SYMBOL_COLOR[w.sym])))
      run = round2(run + coins(spin.waysWin))
      setHud((h) => ({ ...h, win: run }))
      if (spin.waysWin >= 5) sfx.bigWin()
      else sfx.win()
      await sc.highlight([...new Set(spin.ways.flatMap((w) => w.ids))], spin.ways.length > 2 ? 1.5 : 1.2)
      setPops([])
      sc.clearHighlight()
      await sc.wait(0.2)
      if (!alive.current) return run
    }

    // every wild eats every donut
    if (spin.collects.length) {
      const values = new Map(cellsOf(spin.grid, 'donut').map((d) => [d.id, d.value ?? 0]))
      for (let i = 0; i < spin.collects.length; i++) {
        const c = spin.collects[i]
        let got = 0
        const popId = seq.current++
        const at = sc.screenOf([c.wild]) ?? { x: 0, y: 0 }
        await sc.collect(c.wild, c.donuts, (j) => {
          got = round2(got + coins((values.get(c.donuts[j]) ?? 0) * spin.mult))
          sfx.chomp(j)
          setHud((h) => ({ ...h, win: round2(run + got) }))
          setPops([{ id: popId, x: at.x, y: at.y - 40, amount: got, color: SYMBOL_COLOR.wild, big: true }])
        })
        run = round2(run + coins(c.pay))
        setHud((h) => ({ ...h, win: run }))
        sfx.win()
        await sc.wait(0.5)
        setPops([])
        if (!alive.current) return run
      }
    }

    // eggs
    if (!free && spin.eggs >= EGGS_TO_TRIGGER) {
      const ids = cellsOf(spin.grid, 'egg').map((c) => c.id)
      setPops([popAt(ids, coins(spin.eggPay), SYMBOL_COLOR.egg)])
      run = round2(run + coins(spin.eggPay))
      setHud((h) => ({ ...h, win: run }))
      sfx.hatch()
      await sc.eggs(ids, true)
      setPops([])
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
    // dev only: window.__chompForce = 'feature' | 'collect' | 'sneak' | 'big' replays until that happens, for testing
    if (import.meta.env.DEV) {
      const force = (window as unknown as { __chompForce?: string }).__chompForce
      if (force === 'feature' && !buy) while (!round.free.length) round = playRound(rand)
      if (force === 'collect') while (!round.base!.collects.length || round.free.length) round = playRound(rand)
      if (force === 'sneak') while (!round.base!.sneak || round.free.length) round = playRound(rand)
      if (force === 'big') while (round.total < 20 || round.free.length) round = playRound(rand)
    }
    const payout = round2(unit * round.total)
    const feature = !buy && round.free.length > 0
    pending.current = { bet: cost, payout, feature, mult: payout / cost }

    let shown = 0
    if (round.base) shown = await playSpin(sc, round.base, false, 0, unit)
    if (!alive.current) return null

    if (round.free.length) {
      const first = round.base ? round.base.award : BUY_SPINS
      await showBanner({ kind: 'intro', spins: first, bought: buy }, 2800)
      if (!alive.current) return null
      sc.setFree(true)
      let left = first
      let played = 0
      const meter: Meter = { wilds: 0, level: 0 }
      setHud({ win: shown, free: { left, played }, meter: { ...meter } })
      for (const fs of round.free) {
        left--
        played++
        setHud((h) => ({ ...h, win: shown, free: { left, played } }))
        shown = await playSpin(sc, fs, true, shown, unit)
        if (!alive.current) return null
        if (fs.wildsCounted) {
          meter.wilds += fs.wildsCounted
          setHud((h) => ({ ...h, meter: { ...meter } }))
        }
        if (fs.levelUp) {
          meter.level += fs.levelUp
          left += LEVEL_SPINS * fs.levelUp
          setHud((h) => ({ ...h, free: { left, played }, meter: { ...meter } }))
          void sc.levelUp()
          await showBanner({ kind: 'level', spins: LEVEL_SPINS * fs.levelUp, mult: LEVEL_MULTS[meter.level] }, 2000)
        }
        await sc.wait(0.25)
        if (!alive.current) return null
      }
      sc.setFree(false)
      await showBanner(round.capped ? { kind: 'max', amount: payout } : { kind: 'end', amount: payout, spins: played }, 3400)
      setHud((h) => ({ ...h, free: null, meter: null, win: payout }))
    } else if (round.capped) await showBanner({ kind: 'max', amount: payout }, 3400)
    if (!alive.current) return null

    pending.current = null
    useWallet.getState().settle({ game: 'chompers', bet: cost, payout, meta: { feature, mult: payout / cost, level: round.free.reduce((n, s) => n + s.levelUp, 0) } })
    setLastWin(payout)
    if (!round.free.length && !round.capped && payout >= unit * 15) await showBanner({ kind: 'big', amount: payout, mult: payout / unit }, auto.running ? 2400 : 3200)
    sc.calm()
    sc.relabel()
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
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[linear-gradient(180deg,#7dffb5,#1fc96b)] px-3 text-[14px] font-extrabold text-[#03290f] shadow-[inset_0_-3px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
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

  const m = hud.meter
  const maxed = m != null && m.level >= LEVEL_MULTS.length - 1
  const filled = m == null ? 0 : maxed ? WILDS_PER_LEVEL : Math.min(WILDS_PER_LEVEL, m.wilds - m.level * WILDS_PER_LEVEL)

  const stage = (
    <div className="absolute inset-0 overflow-hidden bg-[#14072e]" onPointerDown={() => busyRef.current && hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* counters above the frame */}
      <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center gap-2 px-2" style={{ top: hudTop }}>
        <AnimatePresence>
          {inFree && (
            <motion.div key="fs" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={pill}>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#ffd9f0]/80">Spins</span>
              <span className="tnum text-[18px] font-black text-white">{hud.free!.left}</span>
            </motion.div>
          )}
          {(inFree || hud.win > 0) && (
            <motion.div key="win" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={pill}>
              <span className="text-[11px] font-bold uppercase tracking-wider text-gold/80">{inFree ? 'Total' : 'Win'}</span>
              <Counter value={hud.win} className="text-[18px] font-black text-gold" />
            </motion.div>
          )}
          {m && (
            <motion.div key="meter" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={`${pill} gap-1.5`} aria-label={`${filled} of ${WILDS_PER_LEVEL} wilds, multiplier ${LEVEL_MULTS[m.level]}×`}>
              {Array.from({ length: WILDS_PER_LEVEL }, (_, i) => (
                <motion.span
                  key={`${m.level}-${i}-${i < filled}`}
                  initial={i < filled ? { scale: 1.8 } : false}
                  animate={{ scale: 1 }}
                  className={`h-3 w-3 rounded-full ${i < filled ? 'bg-[#2ee87f] shadow-[0_0_10px_#2ee87f]' : 'bg-white/15'}`}
                />
              ))}
              <AnimatePresence mode="popLayout">
                <motion.span key={m.level} initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="tnum ml-1 text-[17px] font-black text-[#2ee87f]">
                  ×{LEVEL_MULTS[m.level]}
                </motion.span>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* amounts over each win */}
      <AnimatePresence>
        {pops.map((p) => (
          <motion.div
            key={p.id}
            className={`tnum pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-black ${p.big ? 'text-[26px] sm:text-[34px]' : 'text-[22px] sm:text-[28px]'}`}
            style={{ left: p.x, top: p.y, color: '#fff', textShadow: `0 0 18px ${p.color}, 0 3px 0 #1d0f30, 0 0 3px #1d0f30, 0 0 3px #1d0f30` }}
            initial={{ opacity: 0, scale: 0.4, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: -6 }}
            exit={{ opacity: 0, scale: 1.15, y: -26, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            {p.big ? '+' : ''}
            {fmt(p.amount)}
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>{banner && <BannerCard key={banner.id} banner={banner} bet={bet} onDone={() => bannerDone.current?.()} />}</AnimatePresence>

      <AnimatePresence>
        {!ready && (
          <motion.div
            key="loading"
            className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_35%,#3a1670_0%,#14072e_70%)]"
            exit={{ opacity: 0, transition: { duration: 0.45 } }}
          >
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-muted">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Waking the monsters" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(82vw+120px)] max-sm:min-h-[380px]" />
      <AnimatePresence>{paytable && <PaytableModal bet={bet} thumbs={thumbs} onClose={() => setPaytable(false)} />}</AnimatePresence>
      <AnimatePresence>
        {buying && (
          <Modal onClose={() => setBuying(false)} title="Buy free spins" width={400}>
            <p className="text-[14px] text-muted">
              Go straight to {BUY_SPINS} free spins, where wilds eat every donut on the screen, for <span className="font-bold text-ink">{fmt(buyCost)}</span> coins, {BUY_PRICE}× your bet of {fmt(bet)}.
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

const pill = 'flex h-10 items-center gap-2 rounded-full bg-[#1d0f30]/90 px-4 ring-1 ring-white/10'

/** A number that counts up to its value. */
function Counter({ value, className = '' }: { value: number; className?: string }) {
  const [n, setN] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const c = animate(from.current, value, { duration: value > from.current ? 0.5 : 0, ease: 'easeOut', onUpdate: (v) => ((from.current = v), setN(v)) })
    return () => c.stop()
  }, [value])
  return <span className={`tnum ${className}`}>{fmt(n)}</span>
}

/** a little donut, for banners */
function DonutIcon({ className = '', color = '#ff8ad0' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="17" fill="#e9a656" stroke="#1d0f30" strokeWidth="2.5" />
      <path d="M5.5 18c2-1.5 3 1 5-.5s2.5-3 5-2.5 3 2 5 1 3-3 5-2 2.5 2.5 4.5 2 3.5-1 4.5 0c-1-7-7-12.5-14.5-12.5S6.5 10 5.5 18Z" fill={color} />
      <circle cx="20" cy="20" r="6" fill="#1d0f30" />
      <circle cx="20" cy="20" r="4.3" fill="#3a1670" />
      {[
        [11, 11, '#fff'],
        [27, 9, '#ffe14d'],
        [31, 15, '#3dd9ff'],
        [15, 7, '#2ee87f'],
      ].map(([x, y, c], i) => (
        <rect key={i} x={x as number} y={y as number} width="4" height="1.6" rx=".8" fill={c as string} transform={`rotate(${i * 50} ${x} ${y})`} />
      ))}
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
  const green = banner.kind === 'intro' || banner.kind === 'level'
  if (banner.kind === 'intro') {
    title = (
      <>
        <div className="text-[64px] font-black leading-none sm:text-[84px]">{banner.spins}</div>
        <div className="mt-1 text-[22px] font-black uppercase tracking-tight sm:text-[28px]">Free spins</div>
      </>
    )
    sub = 'Every wild eats every donut on the screen'
  } else if (banner.kind === 'level') {
    title = (
      <>
        <div className="text-[30px] font-black uppercase leading-none sm:text-[40px]">+{banner.spins} free spins</div>
        <div className="mt-2 text-[44px] font-black leading-none sm:text-[56px]">{banner.mult}× donuts</div>
      </>
    )
  } else {
    const head = banner.kind === 'big' ? tier(banner.mult) : banner.kind === 'max' ? 'Max win' : 'Total win'
    title = <div className="text-[28px] font-black uppercase leading-none tracking-tight sm:text-[40px]">{head}</div>
    sub = banner.kind === 'end' ? `${banner.spins} free spins · ${fmt(banner.amount / bet, 2)}×` : banner.kind === 'big' ? `${fmt(banner.mult, 2)}× your bet` : `${fmt(MAX_WIN, 0)}× your bet`
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-[#14072e]/65 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      onClick={onDone}
    >
      <motion.div
        initial={{ scale: 0.4, y: 40, rotate: -6 }}
        animate={{ scale: 1, y: 0, rotate: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="relative flex flex-col items-center text-center"
      >
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 opacity-60"
          animate={{ rotate: 360 }}
          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
        >
          <div
            className={`h-full w-full rounded-full ${
              green ? 'bg-[repeating-conic-gradient(from_0deg,rgba(46,232,127,.34)_0deg_8deg,transparent_8deg_24deg)]' : 'bg-[repeating-conic-gradient(from_0deg,rgba(255,200,61,.32)_0deg_8deg,transparent_8deg_24deg)]'
            } [mask-image:radial-gradient(circle,black_20%,transparent_68%)]`}
          />
        </motion.div>
        {green && (
          <div className="relative mb-2 flex items-end gap-1">
            <motion.div animate={{ rotate: [-12, 12, -12] }} transition={{ duration: 1.2, repeat: Infinity }}>
              <DonutIcon className="h-9 w-9" color="#59c8ff" />
            </motion.div>
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 0.8, repeat: Infinity }}>
              <DonutIcon className="h-12 w-12" />
            </motion.div>
            <motion.div animate={{ rotate: [12, -12, 12] }} transition={{ duration: 1.2, repeat: Infinity }}>
              <DonutIcon className="h-9 w-9" color="#b77bff" />
            </motion.div>
          </div>
        )}
        <div
          className={`relative bg-clip-text text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] ${
            green ? 'bg-[linear-gradient(180deg,#ffffff_0%,#b8ffd6_45%,#2ee87f_100%)]' : 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]'
          }`}
        >
          {title}
        </div>
        {amount != null && (
          <div className="tnum relative mt-3 flex items-center gap-2 text-[34px] font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,.5)] sm:text-[44px]">
            {fmt(n)} <Coin size={34} />
          </div>
        )}
        {sub && <div className="relative mt-2 text-[14px] font-bold text-white/85">{sub}</div>}
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
    <Modal onClose={onClose} title="Paytable" width={580}>
      <p className="text-[13px] text-muted">
        1,024 ways: three or more of a symbol on neighbouring reels, starting from the left, win. Each line below pays per way, and the ways multiply (two on a reel count twice). Amounts are for
        your bet of {fmt(bet)}.
      </p>
      <div className="mt-3 grid grid-cols-[1fr_repeat(3,64px)] items-center gap-x-2 px-2 text-center text-[11px] font-bold uppercase tracking-wider text-dim">
        <span className="text-left">Symbol</span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
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
      <div className="mt-3 flex items-start gap-3 rounded-lg bg-[#2ee87f]/10 px-3 py-3 ring-1 ring-[#2ee87f]/25">
        {pic('wild', 52)}
        <div className="text-[13px] text-muted">
          <span className="font-bold text-ink">Chomper wilds</span> land on reels 2 to 5 and stand in for every paying symbol. Whenever donuts are on the screen, each wild eats all of them and pays their
          values. Now and then a hungry wild sneaks in when donuts land without one.
        </div>
      </div>
      <div className="mt-2 flex items-start gap-3 rounded-lg bg-[#ff7ac8]/10 px-3 py-3 ring-1 ring-[#ff7ac8]/25">
        {pic('donut', 52)}
        <div className="text-[13px] text-muted">
          <span className="font-bold text-ink">Donuts</span> show what they are worth. The icing colour hints at the size: <span style={{ color: donutColor(2) }}>pink</span>,{' '}
          <span style={{ color: donutColor(10) }}>blue</span>, <span style={{ color: donutColor(20) }}>violet</span>, <span style={{ color: donutColor(50) }}>red</span> and{' '}
          <span style={{ color: donutColor(100) }}>gold</span>. They land far more often in free spins, where they are worth up to 250× the bet.
        </div>
      </div>
      <div className="mt-2 flex items-start gap-3 rounded-lg bg-gold/10 px-3 py-3 ring-1 ring-gold/25">
        {pic('egg', 52)}
        <div className="text-[13px] text-muted">
          <span className="font-bold text-ink">Monster eggs</span> anywhere: 3, 4 or 5 pay {EGG_PAYS.map(money).join(', ')} and hatch {EGG_SPINS.join(', ')} free spins. In free spins every wild that lands
          fills the meter; each {WILDS_PER_LEVEL} wilds add {LEVEL_SPINS} spins and raise the donut multiplier to {LEVEL_MULTS.slice(1).map((x) => `${x}×`).join(', then ')}.
        </div>
      </div>
      <p className="mt-3 text-[12px] text-dim">
        Buy free spins for {BUY_PRICE}× the bet. A round pays at most {fmt(MAX_WIN, 0)}× the bet. Return to player about 96% over the long run.
      </p>
    </Modal>
  )
}
