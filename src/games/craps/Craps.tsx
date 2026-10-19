import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, GameShell, Label, Segmented, Toggle } from '../../components/ui'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { Chip } from '../../art/Chip'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { Kbd } from '../blackjack/table'
import { RedDie } from './art'
import { Board } from './Board'
import { backs, layoutOf, spotOfBet, type Box, type Exit, type Layout, type Pile, type Spot } from './spots'
import { CoachMark, Celebration, NetPill, PointReadout, RollStrip, StickBubble, TIER_COUNT, tierOf } from './Hud'
import { Keeper } from './keeper'
import { Paytable, type PaytableTab } from './Paytable'
import { ALL_KEYS, betName, isHard, kindOf, onTable, rollDice, rollDie, totalOf, type BetKey, type Bets, type Num, type Roll, type RollResult, type Table } from './rules'
import {
  clearNotice,
  loadChip,
  loadCoach,
  loadHistory,
  loadTold,
  loadTurbo,
  loadView,
  saveChip,
  saveCoach,
  saveHistory,
  saveNotice,
  saveTold,
  saveTurbo,
  saveView,
  takeNotice,
  type Coach,
  type CoachKind,
  type PastRoll,
  type View,
} from './storage'
import { atLimit, rollWords, stickCall, whyNot, whyStays, type Call } from './words'
import type { Beat, CrapsScene, FrameBox } from './scene'

/*
  Craps. The 3D table runs along the top of the stage (scene.ts: the throw, the camera, the puck); the betting board
  sits under it (Board.tsx, drawn from spots.ts): the classic wide layout on a desktop, two pages the phone's width on
  a phone. Every coin goes through the keeper (keeper.ts), which saves the table after each change, so the chips on
  it are still there on the next visit.

  A roll: Roll draws the dice and the keeper works the roll out and saves it, before anything moves. The board slides
  away below the stage so the table fills it, the shooter throws (the stick first brings the dice back if they still
  lie where they landed), the camera rides the throw and leans over the dice; as they come to rest the stickman sings
  the call, the roll is paid (once: keeper.settle) and the puck moves. Then the board comes back for the payout:
  winning spots glow, the dealer sweeps the losing chips to the house, pays the winners beside their stakes (a place
  bet's winnings slide back to the player while its stake stays up), come bets travel onto their numbers, and the
  roll's total win or loss shows. Big wins and the Fire Bet get a celebration. Betting reopens with the last roll
  still on the felt; a moment later the stick brings the dice home, so the next throw starts at once.

  Nothing on the table is ever out of sight: the Basic view, which leaves the props and Come off the board, lists
  any of those bets still up in a pill over the board (a tap shows every bet), and during the payout the screen
  shows what the board shows (the panel's total follows the chips; the OFF marks and the readout wait for betting).

  Leaving mid-roll pays the roll on the way out (the next visit says what it came to); a roll left unpaid by a page
  that died is paid on the next visit. Only one tab plays a player's table at a time (a Web Lock): another tab says
  so and waits for it.

  Keys: Space rolls, 1-8 pick a chip, Z undoes the last chip, C clears what can come down, R rebets the last
  come-out's bets, W turns Working on or off.

  Dev hook (dev builds only): window.__crapsForce = [a, b] (the next roll's dice), or 'seven', 'hard8', 'point' (a
  6); window.__craps is the scene, window.__crapsKeeper the keeper.
*/

const CHIPS = [1, 5, 10, 25, 100, 500, 1000, 5000]
const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
/** how long after betting reopens the stick brings the dice home (ms): the last roll stays on show a moment first */
const SWEEP_AFTER = 1600
/** the smallest comfortable chip button on a phone's rack (px): narrower than that, the rack scrolls instead */
const MIN_CHIP_BTN = 34
/** the room a big win's lettering takes at the top of the table (the dice are framed below it) */
const CELEBRATION_ROOM = { tall: 96, wide: 150 }
const MemoBoard = memo(Board)
const MemoToggle = memo(Toggle)

type Phase = 'bet' | 'roll' | 'result'
type Page = 'main' | 'props'

/** the roll in play, or the one being shown */
interface Play {
  id: number
  t: number
  r: RollResult
  landed: boolean
  /** it was paid as the page began to leave (the page stayed) */
  paidOnHide: boolean
  logged: boolean
}

/** dev builds only: the dice the dev hook asks for, else the drawn ones */
function nextDice(): Roll {
  const drawn = rollDice(rand)
  if (!import.meta.env.DEV) return drawn
  const w = window as unknown as { __crapsForce?: unknown }
  const f = w.__crapsForce
  delete w.__crapsForce
  const die = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6
  if (Array.isArray(f) && f.length === 2 && die(f[0]) && die(f[1])) return [f[0], f[1]] as unknown as Roll
  if (f === 'seven') return [3, 4]
  if (f === 'hard8') return [4, 4]
  if (f === 'point') return [2, 4]
  return drawn
}

let pileSeq = 0
/** the stakes on show for `bets`, keeping the piles already there (by bet) so they don't drop in again */
function syncPiles(prev: readonly Pile[], bets: Bets): Pile[] {
  const out: Pile[] = []
  for (const k of ALL_KEYS) {
    const v = bets[k]
    if (!v) continue
    const old = prev.find((p) => !p.win && p.key === k)
    out.push(old ? (old.amount === v ? old : { ...old, amount: v }) : { id: `${k}.${++pileSeq}`, key: k, amount: v })
  }
  return out
}

/** the spots that won on a roll: what the dice say (the Field, the props, a hardway, the line) and the player's winners */
function litSpots(r: RollResult): Set<Spot> {
  const s = new Set<Spot>()
  const t = r.total
  if ([2, 3, 4, 9, 10, 11, 12].includes(t)) s.add('field')
  if (t === 7) s.add('any7')
  if (t === 2 || t === 3 || t === 12) s.add('anyCraps')
  if (t === 2) s.add('aces')
  if (t === 3) s.add('aceDeuce')
  if (t === 11) s.add('yo')
  if (t === 12) s.add('boxcars')
  if (isHard(r.dice) && (t === 4 || t === 6 || t === 8 || t === 10)) s.add(`hard${t}`)
  if (r.event === 'natural' || r.event === 'point-made') s.add('pass')
  if (r.event === 'seven-out' || (r.event === 'craps' && t !== 12)) s.add('dontPass')
  for (const x of r.results) if (x.outcome === 'win' || x.outcome === 'win-stays') s.add(spotOfBet(x.key))
  return s
}

/** a roll settled away from the table (as the page went, or on the next visit), in a toast: what it came to */
function tellRoll(r: { dice: Roll; event: RollResult['event']; point: Num | null; returned: number; wagered: number }, who: string, how: string) {
  const title = `${who} (${rollWords(r.dice, r.event, r.point)}) ${how}`
  const n = round2(r.returned - r.wagered)
  const push = useWallet.getState().pushToast
  if (n > 0) push({ kind: 'win', title: `${title}: you won`, amount: n })
  else push({ kind: 'info', title: `${title}${r.wagered <= 0 ? ': nothing was decided' : n < 0 ? `: −${fmt(-n)}` : ': even'}` })
}

/** the history with a roll in it (once: one already there is replaced), the newest last */
const withRoll = (h: readonly PastRoll[], p: PastRoll) => [...h.filter((x) => x.t !== p.t), p].slice(-40)
const pastOf = (r: RollResult, t: number): PastRoll => ({ t, dice: r.dice, event: r.event, point: r.before.point })
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches
const coins = (v: number) => fmt(v, v % 1 ? 2 : 0)
const netOf = (r: RollResult) => round2(r.returned - r.wagered)

