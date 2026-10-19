import { memo, useEffect, useRef, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ATTRACTIONS, N_ATTR, autoRate, costOf, cyclePay, cycleTime, fmtCash, hasPerk, managerCost, maxAffordable, nextStep, payMult, rateOf, starsOnSale, type Save } from './engine'
import { AttractionIcon, CashIcon, ManagerFace, StarIcon } from './art'
import { CycleBar, sameBut } from './kit'
import { ACCENT, MANAGERS, cycleWord, lastStep } from './words'

/*
  The Floor tab: every attraction, in the engine's order. An open one shows its count (and how far to its next count
  step), its round (a bar that fills; without a manager a Run button, as tapping it on the floor does, and holding it
  runs round after round), what a round pays, the buy button for the amount chosen at the top (×1, ×10, ×100 or
  Max) with what that adds a second, and its manager. The open attraction that pays back its price soonest, counting
  the wait for the Cash, wears a "Best buy" tag. One not open yet shows what it would pay and its price. Above them:
  the amount, and a line saying what to do next.

  Three layouts: a wide screen's rows (the panel beside the floor); a tablet's, the same rows two to a line; and a
  phone's compact rows, about half as tall, so the sheet under the floor shows several: the icon (with its count, a
  ring filling to the next step, and its manager's face once hired) runs the attraction when tapped, the round bar
  is a big target, and the buy button holds the price and the gain.

  The page draws a few times a second, so each row is memoised on plain values: a row is drawn again only when
  something it shows changed.
*/

export type BuyMode = 1 | 10 | 100 | 'max'
export const BUY_MODES: BuyMode[] = [1, 10, 100, 'max']
export type Layout = 'phone' | 'tablet' | 'wide'

/** how many a press of the buy button buys in this mode (Max: as many as the Cash covers, at least one to show) */
export const buyCount = (s: Save, i: number, mode: BuyMode) => (mode === 'max' ? Math.max(1, maxAffordable(s, i)) : mode)

/** the casino's Cash a second with every attraction running non-stop */
function fullRate(s: Save) {
  let r = 0
  for (let i = 0; i < N_ATTR; i++) r += rateOf(s, i)
  return r
}

/** what buying k more of attraction i adds a second, over the whole casino (its count steps and the all-steps too) */
function gainOf(s: Save, i: number, k: number, base: number) {
  const owned = s.owned.slice()
  owned[i] += k
  return fullRate({ ...s, owned }) - base
}

/**
 * The open attraction whose next one pays back soonest, counting the wait for the Cash (what tools/tycoon-sim.ts's
 * player buys): among the managed ones once there are some, as only they earn on their own. -1 with fewer than two
 * to choose from.
 */
function bestBuy(s: Save, base: number) {
  const managed = s.managers.some((m, i) => m && s.owned[i] > 0)
  const income = managed ? autoRate(s) : base
  let best = -1
  let bestT = Infinity
  let n = 0
  for (let i = 0; i < N_ATTR; i++) {
    if (!s.owned[i] || (managed && !s.managers[i])) continue
    n++
    const cost = costOf(s, i, 1)
    const gain = gainOf(s, i, 1, base)
    if (gain <= 0) continue
    const wait = cost <= s.cash ? 0 : income > 0 ? (cost - s.cash) / income : Infinity
    const t = wait + cost / gain
    if (t < bestT) {
      bestT = t
      best = i
    }
  }
  return n >= 2 && Number.isFinite(bestT) ? best : -1
}

/** the one thing worth doing next, for a new player and anyone wondering: what it is, for which attraction, and
 *  the sum in it (plain values, so the line is drawn again only when it changes) */
interface Goal {
  kind: 'open' | 'run' | 'hire' | 'next' | 'sell'
  i: number
  sum: string
}

