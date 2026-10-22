import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'
import { StatusCard } from '../double/bits'
import { reasonText, useKaijuLive, type PlaceResult } from './live'
import { sideId } from './rules'
import { loadChip, saveChip } from './storage'
import { kaijuSfx } from './sound'
import { BayBackdrop } from './art'
import { Hud, revealAt, type HudStage } from './Hud'
import { Board, BetClock, CHIPS, Rack, Slip, layoutFor, marketIndex } from './Board'
import { Party, bigWin } from './Result'
import { FightCard } from './Card'
import { Bettors } from './Feed'
import { HistoryStrip, Standings } from './History'
import { Fairness, HowItWorks } from './Info'
import type { Outcome } from './ledger'
import type { Sel, StageEvent } from './types'

// the 3D stage comes in its own chunk (three.js), so the board and the broadcast are up before it is
const Stage = lazy(() => import('./Stage'))

/*
  Kaiju Clash: a live fight night. Every 67 seconds two of eight kaiju fight in Neon Bay, and everyone bets on the
  same fight: who wins, how (a knockout, a Splash into the bay, or the judges), the round, the first strike and how many
  buildings fall. Prices are each selection's exact chance (rules.ts), so every selection returns 97%.

  This page only renders and calls actions: the live loop (the shared fight night or the stand-in, polling on the
  server's clock, the stake ledger and settling every round once) is live.ts useKaijuLive(). On top, the 3D stage
  (Stage.tsx) with the broadcast over it (Hud.tsx: the tale of the tape while betting, the walkout, the plates and
  health bars, the banners, the commentary, the result and this player's own win); under it the rack (chips, Undo,
  Clear, ×2, Rebet and the bet clock) and the board (Board.tsx: the six markets, prices, stakes, the crowd's chips,
  the winners lit once the stage has shown the result); then the record book (the last results, the next fights,
  the standings), this player's bets and the crowd. Sounds (sound.ts) follow the stage's events (bell, blows,
  collapses, the finish, roars) and the broadcast's moments (the countdown, no more bets, the walkout, the cards,
  this player's result). A big win gets the party (Result.tsx).

  The stage is 16:9 on a wide screen, kept short enough that the rack and the first row of the board stay in view on
  a laptop; on a phone it is about square, with the board in a compact grid under it.

  Keys: 1 to 8 pick a chip, U undoes, X clears, D doubles, R or Space rebets.
*/

const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

/** v as long as key stays the same: the live hook hands out new objects with every answer, and the board, the crowd
 *  and the broadcast only need to draw again when what they show changes */
function useStable<T>(v: T, key: string): T {
  const r = useRef({ key, v })
  if (r.current.key !== key) r.current = { key, v }
  return r.current.v
}