/**
 * Where everything sits on a stage of W × H. A desktop (or tablet): the wide board along the bottom (over the chip
 * bar when the side panel is below the stage) and the table framed above it, under a row for the last rolls and the
 * point; the frame's foot is the board's rail, where the 3D view's own foot is cut. A phone: the same, with the board
 * a page at a time and a row of page tabs over it. While the dice fly the board slides away below the stage and the
 * table's frame takes the whole stage down to the chip bar.
 */
function geometry(W: number, H: number, bar: boolean, all: boolean, page: Page) {
  const tall = W < 620
  const pad = tall ? 6 : 12
  const barH = bar ? 60 : 0
  const hud = tall ? 38 : 50
  if (!tall) {
    const layout = layoutOf('wide', all)
    let bw = Math.min(W - pad * 2 - 12, all ? 1120 : 880)
    let bh = (bw * layout.vh) / layout.vw
    const maxBh = (H - barH) * 0.5
    if (bh > maxBh) {
      bh = maxBh
      bw = (bh * layout.vw) / layout.vh
    }
    const top = H - pad - barH - 6 - bh
    const board: Box = { x: (W - bw) / 2, y: top, w: bw, h: bh }
    return {
      tall,
      layout,
      pad,
      barH,
      hud,
      board,
      tabsY: 0,
      // (down to the top of the board's rail, 9 px over its box)
      frameBet: { x: pad, y: hud, w: W - pad * 2, h: Math.max(120, top - 9 - hud) },
      frameRoll: { x: pad, y: hud, w: W - pad * 2, h: Math.max(120, H - pad - barH - hud) },
    }
  }
  const main = layoutOf('main', all)
  const layout = page === 'props' && all ? layoutOf('props', true) : main
  // the page tabs (with every bet): a row over the board; in the Basic view there is one page and no row
  const tabsH = all ? 38 : 0
  const bw = W - pad * 2 - 6
  // the board's box is the main page's (the props page is fitted inside it)
  const bh = Math.min((bw * main.vh) / main.vw, (H - barH) * 0.58)
  const top = H - pad - barH - 3 - bh
  const tabsY = top - tabsH - (all ? 4 : 0)
  return {
    tall,
    layout,
    pad,
    barH,
    hud,
    board: { x: (W - bw) / 2, y: top, w: bw, h: bh },
    tabsY,
    frameBet: { x: pad, y: hud, w: W - pad * 2, h: Math.max(100, tabsY - 4 - hud) },
    frameRoll: { x: pad, y: hud, w: W - pad * 2, h: Math.max(100, H - pad - barH - hud) },
  }
}