function nextGoal(s: Save): Goal | null {
  const open = s.owned.map((n) => n > 0)
  if (!open[0]) return { kind: 'open', i: 0, sum: '' }
  if (!s.managers.some(Boolean)) return { kind: 'run', i: 0, sum: fmtCash(managerCost(s, 0)) }
  const firstShut = open.indexOf(false)
  const unmanaged = s.managers.findIndex((m, i) => !m && open[i])
  if (unmanaged >= 0 && managerCost(s, unmanaged) <= s.cash * 4) return { kind: 'hire', i: unmanaged, sum: fmtCash(managerCost(s, unmanaged)) }
  if (firstShut >= 0) return { kind: 'next', i: firstShut, sum: fmtCash(costOf(s, firstShut, 1)) }
  const add = starsOnSale(s)
  if (add > 0 && add >= Math.max(5, s.stars)) return { kind: 'sell', i: -1, sum: add.toLocaleString('en-US') }
  return null
}

/** the goal's line: a card on a wide screen, one short line on a phone */
const GoalLine = memo(function GoalLine({ kind, i, sum, phone }: Goal & { phone: boolean }) {
  const icon = kind === 'run' || kind === 'hire' ? <ManagerFace i={i} size={30} /> : kind === 'sell' ? <StarIcon size={26} /> : <AttractionIcon i={i} size={30} />
  const W = (x: ReactNode) => <b className="text-white">{x}</b>
  const text = {
    open: <>Open your first Claw Machine: every round it plays pays Cash.</>,
    run: (
      <>
        Tap {W('Run')} (or hold it, or tap the machine on the floor) to play rounds. At {W(sum)} Cash, hire {MANAGERS[0].name} to run it for you, even while you're away.
      </>
    ),
    hire: (
      <>
        Hire {MANAGERS[i]?.name} ({sum}) and the {ATTRACTIONS[i]?.name} runs itself.
      </>
    ),
    next: (
      <>
        Next to open: the {ATTRACTIONS[i]?.name}, for {sum} Cash.
      </>
    ),
    sell: <>Selling now brings {sum} Stars, more than you hold. Have a look in the Stars tab.</>,
  }[kind]
  const short = {
    open: 'Open a Claw Machine to start earning',
    run: `Tap or hold Run · hire ${MANAGERS[0].name} at ${sum}`,
    hire: `Hire ${MANAGERS[i]?.name} for ${sum}`,
    next: `Next: the ${ATTRACTIONS[i]?.name}, ${sum}`,
    sell: `Selling brings ${sum} Stars: see Stars`,
  }[kind]
  return phone ? (
    <div className="flex h-9 items-center gap-2 rounded-xl bg-[#3fc96a]/[.08] px-2 text-[12px] font-bold text-muted ring-1 ring-[#3fc96a]/20">
      <span className="flex shrink-0 scale-[.8]">{icon}</span>
      <span className="min-w-0 truncate">{short}</span>
    </div>
  ) : (
    <div className="flex items-center gap-2.5 rounded-xl bg-[#3fc96a]/[.08] px-2.5 py-2 text-[12.5px] font-semibold leading-snug text-muted ring-1 ring-[#3fc96a]/20">
      <span className="flex shrink-0">{icon}</span>
      <span className="min-w-0 text-pretty">{text}</span>
    </div>
  )
})

type Buy = (i: number, k: number, at: DOMRect) => void

