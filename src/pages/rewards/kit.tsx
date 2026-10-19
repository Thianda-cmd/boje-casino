/*
  The Rewards page's shared pieces: the card (Panel) with its soft coloured light (Glow), headings, the progress bar,
  the claim button, the coin sprays, a small popover for rules and odds, the reward kinds' icons and colours, and
  small formatting helpers.

  The coin sprays live in one layer over the whole page (CoinLayer, rendered once by the page into document.body), not
  inside the button that fires them: most claim buttons disappear the moment they pay (a mission row, the wheel's
  Collect, a tier bonus), and the coins should still fly, past the edge of their card. Everything animates with
  transform and opacity only, and there are no sprays when the player asks for reduced motion.
*/
import { useCallback, useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { create } from 'zustand'
import type { RewardKind } from '../../store/rewards'
import { useWallet } from '../../store/wallet'
import { Coin, IconBolt, IconGift, IconStar, IconTrophy, IconVault } from '../../components/icons'
import { sfx } from '../../lib/sound'

export const EASE = [0.22, 1, 0.36, 1] as const

/** A card. `flush` drops the padding for cards that lay out their own sections. */
export function Panel({ children, className = '', flush = false, id }: { children: ReactNode; className?: string; flush?: boolean; id?: string }) {
  return (
    <div id={id} className={`relative scroll-mt-4 overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/[.03] ${flush ? '' : 'p-5 sm:p-6'} ${className}`}>
      {children}
    </div>
  )
}

/** Soft coloured light behind a card. A radial gradient, not a blur filter, so it costs nothing to draw. */
export function Glow({ color, opacity = 0.16, className = '' }: { color: string; opacity?: number; className?: string }) {
  return <div className={`pointer-events-none absolute rounded-full ${className}`} style={{ background: `radial-gradient(closest-side, ${color}, transparent)`, opacity }} />
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-2 text-[13px] font-bold ${className}`}>{children}</div>
}

/** A section heading with an optional note or control on the right. */
export function SectionTitle({ icon, children, right, id }: { icon: ReactNode; children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-0.5">
      <h2 className="flex items-center gap-2 text-[20px] font-black tracking-tight">
        {icon}
        {children}
      </h2>
      {right}
    </div>
  )
}

/** Progress bar that animates with a transform only: a full-width fill slides in from the left. */
export function Bar({ pct, color, className = 'h-2', track = 'bg-stage', label }: { pct: number; color: string; className?: string; track?: string; label?: string }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label} className={`overflow-hidden rounded-full ${track} ${className}`}>
      <motion.div className="h-full w-full rounded-full" style={{ background: color }} initial={{ x: '-100%' }} animate={{ x: `${p - 100}%` }} transition={{ duration: 0.9, ease: EASE }} />
    </div>
  )
}

/** Plays the claim sound and shows the toast for a claim that paid something. */
export function useClaim() {
  const pushToast = useWallet((s) => s.pushToast)
  return (amount: number, title: string, sound: () => void = sfx.coin) => {
    if (amount > 0) {
      sound()
      pushToast({ kind: 'reward', title, amount })
    }
  }
}

/** setTimeout that is dropped if the component goes first (a delayed sound shouldn't play on the next page) */
export function useLater() {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const live = timers.current
    return () => live.forEach(clearTimeout)
  }, [])
  return useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])
}

/* ---------------- coin sprays ---------------- */

interface Spray {
  id: number
  kind: 'burst' | 'shower'
  /** viewport position: a burst's centre, a shower's top-left */
  x: number
  y: number
  /** a burst: how far the coins fly; a shower: the area's width */
  scale: number
  /** a shower: how far the coins fall */
  h: number
}
const useSprays = create<{ list: Spray[] }>(() => ({ list: [] }))
let sprayId = 1
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function spray(s: Omit<Spray, 'id'>, life: number) {
  const id = sprayId++
  useSprays.setState((st) => ({ list: [...st.list, { ...s, id }] }))
  setTimeout(() => useSprays.setState((st) => ({ list: st.list.filter((x) => x.id !== id) })), life)
}

/** A quick spray of coins from the middle of `el`. `scale` throws them further; `delay` (ms) holds it back. */
export function burstFrom(el: Element | null, scale = 1, delay = 0) {
  if (!el || calm()) return
  const go = () => {
    const r = el.getBoundingClientRect()
    if (r.width) spray({ kind: 'burst', x: r.left + r.width / 2, y: r.top + r.height / 2, scale, h: 0 }, 1400)
  }
  if (delay) setTimeout(go, delay)
  else go()
}

/** Coins raining down over `el`: kept for the wheel's top prize. */
export function showerOver(el: Element | null, delay = 0) {
  if (!el || calm()) return
  setTimeout(() => {
    const r = el.getBoundingClientRect()
    if (r.width) spray({ kind: 'shower', x: r.left, y: r.top, scale: r.width, h: r.height }, 2600)
  }, delay)
}

const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + 0.25
  const reach = 1 + (i % 3) * 0.28
  return { x: Math.cos(a) * 58 * reach, y: Math.sin(a) * 30 * reach - 22, r: (i % 2 ? 1 : -1) * (120 + i * 12), d: (i % 4) * 0.03 }
})

/** a coin's spot along a shower: spread across, staggered, a little different in size and spin (fixed, not random) */
const SHOWER = Array.from({ length: 28 }, (_, i) => {
  const f = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1
  return { x: (i + f(1) * 0.8) / 28, d: f(2) * 0.9, dur: 1.1 + f(3) * 0.5, size: 14 + Math.round(f(4) * 8), r: (f(5) - 0.5) * 720, drift: (f(6) - 0.5) * 40 }
})

/** The layer every spray on the page draws in. The page renders it once. */
export function CoinLayer() {
  const list = useSprays((s) => s.list)
  useEffect(() => () => useSprays.setState({ list: [] }), [])
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden" aria-hidden>
      {list.map((s) =>
        s.kind === 'burst' ? (
          <div key={s.id} className="absolute" style={{ left: s.x, top: s.y }}>
            {BURST.map((p, i) => (
              <motion.span
                key={i}
                className="absolute -ml-2 -mt-2"
                initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
                animate={{ x: p.x * s.scale, y: p.y * s.scale, scale: 1, opacity: 0, rotate: p.r }}
                transition={{ duration: 0.85 + (s.scale - 1) * 0.25, delay: p.d, ease: [0.15, 0.75, 0.3, 1] }}
              >
                <Coin size={16} />
              </motion.span>
            ))}
          </div>
        ) : (
          <div key={s.id} className="absolute" style={{ left: s.x, top: s.y, width: s.scale, height: s.h }}>
            {SHOWER.map((c, i) => (
              <motion.span
                key={i}
                className="absolute top-0"
                style={{ left: `${c.x * 100}%` }}
                initial={{ y: -30, x: 0, rotate: 0, opacity: 0 }}
                animate={{ y: s.h * 0.92, x: c.drift, rotate: c.r, opacity: [0, 1, 1, 0] }}
                transition={{ duration: c.dur, delay: c.d, ease: [0.45, 0, 0.75, 0.6], opacity: { duration: c.dur, delay: c.d, times: [0, 0.12, 0.75, 1] } }}
              >
                <Coin size={c.size} />
              </motion.span>
            ))}
          </div>
        ),
      )}
    </div>,
    document.body,
  )
}

type Tone = 'gold' | 'violet' | 'sky' | 'green' | 'pink'
const TONES: Record<Tone, string> = {
  gold: 'shimmer bg-[linear-gradient(90deg,#f7c548,#ffe38f,#f7c548)] text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)]',
  violet: 'bg-[linear-gradient(180deg,#a98cff,#8a66ff)] text-white shadow-[0_10px_26px_-12px_rgba(155,123,255,.9),inset_0_-3px_0_rgba(0,0,0,.16)] hover:brightness-110',
  sky: 'bg-[linear-gradient(180deg,#6cc3ff,#3aa6f5)] text-[#03233a] shadow-[0_10px_26px_-12px_rgba(76,180,255,.9),inset_0_-3px_0_rgba(0,0,0,.14)] hover:brightness-110',
  green: 'bg-[linear-gradient(180deg,#3fe28a,#1fbf63)] text-[#032412] shadow-[0_10px_26px_-12px_rgba(34,211,111,.9),inset_0_-3px_0_rgba(0,0,0,.14)] hover:brightness-110',
  pink: 'bg-[linear-gradient(180deg,#ff8cc0,#f0509a)] text-white shadow-[0_10px_26px_-12px_rgba(255,95,162,.9),inset_0_-3px_0_rgba(0,0,0,.16)] hover:brightness-110',
}

/**
 * The claim button used across the page. When it can't be pressed it can show how far along the cooldown is
 * (`progress` 0..1) as a faint fill behind the label. A press throws coins from it (`burst`, 0 for none).
 */
export function ClaimButton({
  ready,
  onClick,
  children,
  tone = 'gold',
  progress,
  className = 'h-12 w-full',
  burst = 1,
}: {
  ready: boolean
  onClick: () => void
  children: ReactNode
  tone?: Tone
  progress?: number
  className?: string
  /** how far the coins fly (0: no coins) */
  burst?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const last = useRef(0)
  const press = () => {
    // a double click is one press: the claim behind it pays once anyway, and its coins and sound shouldn't double
    const t = performance.now()
    if (!ready || t - last.current < 400) return
    last.current = t
    // measured before the claim: the button is often gone once it has paid
    if (burst) burstFrom(box.current, burst)
    onClick()
  }
  return (
    <div ref={box} className={`relative ${className}`}>
      <motion.button
        whileTap={ready ? { scale: 0.97 } : undefined}
        disabled={!ready}
        onClick={press}
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl text-[15px] font-extrabold transition ${ready ? TONES[tone] : 'cursor-default bg-raised/80 text-muted'}`}
      >
        {!ready && progress !== undefined && (
          <span className="absolute inset-0 origin-left bg-white/[.06]" style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} />
        )}
        <span className="relative flex min-w-0 items-center gap-2 px-3">{children}</span>
      </motion.button>
    </div>
  )
}

