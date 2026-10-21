import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { ActionButton, BetInput, GameShell, useStake } from '../../components/ui'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { FEE, LIQ, MOODS, multipleAt, type CloseReason, type Side } from './rules'
import { Desk, MAX_OPEN, noticeOf, useView, type Closed, type DeskEvent } from './desk'
import { Chart } from './Chart'
import { BigWin, ResultPill, TIER_HOLD, TIER_MS, tierOf } from './Celebrate'
import { AutoClose, LeveragePicker, TradeButtons, TradeList } from './Controls'
import { HowItWorks } from './Info'
import { fmtPrice } from './levels'
import { Positions, type Ghost } from './Positions'
import { marketSfx } from './sound'
import { loadPrefs, savePrefs, type Notice, type Prefs } from './storage'
import { MoodBanner, Ticker } from './Ticker'

/*
  Market Rush. A live price chart (BOJE/USD) ticks ten times a second; the player stakes coins on it going Up or Down,
  with leverage, and closes whenever they like (or at a take profit or stop loss), unless the price runs far enough
  against them first and they are liquidated. Several positions can be open at once, each settled on its own.

  The money all happens in the desk (desk.ts): opening takes the stake, every close (by hand, by a tick, by leaving)
  pays exactly once, and storage always holds the price on screen and what is owed (storage.ts says how a page that
  dies, or a second tab, is handled). This page is the screen round it: the ticker, the chart (Chart.tsx), the cards
  of the open positions, the order buttons and settings, and the moments a close or a change of mood brings.

  On a phone the stage (ticker, chart, cards) sits on top and the order buttons lead the panel under it.

  Dev hook (dev builds only): window.__marketForce = { jump?, drift?, ticks?, mood? } bends the next ticks (desk.ts).
*/

const STAMP: Record<CloseReason, string> = { manual: 'Closed', takeProfit: 'Take profit', stopLoss: 'Stop loss', liquidated: 'Liquidated', cap: 'Max win', left: 'Closed' }
const sideWord = (s: Side) => (s === 'up' ? 'Up' : 'Down')
const plural = (n: number) => `${n} position${n === 1 ? '' : 's'}`
/** a position close to its liquidation line: less than this share of its room left */
const DANGER = 0.2