function useViewportHeight() {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight))
  useEffect(() => {
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return h
}

export default function Kaiju() {
  const k = useKaijuLive()
  const pushToast = useWallet((s) => s.pushToast)
  const [chip, setChipState] = useState(() => loadChip(CHIPS, 10))
  const setChip = (v: number) => {
    setChipState(v)
    saveChip(v)
  }
  const [info, setInfo] = useState(false)
  const [fair, setFair] = useState<number | null>(null)
  const [party, setParty] = useState<Outcome | null>(null)
  const [touch] = useState(isTouch)
  const [boxRef, box] = useSize<HTMLDivElement>({ w: 1100, h: 600 })
  const vh = useViewportHeight()
  const r0 = k.round
  const round = useStable(r0, r0 ? [r0.id, r0.phase, r0.hash, r0.key, r0.seed, r0.over ? 1 : 0, r0.fight ? 1 : 0].join('|') : '')
  const mine = useStable(k.mine, JSON.stringify(k.mine))
  const totals = useStable(k.totals, JSON.stringify(k.totals))
  const bettors = useStable(k.bettors, JSON.stringify(k.bettors))
  const main = !!round?.main
  const open = round?.phase === 'bets'

  // the stage's size: 16:9 on a wide screen (shorter on a short one, so the board's first row shows), squarer on a phone
  const wide = box.w >= 768
  const compact = box.w < 640
  const layout = layoutFor(box.w)
  const stageH = Math.round(wide ? Math.min((box.w * 9) / 16, Math.max(400, vh - 84 - 232)) : Math.max(320, Math.min(box.w * 1.02, vh * 0.62)))

  /* ---------------- the reveal: when the broadcast has shown how the fight ended ---------------- */

  // the stage marks its replay of a finish (Stage.tsx data-replay): the result strip and a big win's party wait for it
  const [replay, setReplay] = useState(false)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const mo = new MutationObserver(() => setReplay(!!el.querySelector('[data-replay]')))
    mo.observe(el, { attributes: true, subtree: true, attributeFilter: ['data-replay'] })
    return () => mo.disconnect()
    // the box is there for the page's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const revealT = round ? revealAt(round) : null
  const [, rerender] = useState(0)
  useEffect(() => {
    if (revealT == null) return
    const left = revealT - k.now()
    if (left <= 0) return
    const t = window.setTimeout(() => rerender((x) => x + 1), left + 20)
    return () => clearTimeout(t)
  }, [revealT, k.now])
  const revealed = revealT != null && k.now() >= revealT
  const settled = round && k.lastSettled?.round === round.id ? k.lastSettled : null
  const boardHits = revealed ? (round?.hits ?? null) : null

  // this player's result is celebrated once, and only for a round this page watched before the reveal (not after a
  // reload): the sound with the card, a big win's party once the stage's replay of the finish is done
  const watched = useRef(new Set<number>())
  const cheered = useRef(new Set<number>())
  const partied = useRef(new Set<number>())
  if (round && revealT != null && !revealed) watched.current.add(round.id)
  useEffect(() => {
    if (!round || !revealed || !settled || settled.bet <= 0 || !watched.current.has(round.id)) return
    const big = bigWin(settled)
    if (!cheered.current.has(round.id)) {
      cheered.current.add(round.id)
      if (!document.hidden) (settled.payout > 0 ? () => kaijuSfx.win(big) : kaijuSfx.lose)()
    }
    if (big && !replay && !partied.current.has(round.id)) {
      partied.current.add(round.id)
      setParty(settled)
    }
  }, [round?.id, revealed, replay, settled])
  // a party belongs to its round
  useEffect(() => {
    if (party && round && party.round !== round.id) setParty(null)
  }, [round?.id, party])

  /* ---------------- sounds ---------------- */

  const matchRef = useRef(round?.matchup ?? null)
  matchRef.current = round?.matchup ?? null
  const mainRef = useRef(main)
  mainRef.current = main
  const onStageEvent = useCallback((e: StageEvent) => {
    if (document.hidden) return
    switch (e.kind) {
      case 'bell':
        kaijuSfx.bell(1)
        if (e.round === 1) kaijuSfx.crowd(mainRef.current ? 0.8 : 0.55)
        break
      case 'land':
        kaijuSfx.hit(e.heavy)
        break
      case 'block':
        kaijuSfx.block()
        break
      case 'collapse':
        kaijuSfx.collapse()
        break
      case 'ko':
        kaijuSfx.ko()
        break
      case 'splash':
        kaijuSfx.splash()
        break
      case 'final':
        kaijuSfx.final()
        break
      case 'roar':
        if (matchRef.current) kaijuSfx.roar(sideId(matchRef.current, e.who))
        break
    }
  }, [])
  const onMoment = useCallback((m: string, s: { stage: HudStage }) => {
    if (document.hidden) return
    if (m === 'open') kaijuSfx.open()
    else if (m.startsWith('count:')) kaijuSfx.count(Number(m.slice(6)))
    else if (m === 'closed') kaijuSfx.closed()
    else if (m === 'walkout' && s.stage === 'walkout') {
      kaijuSfx.walkout(mainRef.current)
      kaijuSfx.crowd(mainRef.current ? 0.85 : 0.5, 3)
    } else if (m === 'cards') kaijuSfx.drumroll(1.3)
    else if (m === 'card') kaijuSfx.card()
    else if (m === 'decided') kaijuSfx.decision()
  }, [])

  /* ---------------- betting ---------------- */

  const act = async (p: Promise<PlaceResult>) => {
    const r = await p
    const msg = reasonText(r)
    if (msg) pushToast({ kind: 'info', title: msg })
    if (!r.ok && r.reason !== 'empty' && !document.hidden) kaijuSfx.nope()
    return r
  }
  const pick = useCallback(
    (s: Sel) => {
      if (round?.phase !== 'bets') return
      kaijuSfx.chip(marketIndex(s))
      void act(k.actions.place({ [s]: chip }))
    },
    // the actions read the live loop's refs; chip and the phase are what change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chip, round?.phase, round?.id],
  )
  const undo = () => open && void act(k.actions.undo()).then((r) => r.ok && kaijuSfx.chip(0))
  const clear = () => open && void act(k.actions.clear()).then((r) => r.ok && kaijuSfx.chip(1))
  const double = () => open && void act(k.actions.double()).then((r) => r.ok && kaijuSfx.chip(4))
  const rebet = () => open && k.last && void act(k.actions.rebet()).then((r) => r.ok && kaijuSfx.chip(3))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.repeat || tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey || info || fair != null || party) return
      const key = e.key.toLowerCase()
      if (/^[1-8]$/.test(key)) setChip(CHIPS[Number(key) - 1])
      else if (key === 'u') undo()
      else if (key === 'x') clear()
      else if (key === 'd') double()
      else if (key === 'r') rebet()
      else if (e.code === 'Space' && tag !== 'BUTTON') {
        if (!open || !k.last) return
        e.preventDefault()
        rebet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- view ---------------- */

  const matchup = round?.matchup ?? null
  const odds = round?.odds ?? null
  const page = (
    <div className="flex flex-col gap-3">
      <div className={`overflow-hidden rounded-2xl border bg-[#060a18] transition-[border-color,box-shadow] duration-700 ${main ? 'border-gold/45 shadow-[0_0_70px_-28px_rgba(247,197,72,.65)]' : 'border-line shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]'}`}>
        <div ref={boxRef} className="relative w-full select-none overflow-hidden" style={{ height: stageH }} data-phase={round?.phase ?? 'wait'} data-round={round?.id} data-main={main || undefined}>
          <BayBackdrop glow={main ? '#8a6a12' : '#8a2d8f'} />
          <Suspense fallback={null}>
            {/* (the stage positions itself relative: it fills the box by size) */}
            <Stage view={k.view} now={k.now} onEvent={onStageEvent} className="h-full w-full" />
          </Suspense>
          <Hud round={round} now={k.now} standings={k.standings} history={k.history} settled={settled} compact={compact} roomy={layout === 'wide'} replay={replay} ready={k.ready} onMoment={onMoment} />
          {round?.phase === 'bets' && (
            <button
              onClick={() => setInfo(true)}
              aria-label="How Kaiju Clash works"
              className="absolute right-2 top-2 z-30 flex h-9 items-center gap-1.5 rounded-full bg-black/45 px-2.5 text-[12.5px] font-bold text-white/85 ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-black/65 sm:right-3 sm:top-3 sm:px-3"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/85 text-[10px] font-black text-[#140e33]">?</span>
              <span className="hidden sm:inline">How it works</span>
            </button>
          )}
          <AnimatePresence>{party && <Party key={party.round} outcome={party} compact={compact} onDone={() => setParty(null)} />}</AnimatePresence>
        </div>

        <div className="flex flex-col gap-2.5 bg-panel2 p-2.5 sm:p-3">
          <Rack
            chip={chip}
            onChip={setChip}
            open={open}
            canUndo={k.canUndo}
            staked={k.staked}
            hasLast={!!k.last}
            onUndo={undo}
            onClear={clear}
            onDouble={double}
            onRebet={rebet}
            touch={touch}
            layout={layout}
            clock={<BetClock round={round} now={k.now} staked={k.staked} players={k.players} full={layout !== 'wide'} />}
          />
          {matchup && odds ? (
            <Board key={round!.id} matchup={matchup} odds={odds} mine={mine} totals={totals} open={open} hits={boardHits} chip={chip} onPick={pick} compact={compact} touch={touch} layout={layout} />
          ) : (
            <div className="grid h-[200px] place-items-center rounded-xl bg-stage/80 text-[13px] font-semibold text-dim">Joining the fight night…</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2">
        <div className="min-w-0 flex-1">
          <HistoryStrip items={k.history} onPick={setFair} />
        </div>
        <button onClick={() => setInfo(true)} aria-label="How Kaiju Clash works" className="flex h-9 shrink-0 items-center justify-center rounded-lg bg-raised px-3 text-[12px] font-bold text-muted transition hover:bg-hover hover:text-ink">
          <span className="sm:hidden">?</span>
          <span className="hidden sm:inline">How it works</span>
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3">
          <StatusCard conn={k.conn} online={k.online} bots={k.bots} name={k.me.name} editable={k.me.guest} onName={k.actions.rename} onFair={() => round && setFair(round.id)} onRetry={() => void k.actions.retry()} busy={k.busy} />
          {matchup && odds && <Slip matchup={matchup} odds={odds} mine={mine} hits={boardHits} payout={revealed && settled ? settled.payout : null} refund={revealed && settled ? settled.refund : 0} compact={compact} />}
        </div>
        <Bettors rows={bettors} players={k.players} totals={totals} matchup={matchup} hits={boardHits} compact={compact} />
        <div className="flex min-w-0 flex-col gap-3 md:col-span-2 lg:col-span-1">
          <FightCard next={k.next} now={k.now} />
          <Standings rows={k.standings} fights={k.history.length} />
        </div>
      </div>

      <AnimatePresence>
        {info && (
          <HowItWorks
            matchup={matchup}
            odds={odds}
            onClose={() => setInfo(false)}
            onFair={() => {
              setInfo(false)
              if (round) setFair(round.id)
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{fair != null && <Fairness id={fair} current={round?.id ?? null} verify={k.actions.verify} history={k.history} onPick={setFair} onClose={() => setFair(null)} />}</AnimatePresence>
    </div>
  )
  // players who ask for less motion get fades in place of every slide, slam and spring on the page
  return <MotionConfig reducedMotion="user">{page}</MotionConfig>
}