/** A coin amount with the coin after it, in the page's tabular figures. */
export function Coins({ amount, size = 14, digits = 0, className = '' }: { amount: number; size?: number; digits?: number; className?: string }) {
  return (
    <span className={`tnum inline-flex items-center gap-1 ${className}`}>
      {amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}
      <Coin size={size} />
    </span>
  )
}

/**
 * A small popover: the rules a card would otherwise spell out, or the wheel's odds. The trigger is an "i" (or a pill
 * with `text`); it closes on a press elsewhere or Escape.
 */
export function Popover({
  label,
  text,
  title,
  children,
  align = 'right',
  className = '',
}: {
  label: string
  text?: string
  title?: string
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div ref={box} className={`relative shrink-0 ${className}`}>
      <button
        onClick={() => (sfx.click(), setOpen((o) => !o))}
        aria-expanded={open}
        aria-label={text ? undefined : label}
        title={text ? undefined : label}
        className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[12px] font-bold transition ${text ? 'px-3' : 'w-9'} ${open ? 'bg-raised text-ink' : 'bg-stage text-muted hover:text-ink'}`}
      >
        <IconInfo size={15} />
        {text}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={title ?? label}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            className={`absolute top-11 z-30 w-[min(272px,calc(100vw-48px))] rounded-xl bg-panel2 p-3.5 text-left shadow-[0_20px_50px_-12px_rgba(0,0,0,.85)] ring-1 ring-white/10 ${
              align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
            }`}
          >
            {title && <div className="mb-1.5 text-[13px] font-extrabold text-ink">{title}</div>}
            <div className="text-pretty text-[12.5px] font-medium leading-snug text-muted">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------------- icons the shared set doesn't have ---------------- */

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = ({ size = 20, ...p }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
})

export const IconTarget = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
  </svg>
)
/** a little prize wheel: the rim, its spokes and the pointer on top */
export const IconWheel = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 5v16M4 13h16M6.3 7.3l11.4 11.4M17.7 7.3 6.3 18.7" strokeWidth="1.4" />
    <path d="M10 2h4l-2 3.2Z" fill="currentColor" />
  </svg>
)
/** coins coming back: rakeback */
export const IconReturn = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M12 8v8M14.2 9.6c-.5-.6-1.3-.9-2.2-.9-1.2 0-2.2.7-2.2 1.6 0 2.1 4.6 1.2 4.6 3.4 0 .9-1 1.6-2.3 1.6-1 0-1.9-.4-2.4-1" strokeWidth="1.6" />
  </svg>
)
export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5v7l5.5-3.5Z" fill="currentColor" />
  </svg>
)
/** a short stack of coins: wagering */
export const IconStack = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
    <path d="M5 6.5v4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4M5 10.5v4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4M5 14.5v3c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-3" />
  </svg>
)
export const IconLayers = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 9 5-9 5-9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
)
export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.1" strokeWidth="2.4" />
  </svg>
)
export const IconCrown = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 8 7.5 12 12 5l4.5 7 4-4-1.8 10.5H5.3Z" />
    <path d="M5.3 21h13.4" />
  </svg>
)
/** a clock: the midnight reset */
export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </svg>
)

/* ---------------- the reward kinds ---------------- */

/** Each kind of reward's name (for totals, and `one` for a single entry), colour and icon. */
export const KINDS: Record<RewardKind, { name: string; one: string; color: string; icon: (size: number) => ReactNode }> = {
  daily: { name: 'Daily bonus', one: 'Daily bonus', color: '#f7c548', icon: (s) => <IconGift size={s} /> },
  mission: { name: 'Missions', one: 'Daily mission', color: '#22d36f', icon: (s) => <IconTarget size={s} /> },
  wheel: { name: 'Lucky Wheel', one: 'Lucky Wheel', color: '#ff5fa2', icon: (s) => <IconWheel size={s} /> },
  level: { name: 'Level-ups', one: 'Level-up', color: '#9b7bff', icon: (s) => <IconStar size={s} /> },
  tier: { name: 'Tier bonuses', one: 'Tier bonus', color: '#7fe3ff', icon: (s) => <IconCrown size={s} /> },
  rakeback: { name: 'Rakeback', one: 'Rakeback', color: '#2fd6c3', icon: (s) => <IconReturn size={s} /> },
  challenge: { name: 'Challenges', one: 'Challenge', color: '#ffb02e', icon: (s) => <IconTrophy size={s} /> },
  heist: { name: 'Vault Heist', one: 'Vault Heist', color: '#ff9a52', icon: (s) => <IconVault size={s} /> },
  refill: { name: 'Refills', one: 'Refill', color: '#4cb4ff', icon: (s) => <IconBolt size={s} /> },
}

/** A rounded tile in a colour, holding an icon: the history rows, the missions. */
export function KindTile({ color, children, size = 40, className = '' }: { color: string; children: ReactNode; size?: number; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl ${className}`}
      style={{ width: size, height: size, color, background: `linear-gradient(145deg, ${color}38, ${color}10)`, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      {children}
    </span>
  )
}

/* ---------------- formatting ---------------- */

/** "a", "a and b", "a, b and c" */
export function joinAnd(parts: string[]) {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "just now", "4m ago", "3h ago", "yesterday", "5d ago" */
export function timeAgo(t: number, now: number) {
  const s = Math.max(0, (now - t) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2 * 86_400) return 'yesterday'
  return `${Math.floor(s / 86_400)}d ago`
}

/** a duration that never breaks across lines ("16h 59m") */
export const nb = (text: string) => text.replace(/ /g, ' ')