export default function MarketRush() {
  const stake = useStake()
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)
  const pushToast = useWallet((s) => s.pushToast)
  const [desk] = useState(() => new Desk(uid))
  const role = useView((s) => s.role)
  const count = useView((s) => s.positions.length)

  const [prefs, setPrefsState] = useState(loadPrefs)
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((x) => {
      const next = { ...x, ...p }
      savePrefs(next)
      return next
    })
  }, [])
  const [bet, setBet] = useState(10)
  const [info, setInfo] = useState(false)
  const [say, setSay] = useState('')
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [banner, setBanner] = useState<{ id: number; mood: number } | null>(null)
  const [pill, setPill] = useState<{ id: number; net: number; mult: number; liquidated: boolean; label: string } | null>(null)
  const [big, setBig] = useState<{ id: number; tier: number; amount: number; mult: number } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const quake = useAnimationControls()
  const timers = useRef<number[]>([])
  const seq = useRef(0)
  const later = (ms: number, fn: () => void) => void timers.current.push(window.setTimeout(fn, ms))

  const [stageRef, size] = useSize<HTMLDivElement>()
  const compact = size.w < 640
  const headH = compact ? 52 : 62
  const stripH = compact ? 90 : 104

  /* ---------------- what the desk tells us ---------------- */

  /** positions closed and paid: their cards turn into their results, and the moment plays */
  function onClosed(cs: readonly Closed[]) {
    const id = ++seq.current
    const ids = new Set(cs.map((c) => c.pos.id))
    setGhosts((g) => [...g.filter((x) => !ids.has(x.pos.id)), ...cs.map((c) => ({ pos: c.pos, reason: c.reason, payout: c.payout }))])
    later(1800, () => setGhosts((g) => g.filter((x) => !ids.has(x.pos.id))))
    const staked = cs.reduce((a, c) => a + c.pos.stake, 0)
    const paid = cs.reduce((a, c) => a + c.payout, 0)
    const best = cs.reduce((a, c) => (c.payout / c.pos.stake > a.payout / a.pos.stake ? c : a))
    const bestMult = best.payout / best.pos.stake
    const liquidated = cs.every((c) => c.reason === 'liquidated')
    // the sound: the best of what happened
    if (liquidated) marketSfx.liquidated()
    else if (best.reason === 'cap') marketSfx.cap()
    else if (best.reason === 'takeProfit') marketSfx.takeProfit()
    else if (best.reason === 'stopLoss' && bestMult < 1) marketSfx.stopLoss()
    else marketSfx.close(bestMult)
    if (cs.some((c) => c.reason === 'liquidated')) {
      if (!liquidated) marketSfx.liquidated()
      void quake.start({ x: [0, -8, 7, -5, 3, -1, 0], y: [0, 3, -3, 2, -1, 0], transition: { duration: 0.45 } })
    }
    setPill({ id, net: paid - staked, mult: cs.length === 1 ? bestMult : paid / staked, liquidated, label: cs.length > 1 ? `${cs.length} closed` : STAMP[cs[0].reason] })
    later(2000, () => setPill((p) => (p?.id === id ? null : p)))
    const tier = tierOf(bestMult)
    if (tier) {
      setBig({ id, tier, amount: best.payout, mult: bestMult })
      later(250, () => marketSfx.bigWin(tier))
      later(TIER_MS[tier] + TIER_HOLD, () => setBig((b) => (b?.id === id ? null : b)))
    }
    setSay(
      cs
        .map((c) =>
          c.reason === 'liquidated'
            ? `${sideWord(c.pos.side)} ${c.pos.leverage}× liquidated.`
            : `${sideWord(c.pos.side)} ${c.pos.leverage}× ${STAMP[c.reason].toLowerCase()} at ${(c.payout / c.pos.stake).toFixed(2)}×: ${fmt(c.payout)} coins.`,
        )
        .join(' '),
    )
  }

  /** positions settled away from the screen (the market moved to another tab, a dead page's, the last visit's) */
  const announce = (title: string, n: Notice) => {
    if (n.payout > 0) pushToast({ kind: 'win', title, amount: n.payout })
    else pushToast({ kind: 'info', title: `${title}: nothing left to pay` })
  }

  const handle = (e: DeskEvent) => {
    if (e.kind === 'open') {
      marketSfx.open(e.pos.side)
      setSay(`Opened ${sideWord(e.pos.side)} at ${fmtPrice(e.pos.entry)}: ${fmt(e.pos.stake)} coins at ${e.pos.leverage}×.`)
    } else if (e.kind === 'close') onClosed(e.closed)
    else if (e.kind === 'mood') {
      const id = ++seq.current
      setBanner({ id, mood: e.to })
      later(2800, () => setBanner((b) => (b?.id === id ? null : b)))
      if (e.to === 2) marketSfx.wild()
      else if (e.to === 0) marketSfx.calm()
      else marketSfx.steady()
      setSay(e.to === 2 ? 'Volatility rising: the market turns Wild.' : `The market is ${MOODS[e.to].name} now.`)
    } else if (e.kind === 'lost') announce(`Market Rush moved to another tab: ${plural(e.closed.length)} closed at ${fmtPrice(e.closed[0].price)}`, noticeOf(e.closed))
    else if (e.kind === 'taken') pushToast({ kind: 'info', title: `${plural(e.count)} of yours were settled in another tab` })
    else if (e.kind === 'recovered') announce(`Your unfinished Market Rush ${plural(e.closed.length)} closed at ${fmtPrice(e.closed[0].price)}`, noticeOf(e.closed))
    else if (e.kind === 'notice') announce(`Your Market Rush ${plural(e.notice.count)} closed when you left`, e.notice)
  }
  const handleRef = useRef(handle)
  handleRef.current = handle

  useEffect(() => {
    desk.onEvent = (e) => handleRef.current(e)
    desk.start()
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      // leaving the page closes what is open at the price on screen, pays it, and says what it came to
      const closed = desk.stop()
      desk.onEvent = () => {}
      if (closed.length) {
        const n = noticeOf(closed)
        if (n.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your Market Rush ${plural(n.count)} closed as you left`, amount: n.payout })
        else useWallet.getState().pushToast({ kind: 'info', title: `Your Market Rush ${plural(n.count)} closed as you left: nothing left to pay` })
      }
    }
  }, [desk])

  // once sign-in has settled: last visit's notice, and a dead page's positions paid into the right wallet
  useEffect(() => {
    if (authStatus !== 'loading') desk.setReady()
  }, [authStatus, desk])

  // a quick warning beep while a position is close to its liquidation line
  useEffect(
    () =>
      useView.subscribe((s, was) => {
        if (s.tick === was.tick || !s.positions.length) return
        const line = LIQ + (1 - FEE - LIQ) * DANGER
        if (s.positions.some((p) => multipleAt(p, s.price) < line)) marketSfx.danger()
      }),
    [],
  )

  /* ---------------- orders ---------------- */

  const blocked = role === 'viewer' ? 'Open in another tab' : role === 'idle' ? 'Opening the market…' : count >= MAX_OPEN ? `${MAX_OPEN} open: close one first` : null

  function trade(side: Side) {
    if (blocked) {
      marketSfx.nope()
      if (count >= MAX_OPEN) pushToast({ kind: 'info', title: `Up to ${MAX_OPEN} positions at once: close one first` })
      return
    }
    desk.open({ side, stake: bet, leverage: prefs.leverage, takeProfit: prefs.tpOn ? prefs.tp : undefined, stopLoss: prefs.slOn ? prefs.sl : undefined }, stake)
  }
  const onClose = useCallback((id: string) => void desk.close(id), [desk])
  const onCloseAll = useCallback(() => void desk.closeEvery(), [desk])
  const onFocus = useCallback(
    (id: string | null) => {
      desk.hover = id
      setFocus(id)
    },
    [desk],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || info || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      // arrows inside a group of options (the leverage) belong to it, never an order
      if (k.startsWith('arrow') && el?.closest?.('[role=radiogroup],[role=group]')) return
      if (k === 'arrowup' || k === 'w') {
        e.preventDefault()
        if (!e.repeat) trade('up')
      } else if (k === 'arrowdown' || k === 's') {
        e.preventDefault()
        if (!e.repeat) trade('down')
      } else if (k === 'x' && !e.repeat) desk.closeEvery()
      else if (k === 'c' && !e.repeat) {
        const ps = desk.positions
        if (ps.length) desk.close(ps[ps.length - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const panel = (
    <>
      <BetInput value={bet} onChange={setBet} />
      <LeveragePicker value={prefs.leverage} onChange={(l) => setPrefs({ leverage: l })} />
      <AutoClose prefs={prefs} set={setPrefs} bet={bet} />
      <TradeList limit={compact ? 5 : 6} />
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold">
        <button onClick={() => (sfx.click(), setInfo(true))} className="text-muted transition hover:text-ink">
          How it works · the return
        </button>
        <span className="text-dim">Return 98%</span>
      </div>
      <div className="hidden text-[11px] font-semibold leading-relaxed text-dim lg:block [@media(max-height:780px)]:lg:hidden">Keys: ↑ or W opens Up, ↓ or S opens Down, C closes the newest, X closes all.</div>
      {/* the order buttons: first under the stage on a phone, at the foot of the panel (always in view) on a desktop */}
      <div className="max-lg:order-first lg:sticky lg:bottom-0 lg:z-10 lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_80%,transparent)] lg:px-4 lg:pb-4 lg:pt-3">
        <TradeButtons leverage={prefs.leverage} onTrade={trade} blocked={blocked} />
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_90%_70%_at_62%_8%,#10303a_0%,#0a1b24_52%,#071118_100%)]">
      <Ticker compact={compact} chart={prefs.chart} onChart={(c) => setPrefs({ chart: c })} onInfo={() => (sfx.click(), setInfo(true))} />
      <motion.div className="absolute inset-x-0" style={{ top: headH, bottom: stripH }} animate={quake}>
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(140,200,230,.07)_1px,transparent_1px)] [background-size:24px_24px]" />
        <Chart desk={desk} style={prefs.chart} compact={compact} />
        <AnimatePresence>{banner && <MoodBanner key={banner.id} mood={banner.mood} compact={compact} />}</AnimatePresence>
        <AnimatePresence>{pill && !big && <ResultPill key={pill.id} net={pill.net} mult={pill.mult} liquidated={pill.liquidated} label={pill.label} />}</AnimatePresence>
        <AnimatePresence>{big && <BigWin key={big.id} tier={big.tier} amount={big.amount} mult={big.mult} compact={compact} onDone={() => setBig(null)} />}</AnimatePresence>
        <AnimatePresence>
          {role === 'viewer' && (
            <motion.div key="viewer" className="absolute inset-0 z-30 flex items-center justify-center bg-[#06121a]/60 p-4 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="w-full max-w-[340px] rounded-2xl border border-line bg-panel/95 p-5 text-center shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)]">
                <div className="text-[16px] font-extrabold text-ink">Market Rush is open in another tab</div>
                <p className="mb-4 mt-1.5 text-[12.5px] font-semibold leading-snug text-muted">This tab is watching the same market. Trade here instead? Anything open in the other tab closes there at its current price.</p>
                <ActionButton onClick={() => (sfx.click(), desk.takeOver())}>Trade here</ActionButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <Positions ghosts={ghosts} compact={compact} focus={focus} onClose={onClose} onCloseAll={onCloseAll} onFocus={onFocus} bet={bet} leverage={prefs.leverage} />
      <div className="sr-only" aria-live="polite">
        {say}
      </div>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} />
      <AnimatePresence>{info && <HowItWorks onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}