export default function Craps() {
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const authStatus = useAuth((s) => s.status)
  // the player this page plays for: App starts the page over when that changes
  const [owner] = useState(() => useAuth.getState().uid ?? 'guest')
  const [keeper] = useState(() => new Keeper(owner))

  const [table, setTableState] = useState<Table>(keeper.table)
  const tableRef = useRef(table)
  const [opened, setOpened] = useState(false)
  // whether this tab holds the player's table (see the lock below), and whether another tab has it
  const [held, setHeld] = useState(false)
  const [elsewhere, setElsewhere] = useState(false)
  const [hist, setHist] = useState<PastRoll[]>(() => loadHistory(owner))
  const histRef = useRef(hist)
  const [chip, setChipState] = useState(() => loadChip(CHIPS, 10))
  const [view, setViewState] = useState<View>(loadView)
  const [page, setPage] = useState<Page>('main')
  const [turbo, setTurboState] = useState(loadTurbo)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const [phase, setPhaseState] = useState<Phase>('bet')
  // the phase as of now, for the money path: two presses handled before React re-renders must not roll twice
  const phaseRef = useRef<Phase>('bet')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const [piles, setPiles] = useState<Pile[]>([])
  const [exits, setExits] = useState<Record<string, Exit>>({})
  const [puck, setPuckState] = useState<Num | null>(null)
  // the shooter's rolls as the readout shows them: they change with the puck, a moment after the dice land
  const [shooterRolls, setShooterRolls] = useState(0)
  const [firePts, setFirePts] = useState<Num[]>([])
  const [lit, setLit] = useState<ReadonlySet<Spot> | null>(null)
  const [rolled, setRolled] = useState<number | null>(null)
  const [call, setCall] = useState<{ id: number; call: Call } | null>(null)
  const [net, setNet] = useState<{ id: number; net: number } | null>(null)
  const [celebrate, setCelebrate] = useState<{ id: number; tier: number; fire: number; amount: number } | null>(null)
  const [lastRoll, setLastRoll] = useState<{ dice: Roll; event: RollResult['event']; net: number; decided: boolean } | null>(null)
  const [undo, setUndo] = useState<{ key: BetKey; amount: number }[]>([])
  const [info, setInfo] = useState<PaytableTab | null>(null)
  const [rollView, setRollView] = useState(false)
  const [shake, setShake] = useState<{ key: BetKey; n: number } | null>(null)
  const [coach, setCoachState] = useState<Coach>(loadCoach)
  const [tipOpen, setTipOpen] = useState(false)
  const [tell, setTell] = useState<{ key: BetKey; n: number } | null>(null)
  const [told] = useState(loadTold)
  const [say, setSay] = useState('')
  const [flat, setFlat] = useState<{ dice: Roll | null; rolling: boolean }>({ dice: hist.length ? hist[hist.length - 1].dice : null, rolling: false })
  const [stillThere, setStillThere] = useState(0)
  const [touch] = useState(isTouch)

  const setTable = (t: Table) => {
    tableRef.current = t
    setTableState(t)
  }
  const setChip = (v: number) => {
    setChipState(v)
    saveChip(v)
  }
  const setTurbo = useCallback((on: boolean) => {
    setTurboState(on)
    saveTurbo(on)
  }, [])
  const setView = (v: View) => {
    setViewState(v)
    saveView(v)
    if (v === 'basic') setPage('main')
  }
  const setCoach = (c: Coach) => {
    setCoachState(c)
    saveCoach(c)
  }

  const [stageRef, size] = useSize<HTMLDivElement>()
  // below the lg breakpoint the side panel sits under the stage, so the chips and Roll move onto the stage
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = matchMedia('(min-width: 1024px)')
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const all = view === 'all'
  const G = geometry(size.w, size.h, !wide, all, page)
  const geo = useRef(G)
  geo.current = G

  /* ---------------- the scene ---------------- */

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CrapsScene | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const readyRef = useRef(false)
  const failedRef = useRef(false)

  /* the roll's bookkeeping (the money section below works it) */
  const run = useRef(0)
  const alive = useRef(true)
  const timers = useRef<number[]>([])
  const play = useRef<Play | null>(null)

  const celebrating = !!celebrate
  const room = G.tall ? CELEBRATION_ROOM.tall : CELEBRATION_ROOM.wide
  const F = rollView ? G.frameRoll : G.frameBet
  const frame: FrameBox = celebrating && F.h - room > 140 ? { ...F, y: F.y + room, h: F.h - room } : F
  const frameRef = useRef(frame)
  frameRef.current = frame

  useEffect(() => {
    let on = true
    const host = hostRef.current!
    let sc: CrapsScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ CrapsScene }) => {
        if (!on) return
        setProgress(0.08)
        sc = new CrapsScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __craps?: CrapsScene }).__craps = sc
        sc.setTurbo(turboRef.current)
        sc.onProgress = (p) => on && setProgress(0.08 + p * 0.92)
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          sc!.setFrame(frameRef.current)
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        // the dice lie as the last roll left them, the puck where the table has it
        const h = histRef.current
        if (h.length) sc.setRest(h[h.length - 1].dice)
        sc.setPuck(tableRef.current.point, false)
        return sc.ready.then(() => {
          if (!on) return
          readyRef.current = true
          setReady(true)
        })
      })
      .catch(() => {
        if (!on) return
        failedRef.current = true
        setFailed(true)
      })
    return () => {
      on = false
      readyRef.current = false
      ro?.disconnect()
      if (import.meta.env.DEV) {
        const w = window as unknown as { __craps?: CrapsScene }
        if (w.__craps === sc) delete w.__craps
      }
      sc?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo, ready])
  // the frame glides when the stage rearranges itself (the board stepping back), and cuts when the stage is resized
  const stageKey = `${size.w}x${size.h}x${G.tall}x${all}`
  const lastStage = useRef(stageKey)
  useEffect(() => {
    const resized = lastStage.current !== stageKey
    lastStage.current = stageKey
    sceneRef.current?.setFrame(frameRef.current, !resized)
  }, [frame.x, frame.y, frame.w, frame.h, stageKey, ready])

  /* ---------------- the table, one tab at a time ---------------- */

  // One tab at a time plays a player's table: a second one would show (and bet on) a table the first is changing. The
  // page holds the player's lock while it is open (a tab that closes or dies lets go of it), and the table opens only
  // once it has it.
  useEffect(() => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      setHeld(true)
      return
    }
    const quit = new AbortController()
    let gone = false
    let release = () => {}
    // a moment's wait is this page starting over (its old lock on its way out); any longer, another tab has it
    const slow = window.setTimeout(() => setElsewhere(true), 1500)
    locks
      .request(`${keeper.key}.lock`, { signal: quit.signal }, async () => {
        if (gone) return
        // Tabs' wallets don't follow each other: the tab that had the table may have staked and been paid since this
        // page read the wallet, and the table it leaves was staked from that newer balance. Pick up what is stored
        // before the table opens, or this tab's first chip would write its old balance over all of it.
        await useWallet.persist.rehydrate()
        if (gone) return
        return new Promise<void>((done) => {
          release = done
          clearTimeout(slow)
          setElsewhere(false)
          setHeld(true)
        })
      })
      .catch(() => {
        // given up because the page went first; or locks refused here (a page with no origin, say): play without one
        if (gone) return
        clearTimeout(slow)
        setHeld(true)
      })
    return () => {
      gone = true
      clearTimeout(slow)
      quit.abort()
      release()
    }
  }, [keeper])

  /** puts a roll in the history strip (and in storage), once */
  const logRoll = (p: PastRoll) => {
    const next = withRoll(histRef.current, p)
    histRef.current = next
    saveHistory(owner, next)
    if (alive.current) setHist(next)
  }

  // Once the player's wallet has loaded and this tab holds the table: the table opens as it was left. A roll a page
  // left unpaid is paid now, and one paid as the page was left is announced.
  useEffect(() => {
    if (authStatus === 'loading' || !held || keeper.opened) return
    const n = takeNotice(owner)
    const o = keeper.start()
    if (!o) return
    const t = keeper.table
    setTable(t)
    setPiles(syncPiles([], t.bets))
    setPuckState(t.point)
    setShooterRolls(t.shooter.rolls)
    setFirePts(t.shooter.points)
    sceneRef.current?.setPuck(t.point, false)
    setOpened(true)
    if (n) tellRoll(n, 'Your last craps roll', 'was settled as you left')
    for (const r of o.recovered) {
      const p = pastOf(r, Date.now())
      logRoll(p)
      tellRoll({ ...r, point: r.before.point }, 'Your unfinished craps roll', 'was settled now')
      setLastRoll({ dice: r.dice, event: r.event, net: netOf(r), decided: r.wagered > 0 })
      setFlat({ dice: r.dice, rolling: false })
      sceneRef.current?.setRest(r.dice)
    }
    if (o.refund > 0) pushToast({ kind: 'win', title: 'Chips from your guest table came back to you', amount: o.refund })
    if (!o.recovered.length && onTable(t) > 0) setStillThere((x) => x + 1)
    // logRoll only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, held, keeper])

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __crapsKeeper?: Keeper }).__crapsKeeper = keeper
    return () => {
      if (import.meta.env.DEV) {
        const w = window as unknown as { __crapsKeeper?: Keeper }
        if (w.__crapsKeeper === keeper) delete w.__crapsKeeper
      }
    }
  }, [keeper])

  /* ---------------- money: leaving mid-roll ---------------- */

  useEffect(() => {
    alive.current = true
    // reloading, closing the tab or going to another site mid-roll pays it on the way out; the next visit says so
    const onHide = () => {
      const r = keeper.settle()
      if (!r) return
      const p = play.current
      if (p && !p.landed) p.paidOnHide = true
      saveNotice(owner, { dice: r.dice, event: r.event, point: r.before.point, returned: r.returned, wagered: r.wagered })
      // into the stored history now (the page may be going); on screen when its dice land (the page may stay)
      if (p && !p.logged) saveHistory(owner, withRoll(histRef.current, pastOf(r, p.t)))
    }
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      alive.current = false
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
      timers.current.forEach(clearTimeout)
      timers.current = []
      // leaving the page mid-roll pays the roll at once, and says what it came to
      const r = keeper.settle()
      const p = play.current
      if (p && !p.logged) {
        p.logged = true
        logRoll(pastOf(p.r, p.t))
      }
      if (r) tellRoll({ ...r, point: r.before.point }, 'Your craps roll', 'was settled as you left')
    }
    // logRoll only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keeper])

  /* ---------------- the roll ---------------- */

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const wait = (ms: number) => new Promise<void>((r) => later(ms, r))
  const live = (id: number) => alive.current && run.current === id
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const refuse = (key: BetKey | null, why: string) => {
    if (key) setShake((s) => ({ key, n: (s?.n ?? 0) + 1 }))
    sfx.craps.nope()
    pushToast({ kind: 'info', title: why })
  }

  /** the board shows the table as it stands */
  const sync = () => {
    setTable(keeper.table)
    setPiles((p) => syncPiles(p, keeper.table.bets))
  }

  async function roll() {
    if (phaseRef.current === 'roll') return
    if (phaseRef.current === 'result') finishShow()
    if (!held) return refuse(null, 'Craps is open in another tab')
    if (!keeper.opened || (!readyRef.current && !failedRef.current)) return
    if (!onTable(keeper.table)) return refuse(null, useWallet.getState().balance < 1 ? NO_COINS : 'Place a bet to roll: start with the Pass Line')
    const dice = nextDice()
    // the roll is worked out and saved before anything moves, so leaving mid-roll can't change or lose it
    const r = keeper.roll(dice)
    if (!r) return
    const id = ++run.current
    clearTimers()
    const t = keeper.pending?.t ?? Date.now()
    play.current = { id, t, r, landed: false, paidOnHide: false, logged: false }
    setPhase('roll')
    setUndo([])
    setExits({})
    setCall(null)
    setNet(null)
    setLit(null)
    setRolled(null)
    setCelebrate(null)
    setStillThere(0)
    setRollView(true)
    setSay(`Rolling. ${keeper.table.point ? `The point is ${keeper.table.point}.` : 'Come-out roll.'}`)
    const T = turboRef.current
    const sc = readyRef.current ? sceneRef.current : null
    if (sc) {
      const beat: Beat = isHard(dice) ? 'hard' : r.event === 'seven-out' ? 'seven-out' : null
      try {
        await sc.roll(
          dice,
          {
            collect: () => sfx.craps.collect(),
            shake: () => sfx.craps.shake(T ? 0.2 : 0.42),
            release: () => sfx.craps.release(),
            hit: (h, k) => sfx.craps.hit(h.on, k),
            readable: () => sfx.craps.settle(),
            landed: () => land(id),
          },
          beat,
        )
      } catch {
        // never expected: a scene error must not lock the game
      }
    } else {
      setFlat({ dice, rolling: true })
      sfx.craps.shake(T ? 0.2 : 0.42)
      await wait(T ? 650 : 1300)
      if (!live(id)) return
      setFlat({ dice, rolling: false })
      sfx.craps.settle()
    }
    if (!live(id)) return
    land(id)
  }

  /**
   * The dice are at rest: the call, the roll paid (once), the puck, the history; then the payout plays out on the
   * board and betting reopens.
   */
  function land(id: number) {
    const p = play.current
    if (!p || p.id !== id || p.landed || !alive.current) return
    p.landed = true
    const r = p.r
    keeper.settle()
    // a roll paid as the page began to leave, on a page that stayed: the player sees it now, no notice needed
    if (p.paidOnHide) clearNotice(owner)
    if (!p.logged) {
      p.logged = true
      logRoll(pastOf(r, p.t))
    }
    setTable(keeper.table)
    const T = turboRef.current ? 0.55 : 1
    const n = netOf(r)
    setPhase('result')
    setCall({ id, call: stickCall(r) })
    sfx.craps.call(r.event, r.total, isHard(r.dice))
    setRolled(r.total)
    setSay(`${stickCall(r).big} ${rollWords(r.dice, r.event, r.before.point)}.`)
    later(260 * T, () => {
      setShooterRolls(r.after.shooter.rolls)
      if (r.before.point === r.after.point) return
      setPuckState(r.after.point)
      sceneRef.current?.setPuck(r.after.point)
      sfx.craps.puck(r.after.point !== null)
    })
    // a point made lights its Fire Bet square; after a seven-out the squares stay lit through the payout
    const madeNow = r.after.shooter.points.length > r.before.shooter.points.length
    setFirePts(r.event === 'seven-out' ? r.before.shooter.points : r.after.shooter.points)
    if (madeNow) later(380 * T, () => sfx.craps.fire(r.after.shooter.points.length))

    // the board comes back, then the payout plays out on it
    const back = 560 * T
    later(back, () => setRollView(false))
    const at = (ms: number, fn: () => void) => later(back + ms * T, () => live(id) && phaseRef.current === 'result' && fn())
    at(80, () => setLit(litSpots(r)))

    const lost = r.results.filter((x) => x.outcome === 'lose')
    const pushed = r.results.filter((x) => x.outcome === 'push')
    const won = r.results.filter((x) => x.outcome === 'win' || x.outcome === 'win-stays')
    const moved = r.results.filter((x) => x.outcome === 'move')
    const pileOf = (key: BetKey, ps: readonly Pile[]) => ps.find((q) => !q.win && q.key === key)
    const leave = (keys: readonly BetKey[], to: Exit, wins = false) =>
      setPiles((ps) => {
        const gone = ps.filter((q) => keys.includes(q.key) && (wins ? q.win : true))
        if (!gone.length) return ps
        setExits((e) => ({ ...e, ...Object.fromEntries(gone.map((q) => [q.id, to])) }))
        return ps.filter((q) => !gone.includes(q))
      })

    if (lost.length || pushed.length)
      at(300, () => {
        leave(
          lost.map((x) => x.key),
          'house',
        )
        leave(
          pushed.map((x) => x.key),
          'player',
        )
        if (lost.length) sfx.craps.sweep()
      })
    if (won.length)
      at(720, () => {
        setPiles((ps) => [...ps, ...won.filter((x) => pileOf(x.key, ps)).map((x): Pile => ({ id: `${x.key}+${id}`, key: x.key, amount: round2(x.ret - x.stake), win: true }))])
        sfx.craps.pay()
      })
    // the roll's total: shown with the payout (a roll that decided nothing shows nothing), and in the panel then
    at(r.wagered > 0 ? (won.length ? 760 : 360) : 80, () => {
      if (r.wagered > 0) setNet({ id, net: n })
      showLast(r)
    })
    // the winners go back to the player: a decided bet with its winnings, a place bet's winnings alone
    const collectAt = 1500
    if (won.length)
      at(collectAt, () => {
        leave(
          won.filter((x) => x.outcome === 'win').map((x) => x.key),
          'player',
        )
        leave(
          won.filter((x) => x.outcome === 'win-stays').map((x) => x.key),
          'player',
          true,
        )
        sfx.coin()
      })
    // come bets travel onto their numbers (after a come bet already there has been paid off it)
    if (moved.length)
      at(won.some((x) => moved.some((m) => m.to === x.key)) ? collectAt + 120 : 360, () => {
        setPiles((ps) => {
          const from = ps.filter((q) => !q.win && moved.some((m) => m.key === q.key))
          setExits((e) => ({ ...e, ...Object.fromEntries(from.map((q) => [q.id, 'moved' as Exit])) }))
          const arrived = moved.map((m): Pile => ({ id: `${m.to}.${++pileSeq}`, key: m.to!, amount: m.stake, from: m.key }))
          return [...ps.filter((q) => !from.includes(q)), ...arrived]
        })
        sfx.craps.chip()
      })

    // a big win: its celebration, which holds the table until it ends (or a tap closes it)
    const fireWin = r.results.find((x) => x.key === 'fire' && x.outcome === 'win')
    const tier = r.wagered > 0 && n > 0 ? tierOf(r.returned / r.wagered) : 0
    if (fireWin || tier)
      at(820, () => {
        setCelebrate({ id, tier, fire: fireWin ? r.after.shooter.points.length || r.before.shooter.points.length : 0, amount: n })
        sfx.craps.win(fireWin ? 3 : tier)
      })
    else if (n > 0) at(760, () => sfx.craps.win(0))
    const hold = fireWin || tier ? 820 + TIER_COUNT[fireWin ? 3 : tier] + 1700 : won.length ? collectAt + 650 : moved.length || lost.length ? 1100 : 700
    at(hold, () => finishShow(id))
  }

  /** the panel's last roll: what it came to (shown with the payout, not before it) */
  const showLast = (r: RollResult) => setLastRoll({ dice: r.dice, event: r.event, net: netOf(r), decided: r.wagered > 0 })

  /** the payout is over (or cut short by the player): the board shows the table as it stands and betting reopens */
  function finishShow(id?: number) {
    if (phaseRef.current !== 'result' || (id !== undefined && run.current !== id)) return
    clearTimers()
    if (play.current) showLast(play.current.r)
    setPhase('bet')
    setRollView(false)
    setCelebrate(null)
    setLit(null)
    setRolled(null)
    setCall(null)
    setExits({})
    const t = keeper.table
    setTable(t)
    setPiles((ps) => syncPiles(ps, t.bets))
    setPuckState(t.point)
    setShooterRolls(t.shooter.rolls)
    sceneRef.current?.setPuck(t.point)
    setFirePts(t.shooter.points)
    // the camera returns for betting with the dice where they landed; a moment later the stick brings them home, so
    // the next throw needn't wait for it (a roll pressed first brings them back itself)
    sceneRef.current?.collect(false)
    later(SWEEP_AFTER, () => {
      if (phaseRef.current === 'bet' && sceneRef.current?.collect(true)) sfx.craps.collect()
    })
    // the roll's total stays a moment longer
    const shown = run.current
    later(2200, () => run.current === shown && setNet(null))
  }

  /* ---------------- chips ---------------- */

  const betting = phase !== 'roll' && opened && held

  function place(key: BetKey) {
    if (phaseRef.current === 'roll') return
    if (phaseRef.current === 'result') finishShow()
    if (!held) return refuse(key, 'Craps is open in another tab')
    const before = keeper.table.bets[key] ?? 0
    const res = keeper.place(key, chip)
    if (!res.ok) {
      if (res.why === 'closed') return refuse(key, whyNot(key, keeper.table))
      if (res.why === 'limit') return refuse(key, atLimit(key, res.max, keeper.table))
      if (res.why === 'coins') return refuse(key, NO_COINS)
      if (res.why === 'wait') return refuse(key, 'One moment: the table is opening')
      return
    }
    // a chip cut short is never silent: say what was placed, and why
    if (res.amount < chip) pushToast({ kind: 'info', title: round2(before + res.amount) >= res.max ? `Topped up to the ${coins(res.max)} limit on ${betName(key)}` : `Only ${coins(res.amount)} coins left: placed ${coins(res.amount)} on ${betName(key)}` })
    sfx.craps.chip()
    sync()
    setUndo((u) => [...u, { key, amount: res.amount }])
    setStillThere(0)
    // a touch player has no hover: the first chip on each kind of bet opens its explanation for a moment
    if (touch && !told.has(kindOf(key))) {
      told.add(kindOf(key))
      saveTold(told)
      setTell((t) => ({ key, n: (t?.n ?? 0) + 1 }))
    }
  }

  function remove(key: BetKey) {
    if (phaseRef.current === 'roll') return
    if (phaseRef.current === 'result') finishShow()
    if (!held) return
    // an odds spot with nothing on it takes down the bet it backs (a don't bet may come down); a number box with no
    // place bet, the don't come bet in it, or else says why the come bet there stays
    const b = keeper.table.bets
    const n = key.startsWith('place') ? key.slice(5) : null
    const target = b[key] ? key : n ? ([`dontCome${n}`, `come${n}`] as BetKey[]).find((x) => b[x]) : backs(key)
    if (!target || !b[target]) return
    // the chip placed there last, or the chosen chip's worth
    const step = [...undo].reverse().find((u) => u.key === target)
    const r = keeper.remove(target, step?.amount ?? chip)
    if (!r.ok) {
      if (r.why === 'stays') refuse(target, whyStays(target, keeper.table))
      return
    }
    sfx.craps.remove()
    sync()
    if (r.trimmed.length) pushToast({ kind: 'info', title: keeper.table.bets[r.trimmed[0]] ? `${betName(r.trimmed[0])} came down to its new limit` : `${betName(r.trimmed[0])} came down with it` })
    setUndo((u) => u.filter((x) => keeper.table.bets[x.key]))
  }

  // the board gets stable handlers that always call the latest place() / remove()
  const placeRef = useRef(place)
  placeRef.current = place
  const removeRef = useRef(remove)
  removeRef.current = remove
  const onPlace = useCallback((key: BetKey) => placeRef.current(key), [])
  const onRemove = useCallback((key: BetKey) => removeRef.current(key), [])

  function undoLast() {
    if (phaseRef.current !== 'bet' || !undo.length) return
    const step = undo[undo.length - 1]
    setUndo(undo.slice(0, -1))
    const r = keeper.remove(step.key, step.amount)
    if (!r.ok) {
      if (r.why === 'stays') refuse(step.key, whyStays(step.key, keeper.table))
      return
    }
    sfx.craps.remove()
    sync()
  }

  function clear() {
    if (phaseRef.current === 'roll') return
    if (phaseRef.current === 'result') finishShow()
    const had = onTable(keeper.table)
    if (!had) return
    const back = keeper.clear()
    setUndo([])
    if (back > 0) {
      sfx.craps.remove()
      sync()
    }
    // contract bets stay: say so rather than seem to ignore the press
    if (onTable(keeper.table) > 0) pushToast({ kind: 'info', title: back > 0 ? 'Cleared. Bets that must stay up until decided are still on the table' : 'These bets stay up until the dice decide them' })
  }

  const rebetAdds = opened ? keeper.rebetAdds() : {}
  const canRebet = betting && Object.keys(rebetAdds).length > 0
  function rebet() {
    if (phaseRef.current === 'roll' || !opened) return
    if (phaseRef.current === 'result') finishShow()
    const adds = keeper.rebetAdds()
    const steps = Object.entries(adds) as [BetKey, number][]
    if (!steps.length) return refuse(null, keeper.rebet ? 'Your last come-out bets are all on the table' : 'Rebet puts back the bets of your last come-out roll')
    const why = keeper.putMany(adds)
    if (why === 'coins') return refuse(null, 'Not enough coins for your last bets')
    if (why) return
    sfx.craps.chip()
    sync()
    setUndo((u) => [...u, ...steps.map(([key, amount]) => ({ key, amount }))])
  }

  function toggleWorking() {
    if (phaseRef.current === 'roll' || !opened) return
    if (keeper.setWorking(!keeper.table.working)) {
      sfx.click()
      sync()
    }
  }

  // whether the control in focus got there by pointer (a click) rather than by keyboard (Tab): see the keys below
  const pointerFocus = useRef(false)
  useEffect(() => {
    let down = 0
    const onDown = () => (down = performance.now())
    const onFocus = () => (pointerFocus.current = performance.now() - down < 500)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('focusin', onFocus, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('focusin', onFocus, true)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || info || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (e.ctrlKey) {
        if (k === 'z') {
          e.preventDefault()
          undoLast()
        }
        return
      }
      if (e.code === 'Space' || e.key === 'Enter') {
        // a control reached with the keyboard keeps its own Space and Enter; otherwise both roll (see Sic Bo)
        const control = (e.target as HTMLElement | null)?.closest?.('button,[role=button],[role=switch],[role=tab]')
        if (control && (e.key === 'Enter' || !pointerFocus.current)) return
        e.preventDefault()
        if (!e.repeat) void roll()
      } else if (k === 'z' || k === 'backspace') undoLast()
      else if (k === 'c') clear()
      else if (k === 'r') rebet()
      else if (k === 'w') toggleWorking()
      else if (/^[1-8]$/.test(e.key)) {
        sfx.click()
        setChip(CHIPS[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- the bubble follows the dice ---------------- */

  const bubbleRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!call) return
    let raf = 0
    const at = { x: 0, y: 0 }
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = bubbleRef.current
      if (!el) return
      const f = frameRef.current
      const sc = readyRef.current ? sceneRef.current : null
      // over the flat dice (centred in the frame) when there is no 3D table
      let x = f.x + f.w / 2
      let y = f.y + f.h / 2 - (geo.current.tall ? 46 : 66)
      if (sc) {
        sc.diceOnScreen(at)
        x = at.x
        y = at.y - (geo.current.tall ? 20 : 32)
      }
      const half = el.offsetWidth / 2 + 6
      x = Math.max(f.x + half, Math.min(f.x + f.w - half, x))
      y = Math.max(f.y + el.offsetHeight + 14, Math.min(f.y + f.h - 6, y))
      el.style.transform = `translate(${x}px, ${y}px)`
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [call])

  /* ---------------- newcomer hints ---------------- */

  const layout: Layout = G.layout
  const pointNow = table.point
  // the hint the table calls for now (whatever the phase: a roll doesn't end it, the table moving on does), and the
  // one on show (only while betting, and out of the way of a tooltip or a notice)
  const hintFor: { key: BetKey; kind: CoachKind; title: string; sub: string } | null =
    coach.off || !opened || !held
      ? null
      : pointNow === null && !onTable(table) && coach.pass < 3 && layout.at.pass
        ? { key: 'pass', kind: 'pass', title: 'Start with the Pass Line', sub: `Pick a chip and ${touch ? 'tap' : 'click'} the glowing Pass Line. On this first roll 7 or 11 wins; 2, 3 or 12 loses.` }
        : pointNow !== null && table.bets.pass && !table.bets.passOdds && coach.odds < 3 && layout.at.passOdds
          ? { key: 'passOdds', kind: 'odds', title: `The point is ${pointNow}: back it with odds`, sub: `${touch ? 'Tap' : 'Click'} the ODDS ring behind your bet. It wins with the ${pointNow} and pays true odds: no house edge at all.` }
          : null
  // a hint counts as seen once it has been up and the table moves on (followed or not); after three it stops
  const hintKind = hintFor?.kind ?? null
  const lastHint = useRef<CoachKind | null>(null)
  useEffect(() => {
    const was = lastHint.current
    lastHint.current = hintKind
    if (was && was !== hintKind) setCoach({ ...coach, [was]: coach[was] + 1 })
    // (counts the change of hint only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintKind])

  /* ---------------- panel ---------------- */

  const rolling = phase === 'roll'
  const tableTotal = onTable(table)
  // what the panel says is on the table follows the chips on show: through a payout it changes as they leave
  const stakes = piles.filter((p) => !p.win)
  const shownTotal = round2(stakes.reduce((a, p) => a + p.amount, 0))
  const tableCount = stakes.length
  const canRoll = opened && held && (ready || failed) && !rolling && tableTotal > 0
  const stateText = table.point === null ? 'Come-out roll' : `Point is ${table.point}`
  const rollSub = !held ? (elsewhere ? 'Open in another tab' : 'Opening the table…') : !opened ? 'Opening the table…' : rolling ? 'Dice in the air…' : !ready && !failed ? 'Setting up the table…' : tableTotal ? `${stateText} · ${fmt(tableTotal)} on the table` : balance < 1 ? 'Not enough coins' : 'Place a bet to roll'
  const last = lastRoll

  // On a phone all eight chips share the rack beside Roll, each as wide as the rack allows; where they would come out
  // narrower than a comfortable tap, the rack scrolls instead (six and a half chips in view, the half saying so).
  const rollW = G.tall ? 78 : 104
  const rackIn = size.w - 16 - 8 - rollW - 8
  const fit = Math.floor((rackIn - 7 * 2) / 8)
  const chipBtn = !G.tall ? 40 : fit >= MIN_CHIP_BTN ? Math.min(40, fit) : Math.max(MIN_CHIP_BTN, Math.floor((rackIn - 6 * 2) / 6.5))
  const rackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rack = rackRef.current
    const el = rack?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!rack || !el) return
    const l = el.offsetLeft - rack.offsetLeft
    if (l < rack.scrollLeft) rack.scrollTo({ left: l - 4, behavior: 'smooth' })
    else if (l + el.offsetWidth > rack.scrollLeft + rack.clientWidth) rack.scrollTo({ left: l + el.offsetWidth - rack.clientWidth + 4, behavior: 'smooth' })
  }, [chip, wide, chipBtn])
  const chipPicker = (compact: boolean) =>
    CHIPS.map((v, i) => (
      <button
        key={v}
        onClick={() => (sfx.click(), setChip(v))}
        style={compact ? { width: chipBtn } : undefined}
        className={`flex shrink-0 items-center justify-center transition ${compact ? 'h-10 rounded-md' : 'rounded-lg py-1.5'} ${
          chip === v ? (compact ? 'bg-white/15 ring-2 ring-accent' : 'bg-hover ring-2 ring-accent') : compact ? '' : 'hover:bg-raised'
        }`}
        aria-label={`${v} coin chip`}
        aria-pressed={chip === v}
        title={compact ? undefined : `${fmt(v, 0)} (${i + 1})`}
      >
        <motion.span animate={{ y: chip === v && !compact ? -2 : 0 }}>
          <Chip value={v} size={compact ? Math.min(30, chipBtn - 4) : 38} />
        </motion.span>
      </button>
    ))

  const panel = (
    <>
      <div className={!wide ? 'hidden' : ''}>
        <Label right={<>{fmt(balance)}</>}>Chip value</Label>
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-stage p-2">{chipPicker(false)}</div>
      </div>
      <div className="rounded-lg bg-stage px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-muted">On the table{tableCount > 0 ? ` · ${tableCount} bet${tableCount > 1 ? 's' : ''}` : ''}</span>
          <span className="tnum flex items-center gap-1.5 text-[16px] font-extrabold">
            {fmt(shownTotal)} <Coin size={16} />
          </span>
        </div>
        {last && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
              Last roll
              <span className="flex gap-[3px]">
                <RedDie n={last.dice[0]} size={16} />
                <RedDie n={last.dice[1]} size={16} />
              </span>
              <span className="tnum font-extrabold text-ink">{totalOf(last.dice)}</span>
            </span>
            <span className={`tnum text-[13px] font-extrabold ${last.net > 0 ? 'text-gold' : last.net < 0 ? 'text-[#ff9d94]' : 'text-dim'}`}>
              {!last.decided ? 'No decision' : last.net > 0 ? `+${fmt(last.net)}` : last.net < 0 ? `−${fmt(-last.net)}` : 'Even'}
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ActionButton tone="neutral" onClick={undoLast} disabled={phase !== 'bet' || !undo.length}>
          Undo <Kbd>Z</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={clear} disabled={!betting || !tableTotal}>
          Clear <Kbd>C</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={rebet} disabled={!canRebet}>
          Rebet <Kbd>R</Kbd>
        </ActionButton>
      </div>
      <div className="flex flex-col gap-1 rounded-lg bg-stage px-3 py-1">
        <div className="flex items-center justify-between py-1.5">
          <div>
            <div className="text-[13px] font-semibold text-ink">
              Working <Kbd>W</Kbd>
            </div>
            <div className="text-[11px] font-semibold text-dim">Place bets and hardways on the come-out</div>
          </div>
          <MemoToggle on={table.working} onChange={toggleWorking} disabled={!betting} label="Working" />
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.05] py-1.5">
          <div>
            <div className="text-[13px] font-semibold text-ink">Turbo</div>
            <div className="text-[11px] font-semibold text-dim">A quicker throw and payout</div>
          </div>
          <MemoToggle on={turbo} onChange={setTurbo} label="Turbo" />
        </div>
      </div>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'basic', label: 'Basic' },
          { value: 'all', label: 'All bets' },
        ]}
      />
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold">
        <button onClick={() => (sfx.click(), setInfo('learn'))} className="text-muted transition hover:text-ink">
          How to play
        </button>
        <button onClick={() => (sfx.click(), setInfo('bets'))} className="text-muted transition hover:text-ink">
          Payouts · house edges
        </button>
      </div>
      <div className="hidden text-[11px] font-semibold leading-relaxed text-dim lg:block [@media(max-height:820px)]:lg:hidden">
        Keys: 1 to 8 pick a chip, Space rolls, Z undoes, C clears, R rebets, W toggles Working. Right-click a spot to take a chip off.
      </div>
      {/* Roll stays in view at the foot of the panel, however short the screen */}
      <div className={`lg:sticky lg:bottom-0 lg:z-10 lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_80%,transparent)] lg:px-4 lg:pb-4 lg:pt-3 ${!wide ? 'hidden' : ''}`}>
        <ActionButton onClick={() => void roll()} disabled={!canRoll} sub={rollSub}>
          {rolling ? 'Rolling…' : 'Roll'} <Kbd>Space</Kbd>
        </ActionButton>
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const narrow = G.tall
  // what sits on the props page while the phone shows the main one (and the other way): a count on its tab
  const propsKeys = new Set(layoutOf('props', true).cells.map((c) => c.key as string))
  const onProps = piles.filter((p) => !p.win && propsKeys.has(p.key)).length
  const onMain = piles.filter((p) => !p.win && !propsKeys.has(p.key)).length
  // the Basic view's board has no place for Come, the props or the Fire Bet: any of them still up are listed here
  const unseen = all ? [] : piles.filter((p) => !layout.at[p.key])
  const unseenStakes = unseen.filter((p) => !p.win)
  const unseenWon = round2(unseen.filter((p) => p.win).reduce((a, p) => a + p.amount, 0))
  const unseenTotal = round2(unseenStakes.reduce((a, p) => a + p.amount, 0))
  const unseenNames = [...new Set(unseenStakes.map((p) => betName(p.key)))]
  // the coach stands on the board's top edge (over the page tabs on a phone), clear of everything else up there
  const coachFoot = (narrow ? G.tabsY : G.board.y - 9) - 6
  const hint = phase === 'bet' && !tipOpen && !stillThere && !unseen.length ? hintFor : null
  const pill = 'pointer-events-auto flex h-[34px] items-center gap-1 rounded-full bg-[#06140d]/80 px-3 text-[12px] font-extrabold text-white/85 ring-1 ring-white/15 backdrop-blur-[2px] active:scale-95'
  const showUndo = !wide && phase === 'bet' && undo.length > 0
  const showClear = !wide && phase === 'bet' && tableTotal > 0 && !undo.length && !canRebet
  const showRebet = !wide && phase === 'bet' && canRebet

  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-[#0b0806]" data-phase={phase}>
      <div ref={hostRef} className="absolute inset-0" />
      {/* the room's corners fall away: the eye goes to the table */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_70%_at_50%_30%,transparent_50%,rgba(6,3,2,.6)_100%)]" />

      {/* the 3D table loading, or not available: then the dice are shown flat */}
      <AnimatePresence>
        {!ready && (
          <motion.div key="loading" className="absolute z-[15] flex items-center justify-center" style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }} exit={{ opacity: 0, transition: { duration: 0.45 } }}>
            {failed ? <FlatDice dice={flat.dice} rolling={flat.rolling} small={narrow} /> : <BojeLoader label="Setting up the table" progress={progress} />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* the last rolls, and the point */}
      <div className="absolute z-10 flex items-center justify-between gap-2" style={{ left: G.pad + 2, right: G.pad + 2, top: narrow ? 6 : 10, height: narrow ? 28 : 34 }}>
        <RollStrip rolls={hist} max={narrow ? Math.max(4, Math.floor((size.w - 205) / 25)) : Math.max(6, Math.min(20, Math.floor((size.w - 330) / 30)))} bare={narrow} size={narrow ? 22 : 26} />
        <PointReadout point={puck} rolls={shooterRolls} points={firePts} compact={narrow} />
      </div>

      {/* the stickman's call */}
      <AnimatePresence>{call && !celebrating && <StickBubble key={call.id} ref={bubbleRef} call={call.call} narrow={narrow} />}</AnimatePresence>

      {/* the board (and on a phone its page tabs): it slides away below the stage while the dice fly */}
      <motion.div
        className="absolute inset-x-0 top-0 z-20"
        initial={false}
        animate={rollView ? { y: size.h - (narrow ? G.tabsY : G.board.y - 9) + 12, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={rollView ? { duration: 0.42, ease: [0.55, 0, 0.75, 0.2], opacity: { duration: 0.3, delay: 0.12 } } : { type: 'spring', stiffness: 240, damping: 30, opacity: { duration: 0.18 } }}
      >
        {/* on a phone the 3D view's foot is over the page tabs: the felt fades out behind them into the board */}
        {narrow && all && <div className="pointer-events-none absolute inset-x-0" style={{ top: G.tabsY - 5, height: G.board.y - G.tabsY + 1, background: 'linear-gradient(180deg, rgba(11,8,6,0), rgba(11,8,6,.92) 5px, #0b0806 10px)' }} />}
        {narrow && all && (
          <div className="absolute flex items-center justify-between gap-2" style={{ left: G.pad + 3, right: G.pad + 3, top: G.tabsY, height: 38 }}>
            <div className="flex rounded-full bg-black/45 p-[2px] ring-1 ring-white/10" role="tablist">
              {(
                [
                  ['main', 'Main', onMain],
                  ['props', 'Props · Fire', onProps],
                ] as const
              ).map(([p, label, n]) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={page === p}
                  onClick={() => (sfx.click(), setPage(p))}
                  className={`flex h-[34px] items-center gap-1 whitespace-nowrap rounded-full px-3 text-[12px] font-extrabold transition ${page === p ? 'bg-[#e6bd62] text-[#2a1c00]' : 'text-white/70'}`}
                >
                  {label}
                  {n > 0 && <span className={`tnum rounded-full px-1.5 text-[10px] leading-[16px] ${page === p ? 'bg-black/20' : 'bg-white/15'}`}>{n}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* the rail round the felt: oxblood leather, a gold bead */}
        <div
          className="pointer-events-none absolute"
          style={{
            left: G.board.x - (narrow ? 5 : 9),
            top: G.board.y - (narrow ? 5 : 9),
            width: G.board.w + (narrow ? 10 : 18),
            height: G.board.h + (narrow ? 10 : 18),
            borderRadius: narrow ? 14 : 22,
            background: 'linear-gradient(180deg,#4a1a1d 0%,#2a0d10 60%,#1a0709 100%)',
            boxShadow: '0 0 0 1px rgba(230,189,98,.4), inset 0 1px 0 rgba(255,255,255,.12), inset 0 -2px 0 rgba(0,0,0,.4), 0 22px 44px -16px rgba(0,0,0,.9)',
          }}
        >
          <div
            className="absolute"
            style={{
              inset: narrow ? 5 : 9,
              borderRadius: narrow ? 10 : 14,
              background: `${NOISE}, radial-gradient(ellipse 90% 85% at 50% 20%, #13804f 0%, #0c6340 50%, #073f29 100%)`,
              backgroundBlendMode: 'overlay, normal',
              boxShadow: '0 0 0 1.5px rgba(230,189,98,.55), inset 0 0 40px rgba(0,0,0,.4)',
            }}
          />
        </div>
        <MemoBoard
          layout={layout}
          left={G.board.x + (narrow ? 4 : 8)}
          top={G.board.y + (narrow ? 4 : 8)}
          width={G.board.w - (narrow ? 8 : 16)}
          height={G.board.h - (narrow ? 8 : 16)}
          stageH={size.h}
          piles={piles}
          exits={exits}
          table={table}
          puck={puck}
          firePoints={firePts}
          lit={lit}
          rolled={rolled}
          interactive={betting}
          marks={phase === 'bet'}
          pulse={hint?.key ?? null}
          tell={tell}
          onPlace={onPlace}
          onRemove={onRemove}
          onTip={setTipOpen}
          shake={shake}
        />
      </motion.div>

      {/* the Basic view: bets still up that its board has no place for, listed (a tap shows every bet) */}
      <AnimatePresence>
        {unseen.length > 0 && !rolling && (
          <motion.button
            key="unseen"
            className={`absolute z-[23] flex h-[34px] max-w-[calc(100%-24px)] items-center gap-1.5 rounded-full px-3 text-[12px] font-extrabold ring-1 backdrop-blur-[2px] transition active:scale-95 ${unseenWon > 0 ? 'bg-[linear-gradient(180deg,#fff6d6,#ffe08a_55%,#f2b53a)] text-[#2a1600] ring-[#5a2c00]/60' : 'bg-[#06140d]/85 text-white/90 ring-gold/40 hover:ring-gold/70'}`}
            style={{ left: G.board.x + 2, top: (narrow ? G.tabsY : G.board.y - 9) - 42 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            onClick={() => (sfx.click(), setView('all'))}
            title={`On the table but not on the Basic board: ${unseenNames.join(', ')}`}
            aria-label={`${unseenStakes.length} more bet${unseenStakes.length === 1 ? '' : 's'} on the table (${unseenNames.join(', ')}), ${fmt(unseenTotal)}. Show all bets`}
          >
            {unseenWon > 0 ? (
              <span className="tnum">+{fmt(unseenWon)} won on</span>
            ) : (
              <span className="tnum rounded-full bg-gold/90 px-1.5 text-[10.5px] leading-[17px] text-[#2a1c00]">{unseenStakes.length}</span>
            )}
            <span className="truncate">{unseenWon > 0 ? 'other bets' : `more bet${unseenStakes.length === 1 ? '' : 's'} · ${fmt(unseenTotal)}`}</span>
            <span className={`ml-0.5 shrink-0 ${unseenWon > 0 ? '' : 'text-gold'}`}>All bets ›</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* the quick fixes where the panel sits under the stage: Undo, and Rebet or Clear */}
      {!wide && (
        <div className="pointer-events-none absolute z-[22] flex gap-2" style={{ right: G.pad + 3, top: narrow ? (all ? G.tabsY + 2 : G.tabsY - 44) : G.board.y - 44 }}>
          <AnimatePresence>
            {showUndo && (
              <motion.button key="undo" className={pill} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} onClick={undoLast} aria-label="Undo the last chip">
                <UndoIcon /> Undo
              </motion.button>
            )}
            {(showRebet || showClear) && (
              <motion.button key={showRebet ? 'rebet' : 'clear'} className={pill} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} onClick={showRebet ? rebet : clear}>
                {showRebet ? 'Rebet' : 'Clear'}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* what the roll came to, at the board's top edge */}
      <div className="pointer-events-none absolute z-[24] flex justify-center" style={{ left: 0, right: 0, top: (narrow ? G.tabsY : G.board.y) - (narrow ? 34 : 40) }}>
        <AnimatePresence>{net && !celebrating && <NetPill key={net.id} net={net.net} narrow={narrow} />}</AnimatePresence>
      </div>

      {/* "your bets are still on the table" on a return visit */}
      <AnimatePresence>
        {stillThere > 0 && phase === 'bet' && (
          <motion.div
            key={stillThere}
            className="pointer-events-none absolute z-[24] whitespace-nowrap rounded-full bg-[#06140d]/85 px-3 py-1 text-[12px] font-extrabold text-white/90 ring-1 ring-gold/35"
            style={{ left: size.w / 2, top: (narrow ? G.tabsY : G.board.y) - (narrow ? 32 : 38), x: '-50%' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: [0, 1, 1, 0], y: 0 }}
            transition={{ duration: 4, times: [0, 0.08, 0.85, 1], delay: 0.6 }}
            onAnimationComplete={() => setStillThere(0)}
          >
            Your bets are still on the table
          </motion.div>
        )}
      </AnimatePresence>

      {/* a newcomer's hint */}
      <AnimatePresence>{hint && <CoachMark key={hint.kind} x={G.board.x + G.board.w / 2} y={coachFoot} W={size.w} title={hint.title} sub={hint.sub} onClose={() => setCoach({ ...coach, off: true })} />}</AnimatePresence>

      {/* a big win's celebration fills the room over the table */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[32]" style={{ height: (narrow ? G.tabsY : G.board.y) - 6 }}>
        <AnimatePresence>
          {celebrate && <Celebration key={celebrate.id} tier={celebrate.tier} fire={celebrate.fire} amount={celebrate.amount} narrow={narrow} top={narrow ? 44 : 64} onDone={() => finishShow(celebrate.id)} />}
        </AnimatePresence>
      </div>

      {/* the table is open in another tab */}
      <AnimatePresence>
        {elsewhere && !held && (
          <motion.div key="elsewhere" className="absolute inset-0 z-[40] flex items-center justify-center bg-[#050302]/80 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="mx-4 max-w-[340px] rounded-2xl border border-white/10 bg-panel px-5 py-4 text-center shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)]">
              <div className="text-[16px] font-extrabold text-ink">Craps is open in another tab</div>
              <div className="mt-1 text-[13px] font-semibold leading-snug text-muted">Your table can only be played in one tab at a time. Close the other one and it opens here.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!wide && (
        <div className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 px-2 pb-2 ${narrow ? '' : 'justify-center'}`} style={{ height: G.barH + 4 }}>
          <div ref={rackRef} className={`no-scrollbar flex min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/35 p-1 ${narrow ? 'gap-0.5' : 'max-w-[460px] justify-between gap-1'}`}>
            {chipPicker(true)}
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => void roll()}
            disabled={!canRoll}
            style={{ width: rollW }}
            className="flex h-12 shrink-0 flex-col items-center justify-center rounded-lg bg-accent text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16)] disabled:opacity-45"
          >
            <span className={`font-extrabold leading-tight ${rolling ? 'text-[13px]' : 'text-[16px]'}`}>{rolling ? 'Rolling' : 'Roll'}</span>
            {!rolling && <span className="tnum text-[10px] font-bold leading-tight opacity-75">{table.point ? `Point ${table.point}` : 'Come-out'}</span>}
          </motion.button>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {say}
      </div>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100svh-150px-env(safe-area-inset-bottom))] max-sm:max-h-[860px] max-sm:min-h-[600px] sm:max-lg:h-[min(86vh,860px)]" />
      <AnimatePresence>{info && <Paytable tab={info} onClose={() => setInfo(null)} />}</AnimatePresence>
    </>
  )
}

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")"

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

/** Without 3D graphics the dice are shown flat: they tumble through faces while the roll plays, then show the roll. */
function FlatDice({ dice, rolling, small }: { dice: Roll | null; rolling: boolean; small: boolean }) {
  const [faces, setFaces] = useState<Roll>(dice ?? [3, 4])
  useEffect(() => {
    if (!rolling) {
      if (dice) setFaces(dice)
      return
    }
    const t = window.setInterval(() => setFaces([rollDie(Math.random), rollDie(Math.random)]), 90)
    return () => clearInterval(t)
  }, [rolling, dice])
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-4">
        {faces.map((n, i) => (
          <motion.span key={i} animate={rolling ? { rotate: [0, 14, -12, 0], y: [0, -10, 0] } : { rotate: 0, y: 0 }} transition={rolling ? { duration: 0.35, repeat: Infinity, delay: i * 0.08 } : { duration: 0.2 }}>
            <RedDie n={n} size={small ? 48 : 72} />
          </motion.span>
        ))}
      </div>
      <div className="max-w-[260px] text-center text-[12px] font-semibold text-white/60">3D graphics aren't available on this device, so the dice are shown flat.</div>
    </div>
  )
}
