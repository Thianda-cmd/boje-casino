import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion'
import { fmt } from '../../lib/format'
import { COSTS, multLabel, speciesOf, type FishId } from './rules'
import { LEVEL_COLORS } from './looks'
import { GoldCoin, INK, Portrait, chip, inked, valueLabel } from './art'
import type { ReefScene, StageLayout } from './scene'

/*
  The overlay on the reef, kept light so the reef stays the star: the cannon's dock (its cost, and − / + to change it),
  Auto and Lock buttons in the bottom corners (phones and tablets; the desktop panel has its own), the session's net
  in the top left, the latest catches in the top right, payout numbers popping where each catch was, banners for the
  whale, the tide and the big moments, a hint above the dock when a shot can't be fired, a tag riding on a locked
  creature, and the big-win celebration (the Golden Whale, or any catch worth 100× or more): the reef dims, gold
  coins rain down the stage and a plaque counts the win up. Everything but the buttons lets the pointer through to
  the reef, so play never stops for a moment.
*/

const TIER_SIZE = [19, 27, 35, 46]

export interface Pop {
  key: number
  x: number
  y: number
  payout: number
  mult: number
  tier: number
  id: FishId
  /** creatures in the catch (a blast or a chain nets several) */
  n: number
}

export interface FeedItem {
  key: number
  id: FishId
  mult: number
  /** what it paid (all of them, when several of the same in a row are counted as one row) */
  payout: number
  n: number
  /** how many such catches in a row this row stands for */
  count: number
  /** when it last changed (performance.now()) */
  at: number
}

export interface BigWinData {
  key: number
  title: string
  /** the creature to show (the whale, or the catch's target) */
  id: FishId
  mult: number
  payout: number
  /** creatures in the catch */
  n: number
}

export type BannerKind = 'whale' | 'tide' | 'formation' | 'bomb' | 'zap' | 'gone'
export interface BannerData {
  key: number
  kind: BannerKind
  title: string
  sub?: string
}

export type HintData =
  | { key: number; kind: 'broke'; cost: number; lower: number | null }
  | { key: number; kind: 'wait' }
  | { key: number; kind: 'elsewhere' }
  | { key: number; kind: 'lock'; touch: boolean }

const BANNER_STYLE: Record<BannerKind, { bg: string; text: string }> = {
  whale: { bg: 'linear-gradient(180deg,#fff1a8 0%,#ffd23a 45%,#f2a01c 100%)', text: INK },
  tide: { bg: 'linear-gradient(180deg,#9ff3ff 0%,#3fc6e8 55%,#2a8fd0 100%)', text: '#fff' },
  formation: { bg: 'linear-gradient(180deg,#ffffff 0%,#e3f6ff 100%)', text: INK },
  bomb: { bg: 'linear-gradient(180deg,#ffd27a 0%,#ff7a3c 50%,#e83b2a 100%)', text: '#fff' },
  zap: { bg: 'linear-gradient(180deg,#c4f8ff 0%,#3fc6ff 50%,#2370e6 100%)', text: '#fff' },
  gone: { bg: 'linear-gradient(180deg,#ffffff 0%,#dfe9f2 100%)', text: INK },
}

/* ---------------- the cannon's dock ---------------- */

