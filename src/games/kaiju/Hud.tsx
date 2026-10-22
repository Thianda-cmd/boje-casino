import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { BREAK_MS, FIGHT_MS, REVEAL_DECISION_MS, REVEAL_FINISH_MS, ROUND_MS, fightRoundAt, revealAt as revealOf, roundStart } from './clock'
import { callsUntil, fallenBy, healthAt, impactAt, type Call } from './fight'
import { fighter, hitsOf, matchupOf, oddsOf, selName, sideId } from './rules'
import { decisionKind, finishText, judgesLine, resultLine, roundLine, walkoutLines } from './words'
import { KaijuPortrait, type Mood } from './portraits'
import { BuildingMark, CORNER, METHOD_COLOR, MethodMark } from './art'
import { Tape } from './Tape'
import { MyResult } from './Result'
import type { LiveRound, PastFight, Standing } from './live'
import type { Outcome } from './ledger'
import type { Fight, Matchup, Odds, Result, Sel, Side } from './types'

/*
  The broadcast over the 3D stage. Everything here is worked out from the shared clock and the fight script
  (fight.ts), never from the stage, so every browser shows the same moment and nothing is shown before the stage
  plays it.

    betting   the tale of the tape (Tape.tsx) with the betting clock
    closed    NO MORE BETS
    walkout   the announcer's lines at the foot of the stage (words.ts walkoutLines); each kaiju's plate drops into
              the top bar as its corner is called; ROUND 1 just before the bell
    fight     the plates (portrait, name, a health bar that drains toward its kaiju's side with a pale trail that
              catches up, a white flash and a shake as a blow lands, the portrait's face getting hurt), the round and
              its clock between them, the buildings flattened against the line, ROUND n / FIGHT! / END OF ROUND
              banners at the bells, the special's name as it fires, and the ringside commentary (callsUntil) as a
              ticker
    the end   K.O.! or SPLASH! slams in with the result line (a decision: THAT'S THE FIGHT, then the three judges'
              cards turned one by one and the verdict); then this player's own result (Result.tsx) once it has
              settled, and the result strip: what won (the selections that pay, with their prices) and how the fight
              went, held back while the stage replays the finish; in the last seconds before the next round, the
              next fight
  The clock runs on one requestAnimationFrame loop that re-renders only when something on screen changes (a blow, a
  second of the clock, a banner); the betting countdown is written straight into its elements. The loop stops while
  the stage is off screen or the tab is hidden. Players who ask for less motion get fades instead of slams and no
  shaking.

  `onMoment` tells the page about the moments it plays its own sounds on: 'open', 'count:3' to 'count:1', 'closed',
  'walkout', 'cards', 'card', 'decided', 'result', 'teaser'. It fires only for moments that happen while the page
  watches, never for the ones it finds already past when it loads.
*/

export type HudStage = 'wait' | 'bets' | 'closed' | 'walkout' | 'fight' | 'result'

/** how long the banners stay, ms */
const ROUND_LEAD = 1300
const FIGHT_HOLD = 900
const END_HOLD = 1600
const FINISH_HOLD = REVEAL_FINISH_MS
const CARD_STEP = 650
/** THAT'S THE FIGHT holds, then the three cards turn; the verdict lands at REVEAL_DECISION_MS (clock.ts), when it is paid */
const FINAL_HOLD = REVEAL_DECISION_MS - 3 * CARD_STEP
const TEASER_MS = 2800
const SPECIAL_HOLD = 1400
/** NO MORE BETS stays this long into the walkout (betting closes only half a second before it) */
const NOMORE_HOLD = 1000

const JUDGES = ['Judge Okafor', 'Judge Tanaka', 'Judge Rossi']

interface Beam {
  at: number
  who: Side
  outcome: 'land' | 'block' | 'miss' | undefined
}
interface Extras {
  calls: Call[]
  beams: Beam[]
}

interface Snap {
  stage: HudStage
  rnd: 1 | 2 | 3
  brk: boolean
  clock: string
  hp: [number, number]
  fallen: number
  calls: number
  walk: number
  banner: string | null
  over: boolean
  /** after the fight is decided: 1 the big banner, 2 the results, 3 the next fight */
  post: 0 | 1 | 2 | 3
  /** a decision's cards turned so far (4: the verdict) */
  cards: number
  /** the special firing (an index into the beams), or -1 */
  special: number
  /** the last three seconds of betting (3, 2, 1), or the seconds to the next round in the teaser; else 0 */
  count: number
}

const EMPTY: Snap = { stage: 'wait', rnd: 1, brk: true, clock: '', hp: [100, 100], fallen: 0, calls: 0, walk: -1, banner: null, over: false, post: 0, cards: 0, special: -1, count: 0 }
const keyOf = (s: Snap) => `${s.stage}|${s.rnd}|${s.brk}|${s.clock}|${s.hp[0]}|${s.hp[1]}|${s.fallen}|${s.calls}|${s.walk}|${s.banner}|${s.over}|${s.post}|${s.cards}|${s.special}|${s.count}`
const secs = (ms: number) => `0:${String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, '0')}`