export function FloorTab({
  s,
  boost,
  mode,
  onMode,
  selected,
  reveal,
  runs,
  layout,
  onBuy,
  onRun,
  onHold,
  onHire,
  onSelect,
}: {
  s: Save
  /** the whale's boost on pay right now (1 without one) */
  boost: number
  mode: BuyMode
  onMode: (m: BuyMode) => void
  selected: number
  /** changes when the floor picked `selected`: its row scrolls into view */
  reveal: number
  /** each attraction's count of rounds started by hand (a new one restarts its bar) */
  runs: number[]
  layout: Layout
  onBuy: Buy
  onRun: (i: number) => void
  /** a Run held down (true) or let go (false): rounds start one after another while it is held */
  onHold: (i: number, on: boolean) => void
  onHire: (i: number) => void
  onSelect: (i: number) => void
}) {
  const phone = layout === 'phone'
  const goal = nextGoal(s)
  // on a phone the tip is one line, and only until the first manager: the rows say the rest
  const tip = phone ? (s.managers.some(Boolean) ? null : goal) : goal
  const base = fullRate(s)
  const best = bestBuy(s, base)
  return (
    <div className="flex flex-col gap-2">
      <ModeBar mode={mode} onMode={onMode} phone={phone} />
      <AnimatePresence initial={false}>
        {tip && (
          <motion.div key="goal" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <GoalLine kind={tip.kind} i={tip.i} sum={tip.sum} phone={phone} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className={layout === 'tablet' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'}>
        {Array.from({ length: N_ATTR }, (_, i) => {
          const n = s.owned[i]
          if (!n) {
            const cost = costOf(s, i, 1)
            return (
              <ForSale
                key={i}
                i={i}
                cost={fmtCash(cost)}
                can={cost <= s.cash}
                pay={fmtCash(ATTRACTIONS[i].pay * payMult(s, i))}
                every={cycleWord(ATTRACTIONS[i].time / (hasPerk(s.stars, 4) ? 2 : 1))}
                next={s.owned.indexOf(0) === i}
                selected={selected === i}
                reveal={selected === i ? reveal : 0}
                phone={phone}
                onBuy={onBuy}
                onSelect={onSelect}
              />
            )
          }
          const k = buyCount(s, i, mode)
          const cost = costOf(s, i, k)
          const step = nextStep(s, i)
          const gain = gainOf(s, i, k, base) * boost
          const hire = managerCost(s, i)
          const props: RowProps = {
            i,
            n,
            managed: s.managers[i],
            running: s.running[i],
            T: cycleTime(s, i),
            progress: s.progress[i],
            pay: fmtCash(cyclePay(s, i) * boost),
            rate: fmtCash(rateOf(s, i) * boost),
            k,
            cost: fmtCash(cost),
            can: cost <= s.cash,
            gain: gain > 0 ? fmtCash(gain) : '',
            best: best === i,
            stepAt: step.at,
            stepWhat: step.what,
            from: lastStep(n),
            hire: fmtCash(hire),
            canHire: hire <= s.cash,
            boosted: boost > 1,
            selected: selected === i,
            reveal: selected === i ? reveal : 0,
            epoch: runs[i],
            onBuy,
            onRun,
            onHold,
            onHire,
            onSelect,
          }
          return phone ? <Compact key={i} {...props} /> : <Row key={i} {...props} />
        })}
      </div>
    </div>
  )
}

/** the amount the buy buttons buy: ×1, ×10, ×100 or Max */
const ModeBar = memo(function ModeBar({ mode, onMode, phone }: { mode: BuyMode; onMode: (m: BuyMode) => void; phone: boolean }) {
  return (
    <div className="sticky top-0 z-10 -mx-3 bg-panel/95 px-3 pb-2 pt-0.5 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] font-extrabold uppercase tracking-wider text-dim">Buy</span>
        <div role="radiogroup" aria-label="How many to buy" className="flex flex-1 rounded-full bg-stage p-1">
          {BUY_MODES.map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => onMode(m)}
              className={`relative flex-1 rounded-full font-black transition-colors ${phone ? 'h-9 text-[13px]' : 'h-8 text-[12.5px]'} ${mode === m ? 'text-[#032412]' : 'text-muted hover:text-ink'}`}
            >
              {mode === m && <motion.span layoutId="ty-buy-mode" layoutDependency={mode} className="absolute inset-0 rounded-full bg-[#3fc96a] shadow-[inset_0_-2px_0_rgba(0,0,0,.15)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span className="relative">{m === 'max' ? 'Max' : `×${m}`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})

/** scrolls `el` into view when `reveal` changes (and isn't 0) */
function useReveal(reveal: number) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [reveal])
  return ref
}

/** what a row shows, all plain values (Cash already in words), so a memoised row knows when it changed */
interface RowProps {
  i: number
  n: number
  managed: boolean
  running: boolean
  /** seconds a round, and where the round stands (read as its bar mounts; a later change doesn't redraw the row) */
  T: number
  progress: number
  pay: string
  rate: string
  /** the buy button: how many, their price, whether the Cash covers it, what they add a second, the best buy */
  k: number
  cost: string
  can: boolean
  gain: string
  best: boolean
  /** the next count step, what it brings, and the last one reached */
  stepAt: number
  stepWhat: string
  from: number
  hire: string
  canHire: boolean
  boosted: boolean
  selected: boolean
  reveal: number
  epoch: number
  onBuy: Buy
  onRun: (i: number) => void
  onHold: (i: number, on: boolean) => void
  onHire: (i: number) => void
  onSelect: (i: number) => void
}

/** a press on an unmanaged attraction (its Run bar, or its icon on a phone): runs a round, and holding it down runs
 *  round after round */
const runPress = (i: number, onRun: (i: number) => void, onHold: (i: number, on: boolean) => void) => ({
  onClick: (e: RMouseEvent) => {
    e.stopPropagation()
    onRun(i)
  },
  onPointerDown: (e: RPointerEvent) => {
    if (e.button === 0) onHold(i, true)
  },
  onPointerUp: () => onHold(i, false),
  onPointerLeave: () => onHold(i, false),
  onPointerCancel: () => onHold(i, false),
  onContextMenu: (e: RMouseEvent) => e.preventDefault(),
})

/** the round's bar: a manager's loops; without one it is the Run button (`tall`: a phone's) */
function RoundBar({ p, tall }: { p: RowProps; tall: boolean }) {
  const color = p.boosted ? '#f2b230' : ACCENT[p.i]
  const h = tall ? 'h-9' : 'h-8'
  if (p.managed)
    return (
      <CycleBar seconds={p.T} progress={p.progress} on loop epoch={0} color={color} className={h}>
        <span className="tnum flex items-center gap-1">
          <CashIcon size={13} />+{p.pay}
        </span>
        <span className="tnum text-white/75">{cycleWord(p.T)}</span>
      </CycleBar>
    )
  return (
    <button
      {...runPress(p.i, p.onRun, p.onHold)}
      aria-label={`Run the ${ATTRACTIONS[p.i].name}`}
      className="group relative block w-full touch-manipulation select-none rounded-lg text-left [-webkit-touch-callout:none]"
    >
      <CycleBar seconds={p.T} progress={p.progress} on={p.running} loop={false} epoch={p.epoch} color={color} className={`${h} ${p.running ? '' : 'ring-2 ring-white/70'}`}>
        {p.running ? (
          <>
            <span className="tnum flex items-center gap-1">
              <CashIcon size={13} />+{p.pay}
            </span>
            <span className="tnum text-white/75">{cycleWord(p.T)}</span>
          </>
        ) : (
          <>
            <span className="ty-motion flex items-center gap-1.5" style={{ animation: 'ty-breathe 1.4s ease-in-out infinite' }}>
              <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden>
                <path d="M1.5 1.2v9.6L10 6Z" fill="#fff" />
              </svg>
              {/* (a narrow phone row keeps the arrow and the pay: the word goes first) */}
              <span className={tall ? 'hidden @min-[170px]:inline' : ''}>Run</span>
            </span>
            <span className="tnum flex min-w-0 items-center gap-1 truncate">
              {/* (a phone's bar shares its line with the Hire button: the Cash note stays off it) */}
              {!tall && <CashIcon size={13} />}+{p.pay}
              {!tall && <> · {cycleWord(p.T)}</>}
            </span>
          </>
        )}
      </CycleBar>
    </button>
  )
}

/** "Best buy": on the buy button of the row that pays back soonest */
const BestTag = () => <span className="absolute -top-2 right-1.5 rounded-full bg-[#ffe08a] px-1.5 py-px text-[9.5px] font-black uppercase leading-tight tracking-wide text-[#3a2400] shadow-[0_2px_6px_rgba(0,0,0,.35)]">Best buy</span>

/** a wide screen's (and a tablet's) row */
const Row = memo(function Row(p: RowProps) {
  const ref = useReveal(p.reveal)
  const a = ATTRACTIONS[p.i]
  const toStep = (p.n - p.from) / (p.stepAt - p.from)
  return (
    <div
      ref={ref}
      onClick={() => p.onSelect(p.i)}
      className={`relative flex gap-2.5 rounded-2xl p-2.5 transition-[box-shadow,background-color] ${p.selected ? 'bg-raised/70 shadow-[inset_0_0_0_2px_rgba(247,197,72,.75)]' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]'}`}
    >
      <div className="flex w-[58px] shrink-0 flex-col items-center">
        <div className="relative">
          <AttractionIcon i={p.i} size={56} />
          <Count n={p.n} />
        </div>
        <div className="mt-3 w-full" title={`${p.n} of ${p.stepAt}: ${p.stepWhat} at ${p.stepAt}`}>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
            <div className="h-full origin-left rounded-full transition-transform duration-500" style={{ background: ACCENT[p.i], transform: `scaleX(${Math.max(0.04, toStep)})` }} />
          </div>
          <div className="tnum mt-0.5 text-center text-[10px] font-bold leading-tight text-dim">
            {p.n}/{p.stepAt}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[14px] font-extrabold text-ink">{a.name}</span>
          <span className="tnum min-w-0 flex-1 truncate text-[11.5px] font-bold text-dim" title={`At ${p.stepAt}: ${p.stepWhat}`}>
            {p.stepAt} → {p.stepWhat}
          </span>
          {p.managed && <span className={`tnum shrink-0 text-[12px] font-extrabold ${p.boosted ? 'text-gold' : 'text-[#5fe39a]'}`}>+{p.rate}/s</span>}
        </div>

        <RoundBar p={p} tall={false} />

        <div className="flex gap-1.5">
          <BuyButton i={p.i} k={p.k} cost={p.cost} can={p.can} gain={p.gain} best={p.best} onBuy={p.onBuy} />
          {p.managed ? (
            <div className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-sky/10 pl-0.5 pr-2 text-[11.5px] font-extrabold text-sky ring-1 ring-sky/20" title={`${MANAGERS[p.i].name} runs it`}>
              <ManagerFace i={p.i} size={28} />
              Auto
            </div>
          ) : (
            <motion.button
              whileTap={p.canHire ? { scale: 0.95 } : undefined}
              onClick={(e) => {
                e.stopPropagation()
                p.onHire(p.i)
              }}
              disabled={!p.canHire}
              title={`Hire ${MANAGERS[p.i].name} to run it on their own`}
              className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-sky px-2 text-[11.5px] font-black text-[#03233a] shadow-[inset_0_-2px_0_rgba(0,0,0,.15)] transition hover:brightness-110 disabled:bg-white/[.05] disabled:text-white/35 disabled:shadow-none"
            >
              Hire
              <span className="tnum">{p.hire}</span>
            </motion.button>
          )}
        </div>
      </div>
    </div>
  )
}, sameBut<RowProps>('progress'))

/** a phone's row: icon (tap: run) · name and round · the buy button */
const Compact = memo(function Compact(p: RowProps) {
  const ref = useReveal(p.reveal)
  const a = ATTRACTIONS[p.i]
  const toStep = Math.max(0.03, (p.n - p.from) / (p.stepAt - p.from))
  const icon = (
    <>
      <StepRing f={toStep} color={ACCENT[p.i]} />
      <span className="absolute inset-[5px]">
        <AttractionIcon i={p.i} size={42} />
      </span>
      <Count n={p.n} small />
      {p.managed && (
        <span className="absolute -right-1 -top-1 overflow-hidden rounded-full bg-sky/30 ring-2 ring-panel2">
          <ManagerFace i={p.i} size={20} />
        </span>
      )}
    </>
  )
  return (
    <div
      ref={ref}
      onClick={() => p.onSelect(p.i)}
      className={`relative flex items-stretch gap-2 rounded-2xl p-2 transition-[box-shadow,background-color] ${p.selected ? 'bg-raised/70 shadow-[inset_0_0_0_2px_rgba(247,197,72,.75)]' : 'bg-panel2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]'}`}
    >
      {p.managed ? (
        <div className="relative h-[52px] w-[52px] shrink-0 self-center" title={`${p.n} of ${p.stepAt}: ${p.stepWhat} at ${p.stepAt}`}>
          {icon}
        </div>
      ) : (
        <button {...runPress(p.i, p.onRun, p.onHold)} aria-label={`Run the ${a.name}`} className="relative h-[52px] w-[52px] shrink-0 touch-manipulation select-none self-center [-webkit-touch-callout:none]">
          {icon}
        </button>
      )}
      {/* (sized by its own width: on the narrowest phones the Run bar drops its word) */}
      <div className="@container flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[13.5px] font-extrabold leading-tight text-ink">{a.name}</span>
          {/* the next step in short: "→ 50" and a bolt (twice as fast) or a note (double pay), as the ring fills to it */}
          <span className="tnum flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-[10.5px] font-bold text-dim" title={`At ${p.stepAt}: ${p.stepWhat}`}>
            → {p.stepAt}
            {p.stepWhat === 'twice as fast' ? (
              <svg width="10" height="11" viewBox="0 0 24 24" aria-label="twice as fast">
                <path d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12Z" fill="#7cc8ff" />
              </svg>
            ) : (
              <CashIcon size={11} />
            )}
          </span>
        </div>
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1">
            <RoundBar p={p} tall />
          </div>
          {!p.managed && (
            <motion.button
              whileTap={p.canHire ? { scale: 0.95 } : undefined}
              onClick={(e) => {
                e.stopPropagation()
                p.onHire(p.i)
              }}
              disabled={!p.canHire}
              aria-label={`Hire ${MANAGERS[p.i].name} for ${p.hire} Cash`}
              className="flex h-9 shrink-0 flex-col items-center justify-center rounded-lg bg-sky px-1.5 text-[11px] font-black leading-none text-[#03233a] shadow-[inset_0_-2px_0_rgba(0,0,0,.15)] disabled:bg-white/[.05] disabled:text-white/35 disabled:shadow-none"
            >
              Hire
              <span className="tnum mt-0.5 text-[10px] opacity-80">{p.hire}</span>
            </motion.button>
          )}
        </div>
      </div>
      <BuyButton i={p.i} k={p.k} cost={p.cost} can={p.can} gain={p.gain} best={p.best} onBuy={p.onBuy} tall />
    </div>
  )
}, sameBut<RowProps>('progress'))

/** the count on an attraction's icon, popping as it changes */
function Count({ n, small = false }: { n: number; small?: boolean }) {
  return (
    <motion.span
      key={n}
      initial={{ scale: 1.5 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 16 }}
      className={`tnum absolute left-1/2 -translate-x-1/2 rounded-full bg-[#0b1621] px-1.5 py-px text-center font-black text-white ring-1 ring-white/15 ${small ? '-bottom-1 min-w-[26px] text-[11px]' : '-bottom-1.5 min-w-[30px] text-[12px]'}`}
    >
      {n.toLocaleString('en-US')}
    </motion.span>
  )
}

/** a ring round a phone row's icon, filling towards the next count step */
function StepRing({ f, color }: { f: number; color: string }) {
  const r = 24
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden>
      <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(0,0,0,.4)" strokeWidth="3" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, f))} style={{ transition: 'stroke-dashoffset .5s' }} />
    </svg>
  )
}

/** the buy button: the amount, its price and what it adds a second; a press throws a "+k" up from it (`tall`: a
 *  phone's, the three stacked) */
const BuyButton = memo(function BuyButton({ i, k, cost, can, gain, best, onBuy, tall = false }: { i: number; k: number; cost: string; can: boolean; gain: string; best: boolean; onBuy: Buy; tall?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const look = `relative rounded-lg bg-gradient-to-b from-[#4fdc82] to-[#2bb862] font-black text-[#032412] shadow-[0_6px_16px_-10px_rgba(63,201,106,.9),inset_0_-2px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:brightness-110 disabled:from-white/[.06] disabled:to-white/[.04] disabled:text-white/40 disabled:shadow-none ${best ? 'ring-2 ring-[#ffe08a]/90' : ''}`
  const press = (e: RMouseEvent) => {
    e.stopPropagation()
    if (can && ref.current) onBuy(i, k, ref.current.getBoundingClientRect())
  }
  if (tall)
    return (
      <motion.button ref={ref} whileTap={can ? { scale: 0.96 } : undefined} onClick={press} disabled={!can} className={`${look} flex w-[84px] shrink-0 flex-col items-center justify-center gap-0.5 px-1 leading-none`}>
        {best && <BestTag />}
        <span className="text-[12.5px]">Buy ×{k.toLocaleString('en-US')}</span>
        <span className="tnum flex items-center gap-1 text-[12px]">
          <CashIcon size={12} className={can ? '' : 'opacity-50'} />
          {cost}
        </span>
        {gain && <span className={`tnum text-[10px] ${can ? 'text-[#063b1d]/75' : ''}`}>+{gain}/s</span>}
      </motion.button>
    )
  return (
    <motion.button ref={ref} whileTap={can ? { scale: 0.96 } : undefined} onClick={press} disabled={!can} className={`${look} flex h-9 min-w-0 flex-1 items-center justify-between gap-2 px-2.5 text-[13px]`}>
      {best && <BestTag />}
      <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        Buy ×{k.toLocaleString('en-US')}
        {gain && <span className={`tnum truncate text-[11px] font-extrabold ${can ? 'text-[#063b1d]/70' : ''}`}>+{gain}/s</span>}
      </span>
      <span className="tnum flex shrink-0 items-center gap-1">
        <CashIcon size={13} className={can ? '' : 'opacity-50'} />
        {cost}
      </span>
    </motion.button>
  )
})

/** an attraction not open yet: what it would pay, and its price */
const ForSale = memo(function ForSale({
  i,
  cost,
  can,
  pay,
  every,
  next,
  selected,
  reveal,
  phone,
  onBuy,
  onSelect,
}: {
  i: number
  cost: string
  can: boolean
  pay: string
  every: string
  next: boolean
  selected: boolean
  reveal: number
  phone: boolean
  onBuy: Buy
  onSelect: (i: number) => void
}) {
  const ref = useReveal(reveal)
  const btn = useRef<HTMLButtonElement>(null)
  const a = ATTRACTIONS[i]
  return (
    <div
      ref={ref}
      onClick={() => onSelect(i)}
      className={`flex items-center gap-2.5 rounded-2xl p-2.5 transition-[box-shadow,opacity] ${selected ? 'bg-raised/60 shadow-[inset_0_0_0_2px_rgba(247,197,72,.75)]' : 'bg-panel2/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,.03)]'} ${next || can || selected ? '' : 'opacity-60'}`}
    >
      <AttractionIcon i={i} size={phone ? 40 : 44} dim={!can} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-extrabold text-ink">{a.name}</div>
        <div className="tnum text-[11.5px] font-semibold leading-snug text-dim">
          Pays {pay} {phone ? <>/ {every}</> : <>every {every}</>}
        </div>
      </div>
      <motion.button
        ref={btn}
        whileTap={can ? { scale: 0.95 } : undefined}
        onClick={(e) => {
          e.stopPropagation()
          if (can && btn.current) onBuy(i, 1, btn.current.getBoundingClientRect())
        }}
        disabled={!can}
        className={`flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] px-3 text-[12.5px] font-black text-[#3a2400] shadow-[inset_0_-2px_0_rgba(0,0,0,.14)] transition hover:brightness-105 disabled:from-white/[.06] disabled:to-white/[.04] disabled:text-white/40 disabled:shadow-none ${phone ? 'h-10' : 'h-9'}`}
      >
        Open
        <span className="tnum flex items-center gap-1">
          <CashIcon size={13} />
          {cost}
        </span>
      </motion.button>
    </div>
  )
})