/** the cannon's cost on its turret, and − / + either side to change the level */
export function Dock({ layout, level, onStep }: { layout: StageLayout; level: number; onStep: (d: -1 | 1) => void }) {
  // the turret's brass ring is about 1.12 reef units across its radius
  const R = Math.max(34, 1.12 * layout.unit)
  const x = layout.cannon.x
  return (
    <>
      <RoundButton label="Lower the cannon" disabled={level === 0} onClick={() => onStep(-1)} style={{ left: x - R - 30, bottom: 10 }}>
        <path d="M6 12h12" />
      </RoundButton>
      <RoundButton label="Raise the cannon" disabled={level === COSTS.length - 1} onClick={() => onStep(1)} style={{ left: x + R + 30, bottom: 10 }}>
        <path d="M6 12h12M12 6v12" />
      </RoundButton>
      <div className="pointer-events-none absolute bottom-[7px] z-10 -translate-x-1/2" style={{ left: x }}>
        <motion.div
          key={level}
          initial={{ scale: 1.25 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 15 }}
          className="tnum flex items-center gap-1 whitespace-nowrap rounded-full border-[3px] bg-white py-[3px] pl-1 pr-2.5 text-[15px] font-black leading-none shadow-[0_3px_0_rgba(23,19,56,.45)]"
          style={{ borderColor: INK, color: INK }}
          aria-label={`${COSTS[level]} coins a shot, level ${level + 1}`}
        >
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 px-1 text-[10px] text-white" style={{ background: LEVEL_COLORS[level], borderColor: INK, textShadow: `0 1px 0 ${INK}` }}>
            {level + 1}
          </span>
          <GoldCoin size={15} />
          {COSTS[level]}
        </motion.div>
      </div>
    </>
  )
}

function RoundButton({ label, disabled, onClick, style, children }: { label: string; disabled?: boolean; onClick: () => void; style: CSSProperties; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.88 }}
      className="absolute z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border-[3px] bg-white shadow-[0_3px_0_rgba(23,19,56,.45)] transition-opacity disabled:opacity-40"
      style={{ ...style, borderColor: INK, color: INK, touchAction: 'manipulation' }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" aria-hidden>
        {children}
      </svg>
    </motion.button>
  )
}

/* ---------------- Auto and Lock ---------------- */

/** the round Auto (bottom left) and Lock (bottom right) buttons on the stage, below desktop width (the panel has them there) */
export function StageToggles({ auto, lock, onAuto, onLock }: { auto: boolean; lock: boolean; onAuto: () => void; onLock: () => void }) {
  return (
    <div className="lg:hidden">
      <CornerToggle on={auto} label="Auto" hint="Auto fire (A)" onClick={onAuto} side="left" color="#22c7d8">
        <path d="M12 4a8 8 0 1 1-7.4 5" />
        <path d="M4 4v5h5" />
        <path d="M10 9.5v5l4-2.5Z" fill="currentColor" strokeWidth="1.6" />
      </CornerToggle>
      <CornerToggle on={lock} label="Lock" hint="Lock a target (L)" onClick={onLock} side="right" color="#ff4b6e">
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </CornerToggle>
    </div>
  )
}