/** what the broadcast shows at server time t */
function snapAt(r: LiveRound | null, t: number, x: Extras): Snap {
  if (!r) return EMPTY
  const T = r.times
  const f = r.fight
  const stage: HudStage = t < r.betUntil ? 'bets' : t < T.showAt ? 'closed' : t < T.fightAt ? 'walkout' : t < T.endsAt ? 'fight' : 'result'
  const ms = t - T.fightAt
  const { round: rnd, break: brk } = fightRoundAt(Math.max(-1, ms))
  const over = !!f && ms >= f.endsAt
  const s: Snap = { ...EMPTY, stage, rnd, brk: ms < 0 || brk }
  if (stage === 'bets') {
    const left = r.betUntil - t
    s.count = left <= 3000 ? Math.ceil(left / 1000) : 0
    return s
  }
  if (stage === 'closed') {
    s.banner = 'nomore'
    return s
  }
  if (stage === 'walkout') {
    const lines = walkoutLines(r.matchup)
    const w = t - T.showAt
    for (let i = 0; i < lines.length; i++) if (lines[i].at <= w) s.walk = i
    if (w < NOMORE_HOLD) s.banner = 'nomore'
    else if (ms >= -ROUND_LEAD) s.banner = 'round1'
    return s
  }
  // the fight and after
  s.walk = 9
  if (f) {
    s.hp = healthAt(f, ms)
    s.fallen = fallenBy(f, ms)
    let n = 0
    while (n < x.calls.length && x.calls[n].t <= ms) n++
    s.calls = n
    for (let i = 0; i < x.beams.length; i++) if (ms >= x.beams[i].at - 250 && ms < x.beams[i].at + SPECIAL_HOLD && x.beams[i].at <= f.endsAt) s.special = i
  }
  s.over = over
  if (!over) {
    if (stage === 'fight') {
      const k = rnd
      if (brk) {
        s.clock = secs(roundStart(k) - ms)
        if (ms - (roundStart(k) - BREAK_MS) < END_HOLD && k > 1) s.banner = `end${k - 1}`
        else if (roundStart(k) - ms <= ROUND_LEAD) s.banner = `round${k}`
      } else {
        s.clock = secs(roundStart(k) + ROUND_MS - ms)
        if (ms - roundStart(k) < FIGHT_HOLD) s.banner = `bell${k}`
      }
    }
    return s
  }
  // decided
  const dec = f!.endsAt >= FIGHT_MS
  const since = ms - f!.endsAt
  if (t >= T.nextAt - TEASER_MS) {
    s.post = 3
    s.cards = 4
    s.count = Math.ceil((T.nextAt - t) / 1000)
  } else if (!dec) {
    s.post = since < FINISH_HOLD ? 1 : 2
    if (s.post === 1) s.banner = 'finish'
  } else if (since < FINAL_HOLD) {
    s.post = 1
    s.banner = 'final'
  } else {
    s.post = 2
    s.cards = Math.min(4, Math.floor((since - FINAL_HOLD) / CARD_STEP) + 1)
  }
  return s
}

/**
 * When the broadcast has shown how round r's fight ended (server ms): after the K.O. or SPLASH banner, or once the
 * judges' verdict is read out. The board lights its winners and this player's result shows from then (a decision's
 * winner stays hidden while the cards are turned). Null while the fight is unknown.
 */
export function revealAt(r: LiveRound): number | null {
  const f = r.fight
  if (!f) return null
  return revealOf(r.times.fightAt, f.endsAt)
}

/** a fight's numbers for the result strip: blows landed, knockdowns and buildings, by corner */
function recapOf(f: Fight) {
  const landed = { a: 0, b: 0 }
  const downs = { a: 0, b: 0 }
  const blds = { a: 0, b: 0 }
  const STRIKES = new Set(['jab', 'heavy', 'tail', 'charge', 'beam', 'throw'])
  for (const e of f.events) {
    if (e.t > f.endsAt) break
    if (e.outcome === 'land' && STRIKES.has(e.action)) landed[e.who]++
    if (e.action === 'knockdown') downs[e.who === 'a' ? 'b' : 'a']++
  }
  for (const c of f.collapses) blds[c.by]++
  return { landed, downs, blds }
}

const KEYFRAMES = `
@keyframes kj-flash { from { opacity: .9 } to { opacity: 0 } }
@keyframes kj-pulse { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
@keyframes kj-sheen { from { transform: translateX(-140%) skewX(-20deg) } to { transform: translateX(260%) skewX(-20deg) } }
@keyframes kj-rays { to { transform: rotate(360deg) } }
@keyframes kj-live { 0%, 100% { transform: scale(1); opacity: 1 } 50% { transform: scale(.7); opacity: .5 } }
@media (prefers-reduced-motion: reduce) { .kj-anim { animation: none !important } }
`

export interface HudProps {
  round: LiveRound | null
  now: () => number
  standings: Standing[]
  history: PastFight[]
  /** this player's settled outcome for the round on show, if any */
  settled: Outcome | null
  compact: boolean
  /** the stage is wide enough for the full tale of the tape (the stacked phone one otherwise) */
  roomy: boolean
  /** the stage is replaying the finish (Stage.tsx data-replay): what won waits at the foot until it is done */
  replay: boolean
  ready: boolean
  onMoment?: (m: string, s: { stage: HudStage; post: number; cards: number }) => void
}

