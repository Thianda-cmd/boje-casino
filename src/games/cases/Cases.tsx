import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, Segmented, Stat, Toggle, useStake, type PillTone } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { casesSfx } from './sound'
import { useSize } from '../../lib/useSize'
import { useWallet, type BetEvent } from '../../store/wallet'
import { CRATE_ACCENT, CrateArt, ItemArt } from './art'
import { LootReel, reelHeight, type ReelHandle } from './LootReel'
import { CRATES, ITEM_NAME, RARITIES, RARITY, RTP, TIERS, chanceLabel, chanceOf, hitChance, multLabel, oddsLabel, pickIndex, topMult, type Rarity, type Tier } from './rules'
import { RARITY_TEXT } from './tiles'

/*
  Cases: pick a crate, press Open, and a reel of loot glides past the marker and settles on the prize. Open one to five
  crates at once: that many reels stack up, push off a beat apart and come to rest one after another, each on its own
  item.

  Every item is drawn the moment Open is pressed (lib/rng) and each reel is built to stop on its own (LootReel.tsx).
  The stake (bet × crates) leaves the wallet once, and the round settles once, when the last reel stops, or straight
  away if the page is left mid-spin.
*/

const MAX_COUNT = 5

interface Result {
  id: number
  tier: Tier
  item: number
  mult: number
  rarity: Rarity
  bet: number
  payout: number
}

/* The shared pieces whose framer layout animations measure the page on every render: kept out of the renders the
   reels cause, so a spin's start and stop don't force extra layout passes. */
const MemoHistoryPills = memo(HistoryPills)
const MemoModeTabs = memo(ModeTabs)
const MemoToggle = memo(Toggle)

const PILL: Record<Rarity, { tone: PillTone; style?: CSSProperties }> = {
  common: { tone: 'loss' },
  uncommon: { tone: 'win' },
  rare: { tone: 'neutral', style: { background: RARITY.rare.color, color: '#061a33' } },
  epic: { tone: 'neutral', style: { background: RARITY.epic.color, color: '#1c0838' } },
  legendary: { tone: 'gold' },
}