function CornerToggle({ on, label, hint, onClick, side, color, children }: { on: boolean; label: string; hint: string; onClick: () => void; side: 'left' | 'right'; color: string; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      aria-label={hint}
      title={hint}
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      className={`absolute bottom-2.5 z-10 flex h-[52px] w-[52px] flex-col items-center justify-center gap-[1px] rounded-full border-[3px] shadow-[0_3px_0_rgba(23,19,56,.45)] sm:h-14 sm:w-14 ${side === 'left' ? 'left-2.5' : 'right-2.5'}`}
      style={{ borderColor: INK, background: on ? color : '#fff', color: on ? '#fff' : INK, touchAction: 'manipulation' }}
    >
      {on && <motion.span className="absolute -inset-[5px] rounded-full border-[3px]" style={{ borderColor: color }} animate={{ opacity: [0.9, 0.2, 0.9], scale: [1, 1.08, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />}
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={on ? { filter: `drop-shadow(0 1px 0 ${INK})` } : undefined}>
        {children}
      </svg>
      <span className="text-[9.5px] font-black uppercase leading-none tracking-wide" style={on ? { textShadow: `0 1px 0 ${INK}` } : undefined}>
        {label}
      </span>
    </motion.button>
  )
}

/* ---------------- the sign ---------------- */

/** the game's sign, a wooden plaque hanging over the far reef when the stage shows reef above the field */
export function Plaque() {
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-0 z-[5] w-[190px] -translate-x-1/2"
      animate={{ y: [0, 3, 0], rotate: [-0.6, 0.6, -0.6] }}
      transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden
    >
      <svg viewBox="0 0 200 56" className="block w-full drop-shadow-[0_4px_0_rgba(23,19,56,.3)]">
        <path d="M34 0 L40 14 M166 0 L160 14" stroke="#e9c98a" strokeWidth="4" strokeLinecap="round" />
        <path d="M34 0 L40 14 M166 0 L160 14" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeDasharray="3 3" />
        <rect x="8" y="12" width="184" height="40" rx="12" fill="#c98a4b" stroke={INK} strokeWidth="3.5" />
        <path d="M18 33 H182" stroke="#a86c36" strokeWidth="2" strokeLinecap="round" />
        <path d="M20 20 Q60 17 100 19" stroke="#e8b47a" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".8" />
        {[
          [20, 23],
          [180, 23],
          [20, 42],
          [180, 42],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2.3" fill="#ffcf5a" stroke={INK} strokeWidth="1.4" />
        ))}
        <text x="100" y="40" textAnchor="middle" fontSize="23" fontWeight="900" letterSpacing="1.5" fill="#fff4d6" stroke={INK} strokeWidth="5" paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
          REEF RAID
        </text>
        <path d="M184 46 l2.6 5.4 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.3 2.8 1-5.9-4.3-4.2 6-.9Z" transform="translate(4 -12) scale(.9)" fill="#ff6a3d" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </motion.div>
  )
}

/* ---------------- the session's net and the catch feed ---------------- */

export function NetPill({ net }: { net: number }) {
  const up = net >= 0
  return (
    <div className="tnum pointer-events-none absolute left-2.5 top-2.5 z-10 flex items-center gap-2 rounded-full border-2 bg-white/95 py-[3px] pl-2.5 pr-3 text-[12.5px] font-black leading-none shadow-[0_2px_0_rgba(23,19,56,.35)] max-sm:gap-1 max-sm:pl-1" style={{ borderColor: INK, color: INK }}>
      <span className="text-[9.5px] uppercase tracking-wider opacity-60 max-sm:hidden">Session</span>
      <GoldCoin size={15} className="sm:hidden" />
      <motion.span key={Math.round(net * 100)} initial={{ scale: 1.25 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }} style={{ color: up ? '#119a52' : '#e2364b' }}>
        {up ? '+' : '−'}
        {fmt(Math.abs(net))}
      </motion.span>
    </div>
  )
}

/** the latest catches; `compact` (a banner is up) keeps only the newest row on a phone, clear of the banner below */
export function Feed({ items, portraits, compact }: { items: FeedItem[]; portraits: Partial<Record<FishId, string>>; compact: boolean }) {
  return (
    <div className="pointer-events-none absolute right-2.5 top-2.5 z-10 flex flex-col items-end gap-1">
      <AnimatePresence initial={false}>
        {items.map((f, i) => (
          <motion.div
            key={f.key}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className={`tnum flex items-center gap-1 whitespace-nowrap rounded-full border-2 bg-white/95 py-[1px] pl-[1px] pr-2.5 text-[12px] font-extrabold leading-none shadow-[0_2px_0_rgba(23,19,56,.35)] ${i >= (compact ? 1 : 3) ? 'max-sm:hidden' : ''}`}
            style={{ borderColor: INK, color: INK }}
          >
            <span className="relative -my-1">
              <Portrait id={f.id} src={portraits[f.id]} size={24} />
              {f.count > 1 && (
                <motion.span key={f.count} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="absolute -bottom-1 -left-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px] text-[9.5px] font-black leading-none text-white" style={{ background: INK }}>
                  {f.count}
                </motion.span>
              )}
            </span>
            <span className="max-sm:hidden">{speciesOf(f.id).name}</span>
            {f.n > 1 && <span className="text-[10.5px] opacity-60">+{f.n - 1}</span>}
            <span className="rounded-full px-1.5 py-[2px] text-[10.5px]" style={chip(speciesOf(f.id).color)}>
              {multLabel(f.mult)}
            </span>
            <span style={{ color: '#119a52' }}>+{fmt(f.payout)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ---------------- payout numbers ---------------- */

const SHOUT = ['', '', 'Big catch!', 'Mega catch!']

/** the payout popping where a catch was: bigger, golder and with a shout for the big ones */
export function Pops({ pops, scale }: { pops: Pop[]; scale: number }) {
  return (
    <AnimatePresence>
      {pops.map((p) => {
        const shout = p.id === 'whale' ? 'Golden Whale!' : SHOUT[p.tier]
        const gold = p.tier >= 2
        const life = 1.5 + p.tier * 0.3
        return (
          <motion.div
            key={p.key}
            className="pointer-events-none absolute z-20 flex flex-col items-center"
            style={{ left: p.x, top: p.y, x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 1, 0.96], translateY: [8, -14, -26, -46] }}
            transition={{ duration: life, times: [0, 0.14, 0.72, 1], ease: 'easeOut' }}
          >
            {shout && (
              <motion.span
                className="whitespace-nowrap text-[15px] font-black uppercase leading-none tracking-wide text-white"
                style={{ ...inked(4, 2), fontSize: 13 + p.tier * 3 * scale }}
                initial={{ rotate: -8, scale: 0.4 }}
                animate={{ rotate: -4, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 12, delay: 0.05 }}
              >
                {shout}
              </motion.span>
            )}
            <span className="tnum whitespace-nowrap font-black leading-[1.05]" style={{ ...inked(p.tier >= 2 ? 6 : 5, p.tier >= 2 ? 4 : 3), fontSize: TIER_SIZE[p.tier] * scale, color: gold ? '#ffd84a' : '#fff' }}>
              +{fmt(p.payout)}
            </span>
            {(p.tier >= 1 || p.n > 1) && (
              <span className="tnum mt-0.5 whitespace-nowrap rounded-full border-2 px-1.5 text-[11px] font-black leading-[15px]" style={{ ...chip(speciesOf(p.id).color), borderColor: INK }}>
                {multLabel(p.mult)}
                {p.n > 1 ? ` · ${p.n} caught` : ''}
              </span>
            )}
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}

/* ---------------- banners and hints ---------------- */

export function Banner({ banner }: { banner: BannerData | null }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[13%] z-20 flex justify-center px-3 max-sm:top-[46px]" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {banner && (
          <motion.div
            key={banner.key}
            initial={{ opacity: 0, y: -26, scale: 0.7, rotate: -3 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, y: -14, scale: 0.92, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 17 }}
            className="flex flex-col items-center rounded-2xl border-[3px] px-5 py-1.5 text-center shadow-[0_5px_0_rgba(23,19,56,.45)]"
            style={{ borderColor: INK, background: BANNER_STYLE[banner.kind].bg }}
          >
            <span
              className={`whitespace-nowrap font-black uppercase leading-tight tracking-wide ${banner.kind === 'formation' || banner.kind === 'gone' ? 'text-[15px] sm:text-[17px]' : 'text-[18px] sm:text-[23px]'}`}
              style={BANNER_STYLE[banner.kind].text === '#fff' ? { color: '#fff', ...inked(4, 2) } : { color: INK }}
            >
              {banner.title}
            </span>
            {banner.sub && (
              <span className="tnum whitespace-nowrap text-[12px] font-extrabold leading-tight sm:text-[13px]" style={{ color: BANNER_STYLE[banner.kind].text === '#fff' ? '#fff' : INK, textShadow: BANNER_STYLE[banner.kind].text === '#fff' ? `0 1px 0 ${INK}` : undefined }}>
                {banner.sub}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------------- the big win ---------------- */

/** the coins raining down the stage: where across (%), when, how long the fall, how big, which way they spin */
const RAIN = Array.from({ length: 22 }, (_, i) => {
  const r = (k: number) => {
    const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
    return s - Math.floor(s)
  }
  return { x: 3 + r(1) * 94, delay: r(2) * 1.6, dur: 1.5 + r(3) * 0.9, size: 18 + r(4) * 16, spin: (r(5) < 0.5 ? -1 : 1) * (240 + r(6) * 420) }
})

/** how long the celebration stays up (ms); the screen takes it down after this */
export const BIG_WIN_MS = 3900

/**
 * The Golden Whale, or any catch worth 100× or more: the reef dims round the edges, gold coins rain down the stage
 * behind a toon plaque with the creature, the shout and its win counting up, then it all fades away.
 */
export function BigWin({ win, portraits, stage }: { win: BigWinData | null; portraits: Partial<Record<FishId, string>>; stage: { w: number; h: number } }) {
  const k = Math.max(0.62, Math.min(1, stage.w / 640))
  // less motion asked for: the plaque and its count, without the rain and the turning rays
  const calm = useReducedMotion()
  return (
    <AnimatePresence>
      {win && (
        <motion.div key={win.key} className="pointer-events-none absolute inset-0 z-30 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.45 } }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 46%, rgba(6,22,58,0) 0%, rgba(6,22,58,.28) 50%, rgba(5,16,44,.66) 100%)' }} />
          {!calm &&
            RAIN.map((r, i) => (
              <motion.div
                key={i}
                className="absolute top-0"
                style={{ left: `${r.x}%` }}
                initial={{ y: -48, rotate: 0, opacity: 0 }}
                animate={{ y: stage.h + 48, rotate: r.spin, opacity: [0, 1, 1, 1] }}
                transition={{ duration: r.dur, delay: 0.15 + r.delay, ease: [0.45, 0, 0.8, 0.6] }}
              >
                <GoldCoin size={r.size * k} />
              </motion.div>
            ))}
          <div className="absolute inset-0 flex items-center justify-center pb-[6%]">
            <motion.div
              className="relative flex flex-col items-center"
              initial={{ scale: 0.25, rotate: -10, y: 40 }}
              animate={{ scale: 1, rotate: -2, y: 0 }}
              transition={{ type: 'spring', stiffness: 360, damping: 13 }}
            >
              {/* slow gold rays behind it all */}
              <motion.div
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{
                  width: 460 * k,
                  height: 460 * k,
                  marginLeft: -230 * k,
                  marginTop: -230 * k,
                  background: 'repeating-conic-gradient(rgba(255,214,90,.32) 0deg 9deg, rgba(255,214,90,0) 9deg 22.5deg)',
                  WebkitMaskImage: 'radial-gradient(circle, #000 18%, transparent 66%)',
                  maskImage: 'radial-gradient(circle, #000 18%, transparent 66%)',
                }}
                animate={{ rotate: calm ? 0 : 90 }}
                transition={{ duration: 4, ease: 'linear' }}
              />
              <motion.div initial={{ y: 16, scale: 0.6 }} animate={{ y: [16, -6, 0], scale: 1 }} transition={{ duration: 0.6, delay: 0.1 }} className="relative drop-shadow-[0_6px_0_rgba(23,19,56,.35)]">
                <Portrait id={win.id} src={portraits[win.id]} size={Math.round(156 * k)} />
              </motion.div>
              <span className="relative -mt-2 whitespace-nowrap font-black uppercase leading-none tracking-wide" style={{ ...inked(6 * k, 5 * k), fontSize: 44 * k, color: '#ffd84a' }}>
                {win.title}
              </span>
              <span
                className="tnum relative mt-2.5 flex items-center gap-2 whitespace-nowrap rounded-2xl border-[3px] bg-white px-4 py-1.5 font-black leading-none shadow-[0_5px_0_rgba(23,19,56,.45)]"
                style={{ borderColor: INK, color: INK, fontSize: 30 * k }}
              >
                <CountUp to={win.payout} duration={1.7} />
                <GoldCoin size={28 * k} />
              </span>
              <span className="tnum relative mt-2 whitespace-nowrap rounded-full border-2 px-2.5 text-[13px] font-black leading-[20px]" style={{ ...chip(speciesOf(win.id).color), borderColor: INK }}>
                {multLabel(win.mult)}
                {win.n > 1 ? ` · ${win.n} caught` : ''}
              </span>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** a win counting up from +0 (written straight into the page, not re-rendered each frame), as wide as its end from the start */
function CountUp({ to, duration }: { to: number; duration: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const a = animate(0, to, {
      duration,
      delay: 0.3,
      ease: [0.2, 0.75, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = `+${fmt(v)}`
      },
    })
    return () => a.stop()
  }, [to, duration])
  return (
    <span ref={ref} className="inline-block text-right" style={{ minWidth: `${fmt(to).length + 1}ch` }}>
      +{fmt(0)}
    </span>
  )
}

/** a line above the dock: why a shot didn't fire (with a way out), or how to lock on */
export function Hint({ hint, bottom, onLower }: { hint: HintData | null; bottom: number; onLower: (i: number) => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-16" style={{ bottom }}>
      <AnimatePresence mode="popLayout">
        {hint && (
          <motion.div
            key={hint.kind === 'broke' ? `broke-${hint.cost}` : hint.kind}
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border-[2.5px] bg-white px-3 py-1.5 text-center text-[12.5px] font-extrabold leading-tight shadow-[0_3px_0_rgba(23,19,56,.4)] sm:text-[13px]"
            style={{ borderColor: INK, color: INK }}
            role="status"
          >
            {hint.kind === 'broke' ? (
              <>
                <span>Not enough coins for a {fmt(hint.cost, 0)}-coin shot</span>
                {hint.lower != null ? (
                  <button type="button" className="pointer-events-auto rounded-full border-2 px-2 py-0.5 text-[11.5px] font-black text-white" style={{ borderColor: INK, background: LEVEL_COLORS[hint.lower] }} onClick={() => onLower(hint.lower!)}>
                    Use {COSTS[hint.lower]}
                  </button>
                ) : (
                  <a href="#/rewards" className="pointer-events-auto rounded-full border-2 bg-[#ffd23a] px-2 py-0.5 text-[11.5px] font-black" style={{ borderColor: INK }}>
                    Get coins
                  </a>
                )}
              </>
            ) : hint.kind === 'wait' ? (
              <span>Connecting to your wallet…</span>
            ) : hint.kind === 'elsewhere' ? (
              <span>Reef Raid is open in another tab. Close it to play here.</span>
            ) : (
              <span>{hint.touch ? 'Tap' : 'Click'} a creature to lock on</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------------- the lock tag ---------------- */

/** a tag riding on the locked creature: what it is and what it pays (follows it every frame, outside React) */
export function LockTag({ scene, target }: { scene: ReefScene | null; target: FishId | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scene || !target) return
    const at = { x: 0, y: 0 }
    let raf = 0
    const follow = () => {
      raf = requestAnimationFrame(follow)
      const el = ref.current
      if (!el) return
      if (!scene.lockedAt(at)) {
        el.style.opacity = '0'
        return
      }
      el.style.opacity = '1'
      el.style.transform = `translate(${at.x}px, ${at.y}px)`
    }
    follow()
    return () => cancelAnimationFrame(raf)
  }, [scene, target])
  if (!target) return null
  const s = speciesOf(target)
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-[15] opacity-0" style={{ willChange: 'transform' }}>
      <div className="-translate-x-1/2 translate-y-[-260%]">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          className="tnum flex items-center gap-1 whitespace-nowrap rounded-full border-2 bg-white py-[2px] pl-1.5 pr-2 text-[11.5px] font-black leading-none shadow-[0_2px_0_rgba(23,19,56,.4)]"
          style={{ borderColor: INK, color: INK }}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#ff4b6e" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          {s.name}
          <span className="rounded-full px-1 text-[10px]" style={chip(s.color)}>
            {valueLabel(target)}
          </span>
        </motion.div>
      </div>
    </div>
  )
}