export const Hud = memo(function Hud({ round, now, standings, history, settled, compact, roomy, replay, ready, onMoment }: HudProps) {
  const calm = !!useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const roundRef = useRef(round)
  roundRef.current = round
  const momentRef = useRef(onMoment)
  momentRef.current = onMoment
  const fight = round?.fight ?? null
  const extras = useMemo<Extras>(
    () => ({
      calls: fight ? callsUntil(fight, FIGHT_MS + 1) : [],
      beams: fight ? fight.events.filter((e) => e.action === 'beam').map((e) => ({ at: impactAt(e), who: e.who, outcome: e.outcome })) : [],
    }),
    [fight],
  )
  const extrasRef = useRef(extras)
  extrasRef.current = extras
  const [snap, setSnap] = useState<Snap>(() => snapAt(round, now(), extras))
  const last = useRef<{ key: string; snap: Snap; id: number | null }>({ key: keyOf(snap), snap, id: round?.id ?? null })

  useEffect(() => {
    let raf = 0
    let seen = true
    const frame = () => {
      const r = roundRef.current
      const t = now()
      const s = snapAt(r, t, extrasRef.current)
      if (s.stage === 'bets' && r) {
        const left = Math.max(0, r.betUntil - t)
        if (countRef.current) countRef.current.textContent = (left / 1000).toFixed(1)
        if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, left / Math.max(1, r.betUntil - r.times.opensAt)).toFixed(4)})`
      }
      const k = keyOf(s)
      const prev = last.current
      if (k !== prev.key) {
        const sameRound = prev.id === (r?.id ?? null) || (prev.snap.stage === 'result' && s.stage === 'bets')
        if (sameRound) moments(prev.snap, s)
        last.current = { key: k, snap: s, id: r?.id ?? null }
        setSnap(s)
      }
      if (seen) raf = requestAnimationFrame(frame)
    }
    const moments = (a: Snap, b: Snap) => {
      const fire = (m: string) => momentRef.current?.(m, { stage: b.stage, post: b.post, cards: b.cards })
      if (b.stage === 'bets' && a.stage !== 'bets' && a.stage !== 'wait') fire('open')
      if (b.stage === 'bets' && b.count && b.count !== a.count) fire(`count:${b.count}`)
      if (a.stage === 'bets' && b.stage !== 'bets') fire('closed')
      if (b.stage === 'walkout' && a.stage !== 'walkout') fire('walkout')
      if (b.post === 2 && a.post < 2) fire(b.cards ? 'cards' : 'result')
      if (b.cards !== a.cards && b.cards >= 1 && b.cards <= 3) fire('card')
      if (b.cards === 4 && a.cards < 4 && b.post === 2) fire('decided')
      if (b.post === 3 && a.post !== 3) fire('teaser')
    }
    raf = requestAnimationFrame(frame)
    // stops while the stage is off screen
    const io = new IntersectionObserver(([e]) => {
      const was = seen
      seen = e.isIntersecting
      if (seen && !was) raf = requestAnimationFrame(frame)
    })
    if (root.current) io.observe(root.current)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      seen = false
    }
  }, [now])

  // the snapshot belongs to the round it was taken for: a new round (or a new script) is read again at once
  const live = round && last.current.id === round.id ? snap : snapAt(round, now(), extras)

  if (!ready || !round)
    return (
      <div ref={root} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div className="flex items-center gap-2.5 rounded-full bg-black/60 px-4 py-2 text-[13px] font-bold text-white/85 ring-1 ring-white/10 backdrop-blur">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-gold" />
          Joining the fight night…
        </div>
      </div>
    )

  const m = round.matchup
  const odds = round.odds
  const s = live
  const f = round.fight
  // what won shows once it has been shown: after the finishing banner, or once the judges' verdict is read
  const revealed = s.post === 3 || (s.post === 2 && (s.cards === 0 || s.cards >= 4))
  // the plates show a knockout or a Splash the moment it lands; a decision's winner waits for the verdict
  const result = s.over && f && (f.result.method !== 'dec' || revealed) ? f.result : null
  const showBar = s.stage === 'walkout' || s.stage === 'fight' || s.stage === 'result'
  const mood = (side: Side): Mood => {
    if (result) return result.winner === side ? 'win' : result.method === 'dec' ? 'hurt' : 'ko'
    const hp = s.hp[side === 'a' ? 0 : 1]
    return hp <= 35 ? 'hurt' : s.stage === 'fight' ? 'fierce' : 'calm'
  }
  const call = s.calls > 0 ? extrasRef.current.calls[s.calls - 1] : null
  const prevCall = s.calls > 1 ? extrasRef.current.calls[s.calls - 2] : null
  const lines = walkoutLines(m)
  const beam = s.special >= 0 ? extras.beams[s.special] : null
  // for screen readers: the moments, not every blow
  const say =
    s.stage === 'bets'
      ? `Fight ${round.id}: ${fighter(m.a).name} against ${fighter(m.b).name}. Bets are open.`
      : s.stage === 'closed'
        ? 'No more bets.'
        : s.stage === 'walkout' && s.walk >= 0
          ? lines[s.walk].text
          : s.banner?.startsWith('round')
            ? `Round ${s.banner.slice(5)}`
            : revealed && result && f
              ? resultLine(m, result, f.collapses.length)
              : ''

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden" data-hud={s.stage} data-post={s.post}>
      <style>{KEYFRAMES}</style>
      <div className="sr-only" aria-live="polite">
        {say}
      </div>

      {showBar && <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#030611]/70 to-transparent sm:h-36" />}

      <AnimatePresence>{s.stage === 'bets' && <Tape key={`tape${round.id}`} id={round.id} matchup={m} odds={odds} standings={standings} history={history} compact={compact || !roomy} urgent={s.count > 0} countRef={countRef} barRef={barRef} />}</AnimatePresence>

      {showBar && (
        <TopBar
          m={m}
          odds={odds}
          s={s}
          result={result}
          f={f}
          mood={mood}
          compact={compact}
          calm={calm}
          main={round.main}
        />
      )}

      {/* the banners */}
      <AnimatePresence>
        {s.banner && (
          <div key={`${round.id}:${s.banner}`} className="absolute inset-0 flex items-center justify-center">
            <Banner id={s.banner} m={m} result={f?.result ?? null} f={f} compact={compact} calm={calm} />
          </div>
        )}
      </AnimatePresence>

      {/* a special firing, on its kaiju's side */}
      <AnimatePresence>
        {beam && !s.banner && (
          <motion.div
            key={`sp${round.id}:${s.special}`}
            className={`absolute top-[26%] ${beam.who === 'a' ? 'left-[6%]' : 'right-[6%]'} sm:top-[24%]`}
            initial={calm ? { opacity: 0 } : { opacity: 0, scale: 1.8, x: beam.who === 'a' ? -30 : 30 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <SpecialName side={beam.who} id={sideId(m, beam.who)} outcome={beam.outcome} compact={compact} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* a decision: the judges' cards */}
      <AnimatePresence>{s.post === 2 && s.cards > 0 && f?.cards && <Scorecards key={`cards${round.id}`} m={m} result={f.result} cards={f.cards} shown={s.cards} compact={compact} calm={calm} />}</AnimatePresence>

      {/* the next fight, in the last seconds before its betting opens */}
      <AnimatePresence>
        {s.post === 3 && (
          <div key={`next${round.id}`} className={`absolute inset-x-0 flex justify-center px-2 ${compact ? 'top-[68px]' : 'top-[112px]'}`}>
            <Teaser id={round.id + 1} secs={s.count} compact={compact} />
          </div>
        )}
      </AnimatePresence>

      {/* the foot of the stage */}
      <div className={`absolute inset-x-0 bottom-0 flex flex-col items-center ${compact ? 'gap-1.5 px-2 pb-2' : 'gap-2.5 px-4 pb-4'}`}>
        <AnimatePresence>{revealed && settled && settled.bet > 0 && <MyResult key={`me${settled.round}`} outcome={settled} compact={compact} />}</AnimatePresence>
        <AnimatePresence mode="wait">
          {s.stage === 'walkout' && s.walk >= 0 && (
            <Caption key={`walk${round.id}:${s.walk}`} eyebrow={round.main ? '★ Main Event ★' : 'Live from Neon Bay'} text={lines[s.walk].text} who={lines[s.walk].who} gold={round.main} compact={compact} />
          )}
          {s.stage !== 'walkout' && s.post < 2 && call && showBar && <Ticker key={`call${round.id}:${s.calls}`} call={call} prev={compact ? null : prevCall} compact={compact} />}
          {s.post >= 2 && revealed && !replay && result && f && <ResultStrip key={`res${round.id}`} m={m} odds={odds} result={result} f={f} compact={compact} />}
        </AnimatePresence>
        {showBar && !f && s.stage !== 'walkout' && (
          <div className="rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-bold text-white/75 ring-1 ring-white/10">Waiting for the fight feed…</div>
        )}
      </div>
    </div>
  )
})

/* ---------------- the top bar ---------------- */

function TopBar({ m, odds, s, result, f, mood, compact, calm, main }: { m: Matchup; odds: Odds; s: Snap; result: Result | null; f: Fight | null; mood: (side: Side) => Mood; compact: boolean; calm: boolean; main: boolean }) {
  const walkout = s.stage === 'walkout'
  const showA = !walkout || s.walk >= 1
  const showB = !walkout || s.walk >= 2
  return (
    <div className={`absolute inset-x-0 top-0 grid items-start ${compact ? 'grid-cols-[1fr_auto_1fr] gap-1.5 px-2 pt-2' : 'grid-cols-[1fr_auto_1fr] gap-4 px-4 pt-3'}`}>
      <div>{showA && <Plate side="a" m={m} hp={s.hp[0]} mood={mood('a')} winner={result?.winner === 'a'} compact={compact} calm={calm} gold={main} />}</div>
      <Center s={s} result={result} f={f} line={odds.line} compact={compact} main={main} walkout={walkout} />
      <div>{showB && <Plate side="b" m={m} hp={s.hp[1]} mood={mood('b')} winner={result?.winner === 'b'} compact={compact} calm={calm} gold={main} />}</div>
    </div>
  )
}

function Plate({ side, m, hp, mood, winner, compact, calm, gold }: { side: Side; m: Matchup; hp: number; mood: Mood; winner: boolean; compact: boolean; calm: boolean; gold: boolean }) {
  const right = side === 'b'
  const id = sideId(m, side)
  const F = fighter(id)
  const c = CORNER[side]
  const shake = useRef<HTMLDivElement>(null)
  const prev = useRef(hp)
  useEffect(() => {
    if (hp < prev.current && !calm) shake.current?.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${right ? 5 : -5}px)` }, { transform: `translateX(${right ? -4 : 4}px)` }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 300, easing: 'ease-out' })
    prev.current = hp
  }, [hp, calm, right])
  return (
    <motion.div initial={calm ? { opacity: 0 } : { opacity: 0, x: right ? 60 : -60 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 26 }}>
      <div ref={shake} className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2.5'} ${right ? 'flex-row-reverse' : ''}`}>
        <div className="relative shrink-0 rounded-xl p-[2px]" style={{ background: gold ? 'linear-gradient(135deg,#ffe28a,#b07a12)' : c.color, boxShadow: winner ? `0 0 24px 2px ${F.colors.glow}` : `0 0 16px -4px ${c.color}` }}>
          <KaijuPortrait id={id} size={compact ? 34 : 54} mirror={right} mood={mood} bg className="rounded-[10px]" />
          {winner && <span className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-gold px-1 font-black uppercase tracking-wider text-[#2a1a00] ${compact ? 'text-[7px]' : 'text-[9px]'}`}>Winner</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`flex items-baseline gap-2 ${right ? 'flex-row-reverse' : ''}`}>
            <span className={`truncate font-black uppercase italic leading-none tracking-tight text-white ${compact ? 'text-[12.5px]' : 'text-[20px]'}`} style={{ textShadow: '0 2px 0 rgba(0,0,0,.6)' }}>
              {F.name}
            </span>
            {!compact && <span className="hidden truncate text-[11px] font-bold text-white/55 md:inline">{F.epithet}</span>}
          </div>
          <HealthBar hp={hp} right={right} compact={compact} />
        </div>
      </div>
    </motion.div>
  )
}

function HealthBar({ hp, right, compact }: { hp: number; right: boolean; compact: boolean }) {
  const fill = hp > 50 ? 'linear-gradient(180deg,#7dffb0,#1fc96a 55%,#10a052)' : hp > 25 ? 'linear-gradient(180deg,#ffe58a,#f5b82e 55%,#d6900e)' : 'linear-gradient(180deg,#ff9aa6,#ff4d61 55%,#d22a40)'
  const anchor = right ? { right: 0 } : { left: 0 }
  return (
    <div className={`relative mt-1 overflow-hidden rounded-[3px] bg-[#05080f]/85 ring-1 ring-white/20 ${compact ? 'h-[8px]' : 'h-[13px]'}`} style={{ transform: `skewX(${right ? 18 : -18}deg)` }} role="meter" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={100}>
      <div className="absolute inset-y-0 bg-[#ffd9de] transition-[width] delay-300 duration-700 ease-out" style={{ ...anchor, width: `${hp}%` }} />
      <div className="absolute inset-y-0 transition-[width] duration-200 ease-out" style={{ ...anchor, width: `${hp}%`, background: fill }} />
      {/* (transparent at rest: with reduced motion the flash simply never shows) */}
      {hp < 100 && <div key={hp} className="kj-anim absolute inset-0 bg-white opacity-0" style={{ animation: 'kj-flash .35s ease-out' }} />}
      <div className="absolute inset-x-0 top-0 h-[40%] bg-white/20" />
      {[25, 50, 75].map((x) => (
        <div key={x} className="absolute inset-y-0 w-px bg-black/45" style={{ left: `${x}%` }} />
      ))}
      {!compact && <span className={`tnum absolute inset-y-0 flex items-center text-[9.5px] font-black text-white [text-shadow:0_1px_2px_rgba(0,0,0,.9)] ${right ? 'left-1.5' : 'right-1.5'}`}>{Math.round(hp)}</span>}
    </div>
  )
}

function Center({ s, result, f, line, compact, main, walkout }: { s: Snap; result: Result | null; f: Fight | null; line: number; compact: boolean; main: boolean; walkout: boolean }) {
  const over = !!result
  const label = over ? (result!.method === 'dec' ? 'Decision' : `Round ${result!.round}`) : s.over ? 'The judges' : walkout ? 'Tonight' : s.brk ? (s.rnd === 1 ? 'Round 1' : `Round ${s.rnd} next`) : `Round ${s.rnd}`
  return (
    <div className="flex flex-col items-center gap-1">
      {main && !compact && <span className="rounded bg-gold px-1.5 text-[9px] font-black uppercase tracking-[.18em] text-[#2a1a00]">Main Event</span>}
      <div className={`flex flex-col items-center rounded-xl text-center ring-1 backdrop-blur-sm ${main ? 'bg-[#1f1604]/85 ring-gold/50' : 'bg-[#060b1a]/85 ring-white/15'} ${compact ? 'min-w-[58px] px-2 py-0.5' : 'min-w-[96px] px-3 py-1'}`}>
        <span className={`font-black uppercase tracking-[.14em] text-white/55 ${compact ? 'text-[7.5px]' : 'text-[10px]'}`}>{label}</span>
        {over ? (
          <span className={`flex items-center gap-1 font-black uppercase italic leading-none ${compact ? 'text-[15px]' : 'text-[24px]'}`} style={{ color: METHOD_COLOR[result!.method] }}>
            <MethodMark method={result!.method} size={compact ? 13 : 20} />
            {result!.method === 'ko' ? 'KO' : result!.method === 'splash' ? 'Splash' : 'Dec'}
          </span>
        ) : walkout || s.over ? (
          <span className={`font-black italic leading-none text-white ${compact ? 'text-[15px]' : 'text-[24px]'}`}>{s.over ? '…' : 'VS'}</span>
        ) : (
          <span className={`tnum font-black leading-none ${s.brk ? 'text-white/60' : 'text-white'} ${compact ? 'text-[16px]' : 'text-[26px]'}`}>{s.clock || '0:10'}</span>
        )}
        {over && !compact && f && f.endsAt < FIGHT_MS && <span className="tnum text-[9.5px] font-bold text-white/50">{finishText(f.endsAt)}</span>}
      </div>
      <Buildings fallen={s.fallen} line={line} compact={compact} />
    </div>
  )
}

function Buildings({ fallen, line, compact }: { fallen: number; line: number; compact: boolean }) {
  const over = fallen > line
  return (
    <div
      className={`tnum flex items-center gap-1 rounded-full font-black ring-1 transition-colors duration-500 ${compact ? 'px-1.5 py-[1px] text-[9.5px]' : 'px-2.5 py-0.5 text-[12px]'} ${over ? 'bg-gold text-[#2a1a00] ring-gold' : 'bg-[#060b1a]/80 text-white ring-white/15'}`}
      title={`Buildings flattened: ${fallen} (line ${line})`}
    >
      <BuildingMark size={compact ? 10 : 13} />
      {fallen}
      <span className={over ? 'text-[#2a1a00]/70' : 'text-white/45'}>/ {line}</span>
      {over && !compact && <span className="ml-0.5 text-[9px] uppercase tracking-wider">Over</span>}
    </div>
  )
}

/* ---------------- banners ---------------- */

/** a word with a thick ink outline and a gradient fill */
function Word({ children, fill, stroke = '#12060c', sw, className = '', style }: { children: ReactNode; fill: string; stroke?: string; sw: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`relative inline-block ${className}`} style={style}>
      <span aria-hidden className="absolute inset-0" style={{ WebkitTextStroke: `${sw}px ${stroke}`, color: stroke, filter: 'drop-shadow(0 6px 0 rgba(0,0,0,.45))' }}>
        {children}
      </span>
      <span className="relative" style={{ backgroundImage: fill, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
        {children}
      </span>
    </span>
  )
}

const FILL = {
  white: 'linear-gradient(180deg,#ffffff 0%,#e8eef7 55%,#b9c6d8 100%)',
  fight: 'linear-gradient(180deg,#fff6c2 0%,#ffcf3d 38%,#ff7a1f 70%,#e8262f 100%)',
  ko: 'linear-gradient(180deg,#fff4c4 0%,#ffd23d 30%,#ff5a2a 64%,#c8102e 100%)',
  splash: 'linear-gradient(180deg,#f2feff 0%,#8ff0ff 34%,#2fb7ff 66%,#1a5fd6 100%)',
  gold: 'linear-gradient(180deg,#fffbe0 0%,#ffd84a 45%,#f39b12 100%)',
  red: 'linear-gradient(180deg,#ffe0e4 0%,#ff6b7d 50%,#d4203a 100%)',
}

function Banner({ id, m, result, f, compact, calm }: { id: string; m: Matchup; result: Result | null; f: Fight | null; compact: boolean; calm: boolean }) {
  const slam = calm ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { opacity: 0, scale: 2.4 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.9, transition: { duration: 0.18 } } }
  const slide = calm ? slam : { initial: { opacity: 0, x: -80 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 80, transition: { duration: 0.2 } } }
  const ribbon = (children: ReactNode, tone: string, sub?: string) => (
    <motion.div className="flex w-full flex-col items-center" {...slide} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
      <div className={`flex w-full flex-col items-center ${compact ? 'py-1.5' : 'py-3'}`} style={{ background: `linear-gradient(90deg, transparent, ${tone} 22%, ${tone} 78%, transparent)` }}>
        {children}
        {sub && <span className={`mt-1 font-bold text-white/80 ${compact ? 'text-[11px]' : 'text-[14px]'}`}>{sub}</span>}
      </div>
    </motion.div>
  )
  const big = compact ? 'text-[34px]' : 'text-[64px]'
  if (id === 'nomore') return ribbon(<Word fill={FILL.white} sw={compact ? 5 : 8} className={`font-black uppercase italic tracking-tight ${compact ? 'text-[24px]' : 'text-[44px]'}`}>No more bets</Word>, 'rgba(160,20,44,.82)')
  if (id.startsWith('round')) {
    const k = Number(id.slice(5))
    return ribbon(<Word fill={FILL.white} sw={compact ? 6 : 9} className={`font-black uppercase italic tracking-tight ${big}`}>Round {k}</Word>, 'rgba(6,11,26,.82)', roundLine(k, m))
  }
  if (id.startsWith('end')) return ribbon(<Word fill={FILL.white} sw={compact ? 4 : 7} className={`font-black uppercase italic tracking-tight ${compact ? 'text-[20px]' : 'text-[36px]'}`}>End of round {id.slice(3)}</Word>, 'rgba(6,11,26,.72)')
  if (id.startsWith('bell'))
    return (
      <motion.div {...slam} transition={{ type: 'spring', stiffness: 460, damping: 15 }}>
        <Word fill={FILL.fight} sw={compact ? 7 : 12} className={`font-black uppercase italic tracking-tight ${compact ? 'text-[48px]' : 'text-[96px]'}`} style={{ transform: 'rotate(-4deg)' }}>
          Fight!
        </Word>
      </motion.div>
    )
  if (id === 'final')
    return ribbon(<Word fill={FILL.gold} sw={compact ? 5 : 8} className={`font-black uppercase italic tracking-tight ${compact ? 'text-[24px]' : 'text-[48px]'}`}>That's the fight!</Word>, 'rgba(26,18,4,.85)', "Over to the judges' scorecards")
  if (id === 'finish' && result) {
    const splash = result.method === 'splash'
    return (
      <motion.div className="flex flex-col items-center px-3 text-center" {...slam} transition={{ type: 'spring', stiffness: 420, damping: 13 }}>
        <Word fill={splash ? FILL.splash : FILL.ko} sw={compact ? 8 : 14} stroke={splash ? '#04142b' : '#1a0508'} className={`font-black uppercase italic tracking-tighter ${compact ? 'text-[60px]' : 'text-[124px]'} leading-none`} style={{ transform: 'rotate(-5deg)' }}>
          {splash ? 'Splash!' : 'K.O.!'}
        </Word>
        <motion.span
          className={`mt-2 w-max rounded-full bg-black/65 px-4 py-1.5 font-black text-white ring-1 ring-white/10 ${compact ? 'max-w-[86vw] text-[12px]' : 'max-w-[680px] text-[17px]'}`}
          initial={calm ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          {resultLine(m, result, f?.collapses.length ?? 0).replace(/^[A-Z]+! /, '')}
        </motion.span>
      </motion.div>
    )
  }
  return null
}

function SpecialName({ side, id, outcome, compact }: { side: Side; id: ReturnType<typeof sideId>; outcome: Beam['outcome']; compact: boolean }) {
  const F = fighter(id)
  const g = F.colors.glow
  return (
    <div className={`flex flex-col ${side === 'b' ? 'items-end' : 'items-start'}`}>
      <span className={`font-black uppercase tracking-[.2em] text-white/70 ${compact ? 'text-[8px]' : 'text-[10px]'}`}>{F.name}'s special</span>
      <Word fill={`linear-gradient(180deg,#ffffff 0%, ${g} 60%)`} sw={compact ? 4 : 6} stroke="#060814" className={`font-black uppercase italic tracking-tight ${compact ? 'text-[18px]' : 'text-[32px]'}`} style={{ filter: `drop-shadow(0 0 14px ${g})` }}>
        {F.special}!
      </Word>
      {outcome && outcome !== 'land' && <span className={`rounded bg-black/60 px-1.5 font-black uppercase tracking-wider text-white/80 ${compact ? 'text-[8px]' : 'text-[10px]'}`}>{outcome === 'miss' ? 'Missed' : 'Blocked'}</span>}
    </div>
  )
}

/* ---------------- the foot of the stage ---------------- */

function Caption({ eyebrow, text, who, gold, compact }: { eyebrow: string; text: string; who: Side | null; gold: boolean; compact: boolean }) {
  return (
    <motion.div
      className={`flex max-w-[94%] flex-col items-center rounded-2xl text-center ring-1 backdrop-blur-sm ${gold ? 'bg-[#1f1604]/85 ring-gold/40' : 'bg-[#060b1a]/85 ring-white/10'} ${compact ? 'px-3 py-1.5' : 'px-6 py-2.5'}`}
      style={who ? { boxShadow: `0 0 34px -10px ${CORNER[who].color}` } : undefined}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
    >
      <span className={`flex items-center gap-1.5 font-black uppercase tracking-[.2em] ${gold ? 'text-gold' : 'text-white/55'} ${compact ? 'text-[8.5px]' : 'text-[10.5px]'}`}>
        <span className="kj-anim h-1.5 w-1.5 rounded-full bg-danger" style={{ animation: 'kj-live 1.2s ease-in-out infinite' }} />
        {eyebrow}
      </span>
      <span className={`font-black italic text-white ${compact ? 'text-[13px] leading-snug' : 'text-[20px] leading-tight'}`}>{text}</span>
    </motion.div>
  )
}

function Ticker({ call, prev, compact }: { call: Call; prev: Call | null; compact: boolean }) {
  return (
    <motion.div className="flex max-w-[96%] flex-col items-center gap-1" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2 }}>
      {prev && <div className="max-w-full truncate rounded-md bg-black/35 px-2.5 py-0.5 text-[11.5px] font-bold text-white/45">{prev.text}</div>}
      <div className={`flex max-w-full items-center gap-2 rounded-xl bg-[#060b1a]/85 ring-1 ring-white/10 backdrop-blur-sm ${compact ? 'px-2 py-1' : 'px-3 py-1.5'}`}>
        <span className="h-4 w-1 shrink-0 rounded-full sm:h-5" style={{ background: CORNER[call.who].color }} />
        <span className={`font-extrabold text-white ${compact ? 'line-clamp-2 text-[11.5px] leading-tight' : 'truncate text-[15px]'}`}>{call.text}</span>
      </div>
    </motion.div>
  )
}

function ResultStrip({ m, odds, result, f, compact }: { m: Matchup; odds: Odds; result: Result; f: Fight; compact: boolean }) {
  const hits: Sel[] = hitsOf(result, odds.line)
  const rc = useMemo(() => recapOf(f), [f])
  const W = fighter(sideId(m, result.winner))
  const how = result.method === 'dec' && f.cards ? judgesLine(m, result, f.cards) : `${result.method === 'ko' ? 'Knockout' : 'Splash'} at ${finishText(f.endsAt)}`
  return (
    <motion.div
      className={`flex max-w-[98%] flex-col items-center rounded-2xl bg-[#060b1a]/85 text-center ring-1 ring-white/10 backdrop-blur-sm ${compact ? 'px-2.5 py-1.5' : 'px-5 py-2.5'}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      <div className={`flex items-center gap-2 font-black text-white ${compact ? 'text-[13px]' : 'text-[18px]'}`}>
        <MethodMark method={result.method} size={compact ? 15 : 20} />
        <span className="truncate">
          {W.name} wins{result.method === 'ko' ? ' by knockout' : result.method === 'splash' ? ' by Splash' : ' on the cards'}
        </span>
      </div>
      <div className={`font-semibold text-white/60 ${compact ? 'text-[10px]' : 'text-[12px]'}`}>
        {how}
        {!compact && (
          <>
            {' · '}blows landed {rc.landed.a}–{rc.landed.b}
            {rc.downs.a + rc.downs.b > 0 ? ` · knockdowns ${rc.downs.a}–${rc.downs.b}` : ''}
          </>
        )}
      </div>
      <div className={`mt-1.5 flex flex-wrap justify-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
        {hits.map((sel) => (
          <span key={sel} className={`tnum flex items-center gap-1 rounded-full bg-gold/15 font-bold text-gold ring-1 ring-gold/35 ${compact ? 'px-1.5 py-[1px] text-[9.5px]' : 'px-2 py-0.5 text-[11.5px]'}`}>
            {selName(sel, m)}
            {sel.startsWith('dmg') && <span className="text-gold/70">({result.damage})</span>}
            <span className="text-white/80">{odds.mult[sel].toFixed(2)}×</span>
          </span>
        ))}
      </div>
    </motion.div>
  )
}

function Scorecards({ m, result, cards, shown, compact, calm }: { m: Matchup; result: Result; cards: [number, number][]; shown: number; compact: boolean; calm: boolean }) {
  const kind = decisionKind(cards, result.winner)
  const W = fighter(sideId(m, result.winner))
  return (
    <motion.div className="absolute inset-x-0 top-[22%] flex justify-center px-2 sm:top-[24%]" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
      <div className={`rounded-2xl bg-[#140f04]/90 text-center ring-1 ring-gold/40 backdrop-blur ${compact ? 'px-2.5 py-2' : 'px-5 py-3.5'}`} style={{ boxShadow: '0 0 60px -20px rgba(247,197,72,.7)' }}>
        <div className={`font-black uppercase tracking-[.2em] text-gold ${compact ? 'text-[9px]' : 'text-[11px]'}`}>The judges' scorecards</div>
        <div className={`mt-2 flex ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
          {cards.map((c, i) => {
            const open = shown > i
            const lead: Side | null = c[0] > c[1] ? 'a' : c[1] > c[0] ? 'b' : null
            return (
              <div
                key={i}
                className={`flex flex-col items-center rounded-xl transition-colors duration-300 ${open ? 'bg-[#fff8e6] text-[#1d1608]' : 'bg-[#fff8e6]/45 text-[#1d1608]'} ${compact ? 'w-[84px] px-1.5 py-1' : 'w-[128px] px-2.5 py-2'}`}
              >
                <span className={`font-black uppercase tracking-wider text-[#6b5a2c] ${compact ? 'text-[7.5px]' : 'text-[9.5px]'}`}>{JUDGES[i]}</span>
                {open ? (
                  <motion.span
                    className={`tnum flex items-center gap-1 font-black ${compact ? 'text-[16px]' : 'text-[24px]'}`}
                    initial={calm ? { opacity: 0 } : { opacity: 0, scale: 1.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 20 }}
                  >
                    <span style={{ color: lead === 'a' ? CORNER.a.color : undefined }}>{c[0]}</span>
                    <span className="text-[#9a8a60]">–</span>
                    <span style={{ color: lead === 'b' ? CORNER.b.color : undefined }}>{c[1]}</span>
                  </motion.span>
                ) : (
                  <span className={`font-black text-[#c9b88a] ${compact ? 'text-[16px]' : 'text-[24px]'}`}>?</span>
                )}
                <span className={`truncate font-bold text-[#6b5a2c] ${compact ? 'text-[8px]' : 'text-[10px]'}`}>{open ? (lead ? fighter(sideId(m, lead)).name : 'Even') : ' '}</span>
              </div>
            )
          })}
        </div>
        <AnimatePresence>
          {shown >= 4 && (
            <motion.div className={`mt-2 font-black uppercase italic text-white ${compact ? 'text-[14px]' : 'text-[22px]'}`} initial={calm ? { opacity: 0 } : { opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 18 }}>
              <span className="text-gold">{kind} decision</span> · {W.name}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function Teaser({ id, secs, compact }: { id: number; secs: number; compact: boolean }) {
  const m = matchupOf(id)
  const o = oddsOf(m.a, m.b)
  return (
    <motion.div
      className={`flex items-center rounded-2xl ring-1 backdrop-blur-sm ${m.main ? 'bg-[#1f1604]/88 ring-gold/45' : 'bg-[#060b1a]/88 ring-white/12'} ${compact ? 'gap-2 px-2.5 py-1.5' : 'gap-3 px-4 py-2'}`}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      <span className={`font-black uppercase leading-tight tracking-[.16em] ${m.main ? 'text-gold' : 'text-white/55'} ${compact ? 'text-[8px]' : 'text-[10px]'}`}>
        {m.main ? 'Main Event' : 'Next fight'}
        <br />
        <span className="tnum text-white/80">bets in {secs}s</span>
      </span>
      {(['a', 'b'] as Side[]).map((x) => (
        <span key={x} className="contents">
          {x === 'b' && <span className={`font-black italic text-white/50 ${compact ? 'text-[11px]' : 'text-[14px]'}`}>vs</span>}
          <span className={`flex items-center gap-1.5 ${x === 'b' ? 'flex-row-reverse text-right' : ''}`}>
            <KaijuPortrait id={sideId(m, x)} size={compact ? 26 : 36} mirror={x === 'b'} mood="fierce" bg className="rounded-lg" />
            <span className="flex flex-col leading-tight">
              <span className={`font-black text-white ${compact ? 'text-[11px]' : 'text-[14px]'}`}>{fighter(sideId(m, x)).name}</span>
              <span className={`tnum font-bold text-white/55 ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{o.mult[`win:${x}` as Sel].toFixed(2)}×</span>
            </span>
          </span>
        </span>
      ))}
    </motion.div>
  )
}