export default function Cases() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [tier, setTier] = useState<Tier>('medium')
  const [count, setCount] = useState(1)
  const [mode, setMode] = useState<Mode>('manual')
  const [turbo, setTurbo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [canSkip, setCanSkip] = useState(false)
  const [lidOpen, setLidOpen] = useState(false)
  const [showContents, setShowContents] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)
  const [history, setHistory] = useState<Result[]>([])
  const [stageRef, size] = useSize<HTMLDivElement>()

  // the latest values for the round, which runs outside React's renders
  const betRef = useRef(bet)
  betRef.current = bet
  const tierRef = useRef(tier)
  tierRef.current = tier
  const countRef = useRef(count)
  countRef.current = count
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const busyRef = useRef(false)

  const reels = useRef<(ReelHandle | null)[]>([])
  const pending = useRef<BetEvent | null>(null)
  const finishRound = useRef<((net: number | null) => void) | null>(null)
  const lidTimer = useRef(0)
  const resultId = useRef(1)
  const autoRef = useRef(false)
  const pills = useMemo(() => history.map((h) => ({ key: h.id, label: multLabel(h.mult), tone: PILL[h.rarity].tone, style: PILL[h.rarity].style })), [history])

  /* ---------------- geometry ---------------- */

  const phone = size.w < 560
  const winW = Math.max(240, Math.min(1180, size.w - (phone ? 24 : 48)))
  const gapR = phone ? 6 : 10
  let tileW: number
  let crateW = 0
  if (count === 1) {
    // the reserved bands: history, crate caption, result plate, contents strip and the gaps between them
    const reserved = phone ? 262 : 318
    tileW = Math.round(Math.max(76, Math.min(138, winW / (phone ? 3.9 : 6.5))))
    tileW = Math.max(70, Math.min(tileW, Math.floor((size.h - reserved - 64) / 1.52)))
    crateW = Math.round(Math.max(72, Math.min(phone ? 136 : 230, (size.h - reserved - reelHeight(tileW)) / 0.98)))
  } else {
    // a stack: the reels share what the history row, the plate and the contents strip leave, and the crate stands above
    // them only when there's room for it (with its caption); otherwise a small one rides in the history row
    const gapM = phone ? 10 : 14
    const room = size.h - 44 - 86 - (phone ? 56 : 64) - gapM - 6
    const stack = (w: number) => count * reelHeight(w) + gapR * (count - 1)
    tileW = Math.floor(Math.max(40, Math.min(138, winW / (phone ? 3.9 : 6.5))))
    while (tileW > 40 && stack(tileW) > room) tileW--
    const cw = Math.min(phone ? 104 : 168, (room - stack(tileW) - (phone ? 38 : 44) - 2 * gapM) / 0.94)
    if (cw >= (phone ? 60 : 84)) crateW = Math.round(cw)
  }
  const hero = crateW > 0

  /* ---------------- a round ---------------- */

  const settlePending = () => {
    const ev = pending.current
    if (!ev) return
    pending.current = null
    useWallet.getState().settle(ev)
  }

  const play = (): Promise<number | null> => {
    if (busyRef.current) return Promise.resolve(null)
    const crate = CRATES[tierRef.current]
    const b = betRef.current
    const n = countRef.current
    const total = round2(b * n)
    if (!stake(total)) return Promise.resolve(null)
    busyRef.current = true
    setBusy(true)
    setCanSkip(true)

    const winners = Array.from({ length: n }, () => pickIndex(crate))
    const items = winners.map((w) => crate.items[w])
    const payout = round2(items.reduce((a, it) => a + round2(b * it.mult), 0))
    const best = items.reduce((a, it) => (it.mult > a.mult ? it : a), items[0])
    pending.current = {
      game: 'cases',
      bet: total,
      payout,
      meta: n === 1 ? { tier: crate.tier, mult: best.mult, rarity: best.rarity } : { tier: crate.tier, mult: best.mult, rarity: best.rarity, count: n, mults: items.map((it) => it.mult).join(',') },
    }

    setResults(null)
    clearTimeout(lidTimer.current)
    setLidOpen(true)
    casesSfx.open(TIERS.indexOf(crate.tier))

    const fast = turboRef.current
    // one main phase for the stack, each reel a beat later than the one above it, so they settle top to bottom
    const main = fast ? 0.98 : 3.35 + rand() * 0.5
    return new Promise<number | null>((resolve) => {
      finishRound.current = resolve
      let left = n
      const land = () => {
        settlePending()
        const res: Result[] = winners.map((w, i) => ({ id: resultId.current++, tier: crate.tier, item: w, mult: items[i].mult, rarity: items[i].rarity, bet: b, payout: round2(b * items[i].mult) }))
        setResults(res)
        setHistory((h) => [...[...res].reverse(), ...h].slice(0, 14))
        if (n === 1 || best.rarity !== 'common') casesSfx.land(RARITIES.indexOf(best.rarity))
        busyRef.current = false
        setBusy(false)
        setCanSkip(false)
        if (!autoRef.current) lidTimer.current = window.setTimeout(() => setLidOpen(false), 1300)
        // let a big pull breathe before autobet moves on
        const hold = (best.rarity === 'legendary' ? 1700 : best.rarity === 'epic' ? 800 : 0) * (fast ? 0.6 : 1)
        const done = () => {
          if (finishRound.current !== resolve) return
          finishRound.current = null
          resolve(payout - total)
        }
        if (autoRef.current && hold) window.setTimeout(done, hold)
        else done()
      }
      for (let i = 0; i < n; i++) {
        const reel = reels.current[i]
        const onLand = () => {
          if (n > 1) casesSfx.stop(RARITIES.indexOf(items[i].rarity), i)
          if (--left === 0) land()
        }
        if (reel) reel.spin({ crate, winner: winners[i], fast, main, delay: i * (fast ? 40 : 70), extra: i * (fast ? 0.07 : 0.16), onLand })
        else onLand()
      }
    })
  }

  /** speeds a manual spin to its stop */
  const skip = () => {
    let any = false
    for (const r of reels.current.slice(0, countRef.current)) if (r?.skip()) any = true
    if (any) setCanSkip(false)
  }

  /** a new crate: its items glide in from the right */
  const pickTier = (t: Tier) => {
    if (t === tierRef.current || busyRef.current || auto.running) return
    setTier(t)
    tierRef.current = t
    casesSfx.pick(TIERS.indexOf(t))
    setResults(null)
    clearTimeout(lidTimer.current)
    setLidOpen(false)
    for (const r of reels.current.slice(0, countRef.current)) r?.glide(t)
  }

  const pickCount = (n: number) => {
    if (n === countRef.current || busyRef.current || auto.running) return
    setCount(n)
    countRef.current = n
    setResults(null)
    for (const r of reels.current) r?.clear()
  }

  const auto = useAutoBet(play, turbo ? 300 : 700)
  autoRef.current = auto.running
  const locked = busy || auto.running

  // autobet keeps the crate open between rounds; it closes once autobet stops
  useEffect(() => {
    if (!auto.running && !busy && lidOpen) {
      clearTimeout(lidTimer.current)
      lidTimer.current = window.setTimeout(() => setLidOpen(false), 1300)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.running])

  // leaving mid-spin settles the round at once; so does closing the page, or hiding it (a phone may drop a background
  // tab without another word); the reels still land where they were going
  useEffect(() => {
    const onHide = () => settlePending()
    const onVisibility = () => document.hidden && settlePending()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(lidTimer.current)
      settlePending()
      busyRef.current = false
      finishRound.current?.(null)
      finishRound.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = round2(bet * count)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || showContents) return
      if (e.code === 'Space' && mode === 'manual') {
        e.preventDefault()
        if (e.repeat) return
        if (busyRef.current) skip()
        else if (balance >= total) void play()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const crate = CRATES[tier]
  const openLabel = count === 1 ? 'Open crate' : `Open ${count} crates`
  const panel = (
    <>
      <MemoModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <BetInput value={bet} onChange={setBet} disabled={auto.running} />
      <div>
        <Label right={count > 1 ? <>Total {fmt(total)}</> : undefined}>Crates at once</Label>
        <CountPicker value={count} onChange={pickCount} disabled={locked} />
      </div>
      <div>
        <Label right={crate.name}>Crate</Label>
        <div className="grid grid-cols-2 gap-2">
          {TIERS.map((t) => {
            const on = t === tier
            return (
              <button
                key={t}
                disabled={locked && !on}
                onClick={() => pickTier(t)}
                aria-pressed={on}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition disabled:opacity-45 ${on ? 'bg-hover shadow-[inset_0_0_0_2px_rgba(34,211,111,.6)]' : 'bg-raised hover:bg-hover'}`}
              >
                <CrateArt tier={t} size={44} className="shrink-0" />
                <span className="min-w-0">
                  <span className={`block text-[13px] font-bold ${on ? 'text-ink' : 'text-ink/85'}`}>{CRATES[t].risk.replace(' risk', '')}</span>
                  <span className="tnum block text-[11px] font-semibold text-dim">up to {multLabel(topMult(CRATES[t]))}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Chance of 1×+" value={chanceLabel(hitChance(crate))} />
        <Stat label="Top prize" value={fmt(bet * topMult(crate))} tone="gold" />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2.5">
        <span className="text-[13px] font-semibold text-muted">Turbo</span>
        <MemoToggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      <button onClick={() => (sfx.click(), setShowContents(true))} className="h-10 shrink-0 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
        Crate contents
      </button>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div className="max-lg:order-first lg:mt-auto">
        {mode === 'manual' ? (
          busy ? (
            <ActionButton tone="neutral" onClick={skip} sub={canSkip ? 'Tap to skip' : undefined}>
              Opening…
            </ActionButton>
          ) : (
            <ActionButton onClick={() => void play()} disabled={balance < total} sub={count > 1 ? <>{fmt(total)}</> : undefined}>
              {openLabel}
            </ActionButton>
          )
        ) : auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop}>
            Stop autobet
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={balance < total}>
            Start autobet
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const shown = results && results[0]?.tier === tier ? results : null
  const best = shown ? shown.reduce((a, r) => (r.mult > a.mult ? r : a), shown[0]) : null
  const glow = best ? RARITY[best.rarity].color : CRATE_ACCENT[tier]
  const won = useMemo(() => new Set(shown?.map((r) => r.item) ?? []), [shown])
  const hint = !busy && !auto.running
  const plateW = Math.min(winW, count > 1 ? 520 : 460)

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_36%,#1a2f43_0%,#0a1620_70%)]">
      <div className="flex min-h-[44px] shrink-0 items-center gap-3 px-4 pt-4">
        {!hero && <MiniCrate tier={tier} open={lidOpen} glow={glow} count={count} phone={phone} />}
        <MemoHistoryPills className={`min-w-0 flex-1 justify-end ${hero ? '' : '[mask-image:linear-gradient(to_right,transparent,#000_28px)]'}`} items={pills} />
      </div>
      <div className={`relative flex min-h-0 flex-1 flex-col items-center justify-center ${phone ? 'gap-2.5' : count > 1 ? 'gap-3.5' : 'gap-4'}`}>
        {hero && (
          <>
            <CrateHero tier={tier} width={crateW} open={lidOpen} glow={glow} />
            <div className="relative z-[1] -mt-1 text-center">
              <div className={`font-extrabold tracking-tight text-ink ${phone ? 'text-[14px]' : 'text-[16px]'}`}>
                {crate.name}
                {count > 1 && <span className="text-muted"> ×{count}</span>}
              </div>
              <div className="tnum text-[12px] font-semibold text-muted">
                {crate.risk} · up to {multLabel(topMult(crate))}
              </div>
            </div>
          </>
        )}

        {/* the reels */}
        <div className="relative flex shrink-0 flex-col" style={{ gap: gapR }}>
          {Array.from({ length: count }, (_, i) => (
            <motion.div key={i} initial={i ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <LootReel
                ref={(h) => {
                  reels.current[i] = h
                }}
                tier={tier}
                winW={winW}
                tileW={tileW}
                ticks={i === 0}
              />
            </motion.div>
          ))}
        </div>

        {count === 1 ? (
          <ResultPlate result={shown?.[0] ?? null} hint={hint} phone={phone} width={plateW} />
        ) : (
          <SummaryPlate results={shown} hint={hint} phone={phone} width={plateW} count={count} />
        )}
      </div>
      <ContentsStrip tier={tier} won={won} />
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass={count >= 3 ? 'max-sm:h-[min(88vh,740px)] sm:max-lg:h-[min(80vh,800px)]' : 'max-sm:h-[min(72vh,600px)] sm:max-lg:h-[min(70vh,700px)]'} />
      <AnimatePresence>{showContents && <ContentsModal initial={tier} onClose={() => setShowContents(false)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- pieces ---------------- */

/** ×1 to ×5: how many crates one press opens. */
function CountPicker({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className={`grid grid-cols-5 gap-1.5 ${disabled ? 'opacity-60' : ''}`}>
      {Array.from({ length: MAX_COUNT }, (_, i) => {
        const n = i + 1
        const on = n === value
        return (
          <button
            key={n}
            disabled={disabled && !on}
            onClick={() => (sfx.click(), onChange(n))}
            aria-pressed={on}
            className={`relative flex h-10 items-center justify-center rounded-lg text-[14px] font-extrabold transition ${on ? 'bg-hover text-ink shadow-[inset_0_0_0_2px_rgba(34,211,111,.6)]' : 'bg-raised text-muted hover:bg-hover hover:text-ink'}`}
          >
            <span className="tnum">×{n}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The chosen crate, floating gently. Its lid lifts while a round plays, with light spilling out in `glow`. */
function CrateHero({ tier, width, open, glow }: { tier: Tier; width: number; open: boolean; glow: string }) {
  const floatRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = floatRef.current
    if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const a = el.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-Math.max(2, Math.min(4, Math.round(width / 50)))}px)` }], { duration: 2400, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })
    return () => a.cancel()
  }, [width])
  const h = Math.round((width * 150) / 160)
  return (
    <div className="relative z-[1] shrink-0" style={{ width, height: h }}>
      {/* the glow behind the crate */}
      <div
        className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,background] duration-700"
        style={{ width: width * 1.7, height: width * 1.3, background: `radial-gradient(closest-side, ${glow}40, ${glow}00)`, opacity: open ? 1 : 0.55 }}
      />
      <div ref={floatRef} className="absolute inset-0 will-change-transform">
        <AnimatePresence initial={false}>
          <motion.div
            key={tier}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.86, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          >
            <CrateArt tier={tier} part="body" size={width} className="absolute inset-0" />
            {/* light from inside, seen once the lid lifts */}
            <div
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full transition-opacity duration-500"
              style={{ top: h * 0.12, width: width * 0.86, height: h * 0.42, background: `radial-gradient(closest-side, ${glow}cc, ${glow}00)`, opacity: open ? 0.9 : 0 }}
            />
            <div
              className="absolute inset-0"
              style={{
                transformOrigin: '50% 28%',
                transform: open ? 'translateY(-15%) rotate(-4deg) scale(.97,.9)' : 'none',
                transition: open ? 'transform .55s cubic-bezier(.25,1.35,.45,1)' : 'transform .4s cubic-bezier(.5,0,.3,1)',
              }}
            >
              <CrateArt tier={tier} part="lid" size={width} className="absolute inset-0" />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** With a tall stack there's no room for the big crate: a small one rides in the history row, lid and all. */
function MiniCrate({ tier, open, glow, count, phone }: { tier: Tier; open: boolean; glow: string; count: number; phone: boolean }) {
  const crate = CRATES[tier]
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <CrateHero tier={tier} width={phone ? 34 : 40} open={open} glow={glow} />
      <div className="leading-tight">
        <div className="whitespace-nowrap text-[13px] font-extrabold text-ink">
          {phone ? crate.name.replace(' Crate', '') : crate.name} <span className="text-muted">×{count}</span>
        </div>
        {!phone && <div className="tnum whitespace-nowrap text-[11px] font-semibold text-muted">up to {multLabel(topMult(crate))}</div>}
      </div>
    </div>
  )
}

/** Under the reel: what came out, its multiplier and the payout (or, before an open, how to start one). Holds its
 *  height so nothing below moves. */
function ResultPlate({ result, hint, phone, width }: { result: Result | null; hint: boolean; phone: boolean; width: number }) {
  const h = phone ? 56 : 64
  return (
    <div className="relative shrink-0" style={{ width, height: h }}>
      <AnimatePresence>
        {result ? (
          <motion.div
            key={result.id}
            className="absolute inset-0 flex items-center gap-3 rounded-xl bg-panel2/90 px-3"
            style={{ boxShadow: `inset 0 0 0 1px ${RARITY[result.rarity].color}55, 0 14px 30px -18px ${RARITY[result.rarity].color}` }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="relative flex shrink-0 items-center justify-center rounded-lg" style={{ width: h - 14, height: h - 14, background: `radial-gradient(closest-side, ${RARITY[result.rarity].glow}, transparent)` }}>
              <ItemArt kind={CRATES[result.tier].items[result.item].kind} size={h - 18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-extrabold uppercase tracking-[.08em]" style={{ color: RARITY[result.rarity].color }}>
                {RARITY[result.rarity].name}
              </div>
              <div className={`truncate font-extrabold text-ink ${phone ? 'text-[14px]' : 'text-[15px]'}`}>{ITEM_NAME[CRATES[result.tier].items[result.item].kind]}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`tnum font-black leading-none ${phone ? 'text-[20px]' : 'text-[24px]'}`} style={{ color: result.mult >= 1 ? RARITY[result.rarity].color : '#c3cfdb' }}>
                {multLabel(result.mult)}
              </div>
              <div className="tnum mt-1 flex items-center justify-end gap-1 text-[13px] font-bold text-muted">
                {fmt(result.payout)} <Coin size={13} />
              </div>
            </div>
          </motion.div>
        ) : hint ? (
          <motion.div key="idle" className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            {phone ? 'Tap Open crate to spin the reel' : 'Press Open crate or Space to spin the reel'}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/** Under a stack: every item that came out, the best of them, and what the whole open paid. */
function SummaryPlate({ results, hint, phone, width, count }: { results: Result[] | null; hint: boolean; phone: boolean; width: number; count: number }) {
  const h = phone ? 56 : 64
  const best = results?.reduce((a, r) => (r.mult > a.mult ? r : a), results[0])
  const bet = results ? round2(results.reduce((a, r) => a + r.bet, 0)) : 0
  const paid = results ? round2(results.reduce((a, r) => a + r.payout, 0)) : 0
  const mult = bet > 0 ? paid / bet : 0
  const icon = phone ? 26 : 32
  return (
    <div className="relative shrink-0" style={{ width, height: h }}>
      <AnimatePresence>
        {results && best ? (
          <motion.div
            key={results[0].id}
            className="absolute inset-0 flex items-center gap-3 rounded-xl bg-panel2/90 px-3"
            style={{ boxShadow: `inset 0 0 0 1px ${RARITY[best.rarity].color}55, 0 14px 30px -18px ${RARITY[best.rarity].color}` }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="flex shrink-0 items-center" style={{ paddingLeft: icon * 0.22 }}>
              {results.map((r, i) => (
                <motion.div
                  key={r.id}
                  className="relative flex items-center justify-center rounded-full bg-[#0d1b26]"
                  style={{ width: icon, height: icon, marginLeft: i ? -icon * 0.22 : 0, boxShadow: `0 0 0 2px #142231, inset 0 0 0 1.5px ${RARITY[r.rarity].color}`, zIndex: results.length - i }}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.05, type: 'spring', stiffness: 520, damping: 26 }}
                >
                  <ItemArt kind={CRATES[r.tier].items[r.item].kind} size={icon * 0.74} />
                </motion.div>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-extrabold uppercase tracking-[.08em]" style={{ color: RARITY[best.rarity].color }}>
                Best · {multLabel(best.mult)}
              </div>
              <div className={`truncate font-extrabold text-ink ${phone ? 'text-[13px]' : 'text-[15px]'}`}>{ITEM_NAME[CRATES[best.tier].items[best.item].kind]}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`tnum font-black leading-none ${phone ? 'text-[19px]' : 'text-[24px]'}`} style={{ color: mult >= 1 ? '#22d36f' : '#c3cfdb' }}>
                {mult.toFixed(2)}×
              </div>
              <div className="tnum mt-1 flex items-center justify-end gap-1 text-[13px] font-bold text-muted">
                {fmt(paid)} <Coin size={13} />
              </div>
            </div>
          </motion.div>
        ) : hint ? (
          <motion.div key="idle" className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            {phone ? `Tap Open to spin all ${count} reels` : `Press Open or Space to spin all ${count} reels`}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/** Along the bottom of the stage: every item in the crate with its multiplier and chance. */
function ContentsStrip({ tier, won }: { tier: Tier; won: Set<number> }) {
  const crate = CRATES[tier]
  return (
    <div className="no-scrollbar shrink-0 overflow-x-auto bg-panel2/60 px-3 py-2.5">
      <div className="mx-auto flex w-max gap-1.5">
        {crate.items.map((it, i) => {
          const r = RARITY[it.rarity]
          return (
            <div
              key={`${tier}${i}`}
              title={`${ITEM_NAME[it.kind]} · ${multLabel(it.mult)} · ${chanceLabel(chanceOf(it))}`}
              className="flex min-w-[60px] shrink-0 flex-col items-center rounded-lg bg-raised px-1.5 pb-1.5 pt-1 transition-shadow duration-300"
              style={{ boxShadow: `inset 0 -2px 0 ${r.color}${won.has(i) ? `, inset 0 0 0 2px ${r.color}, 0 0 16px -4px ${r.color}` : ''}` }}
            >
              <ItemArt kind={it.kind} size={26} />
              <div className="tnum mt-0.5 text-[12px] font-extrabold leading-tight" style={{ color: RARITY_TEXT[it.rarity] }}>
                {multLabel(it.mult)}
              </div>
              <div className="tnum text-[10px] font-bold leading-tight text-dim">{chanceLabel(chanceOf(it))}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The full contents of every crate: item, rarity, multiplier, chance and odds. */
function ContentsModal({ initial, onClose }: { initial: Tier; onClose: () => void }) {
  const [tier, setTier] = useState(initial)
  const crate = CRATES[tier]
  return (
    <Modal onClose={onClose} title="Crate contents" width={520}>
      <div className="flex flex-col gap-3">
        <Segmented value={tier} onChange={setTier} options={TIERS.map((t) => ({ value: t, label: CRATES[t].risk.replace(' risk', '') }))} />
        <div className="flex items-center gap-3 rounded-xl bg-panel2 px-3 py-2">
          <CrateArt tier={tier} size={56} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold">{crate.name}</div>
            <div className="tnum text-[12px] font-semibold text-muted">
              Return {(RTP * 100).toFixed(0)}% · 1× or more {chanceLabel(hitChance(crate))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {[...crate.items].reverse().map((it) => {
            const r = RARITY[it.rarity]
            const p = chanceOf(it)
            return (
              <div key={it.mult} className="flex items-center gap-3 rounded-lg bg-panel2/70 px-2.5 py-1.5" style={{ boxShadow: `inset 3px 0 0 ${r.color}` }}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={{ background: `radial-gradient(closest-side, ${r.glow}, transparent)` }}>
                  <ItemArt kind={it.kind} size={34} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold">{ITEM_NAME[it.kind]}</div>
                  <div className="text-[11px] font-bold" style={{ color: r.color }}>
                    {r.name}
                  </div>
                </div>
                <div className="tnum w-[70px] text-right text-[15px] font-black" style={{ color: RARITY_TEXT[it.rarity] }}>
                  {multLabel(it.mult)}
                </div>
                <div className="tnum w-[84px] text-right leading-tight">
                  <div className="text-[13px] font-bold text-ink/90">{chanceLabel(p)}</div>
                  <div className="text-[10.5px] font-semibold text-dim">{oddsLabel(p)}</div>
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[12px] font-medium leading-relaxed text-dim">
          Every item is drawn the moment you open the crate; the reel then shows it. Opening several crates draws one item for each, separately. Every filler tile on the reel is drawn from the same table.
        </p>
      </div>
    </Modal>
  )
}
