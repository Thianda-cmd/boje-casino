import { motion } from 'framer-motion'
import { useUid } from '../../art/ids'
import { sfx } from '../../lib/sound'
import { MOODS } from './rules'
import { useView } from './desk'
import { fmtPct, fmtPrice } from './levels'
import type { ChartStyle } from './storage'

/*
  The ticker along the top of the stage: the BOJE/USD token, the live price with the way the last tick went and the
  change over the last minute of ticks, the market's mood as a badge (three bars of volatility, Wild glowing), and
  the chart style and How it works buttons. Each part reads only what it shows from the desk's store, so the ticks
  re-render nothing else. Also the banner a change of mood brings ("Volatility rising").
*/

export const MOOD_LOOK = [
  { color: '#4cb4ff', bg: 'rgba(76,180,255,.13)', ring: 'rgba(76,180,255,.35)', banner: 'Market calming', sub: 'Small moves for a while' },
  { color: '#22d36f', bg: 'rgba(34,211,111,.12)', ring: 'rgba(34,211,111,.35)', banner: 'Market steadying', sub: 'Moves back to normal' },
  { color: '#ff8a3d', bg: 'rgba(255,110,50,.16)', ring: 'rgba(255,120,60,.55)', banner: 'Volatility rising', sub: 'The market turns wild' },
] as const

/** the BOJE token: a teal coin with a rising chart stamped on it */
export function Token({ size = 34 }: { size?: number }) {
  const u = useUid() + 'tk'
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0 drop-shadow-[0_3px_8px_rgba(0,209,160,.35)]">
      <defs>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9dffe8" />
          <stop offset=".45" stopColor="#00d1a0" />
          <stop offset="1" stopColor="#03735c" />
        </linearGradient>
        <linearGradient id={`${u}r`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#024c3d" />
          <stop offset="1" stopColor="#013027" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill={`url(#${u}r)`} />
      <circle cx="20" cy="20" r="17.2" fill={`url(#${u}g)`} />
      <circle cx="20" cy="20" r="13.4" fill="none" stroke="#013a2e" strokeOpacity=".4" strokeWidth="1.4" />
      <path d="M11.5 25.5 17 20l3.6 3.6 7.6-8.2" stroke="#012a21" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.4 15.2h4.9v4.9" stroke="#012a21" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="14" cy="10.5" rx="7" ry="3.2" fill="#fff" opacity=".38" transform="rotate(-32 14 10.5)" />
    </svg>
  )
}

/** three bars of volatility, lit to the mood */
function Bars({ level, color }: { level: number; color: string }) {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] rounded-sm" style={{ height: 4 + i * 4, background: i <= level ? color : 'rgba(255,255,255,.18)' }} />
      ))}
    </span>
  )
}

export function MoodBadge({ compact }: { compact: boolean }) {
  const mood = useView((s) => s.mood)
  const look = MOOD_LOOK[mood]
  const wild = mood === 2
  return (
    <motion.div
      key={mood}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={wild ? { scale: 1, opacity: 1, boxShadow: ['0 0 0 0 rgba(255,110,50,0)', '0 0 18px 2px rgba(255,110,50,.45)', '0 0 0 0 rgba(255,110,50,0)'] } : { scale: 1, opacity: 1 }}
      transition={wild ? { scale: { type: 'spring', stiffness: 420, damping: 16 }, boxShadow: { duration: 1.3, repeat: Infinity } } : { type: 'spring', stiffness: 420, damping: 22 }}
      className={`flex shrink-0 items-center gap-1.5 rounded-full ${compact ? 'px-2 py-[5px]' : 'px-2.5 py-1.5'}`}
      style={{ background: look.bg, color: look.color, border: `1px solid ${look.ring}` }}
      title={`The market is ${MOODS[mood].name}: its moves are ${mood === 0 ? 'small' : mood === 1 ? 'normal' : 'big'}`}
    >
      <Bars level={mood} color={look.color} />
      <span className={`font-black uppercase leading-none tracking-[0.12em] ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{MOODS[mood].name}</span>
    </motion.div>
  )
}

function PriceText({ compact }: { compact: boolean }) {
  const price = useView((s) => s.price)
  const prev = useView((s) => s.prev)
  const up = price >= prev
  return (
    <span className="flex items-center gap-1.5">
      <span data-market-price className={`tnum font-black leading-none tracking-tight text-ink ${compact ? 'text-[18px]' : 'text-[26px]'}`}>
        {fmtPrice(price)}
      </span>
      <span className={`text-[10px] leading-none ${up ? 'text-accent' : 'text-danger'}`} aria-hidden>
        {up ? '▲' : '▼'}
      </span>
    </span>
  )
}

/** the change over the last minute of ticks */
function Change({ compact }: { compact: boolean }) {
  const price = useView((s) => s.price)
  const ref = useView((s) => s.ref)
  const ch = price / ref - 1
  return (
    <span className={`tnum shrink-0 rounded-md font-extrabold leading-none ${compact ? 'px-1 py-[3px] text-[9.5px]' : 'px-2 py-1 text-[12px]'} ${ch >= 0 ? 'bg-accent/15 text-accent' : 'bg-danger/15 text-danger'}`}>
      {ch >= 0 ? '+' : '−'}
      {fmtPct(Math.abs(ch))}
      <span className="ml-1 opacity-55">1m</span>
    </span>
  )
}

const LineIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 17l5-6 4 4 8-9" />
  </svg>
)
const CandleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <path d="M6 3v4M6 15v6M12 2v3M12 13v5M18 6v3M18 17v4" />
    <rect x="4" y="7" width="4" height="8" rx="1" fill="currentColor" />
    <rect x="10" y="5" width="4" height="8" rx="1" />
    <rect x="16" y="9" width="4" height="8" rx="1" fill="currentColor" />
  </svg>
)

const InfoIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17.2h.01" />
  </svg>
)

export function Ticker({ compact, chart, onChart, onInfo }: { compact: boolean; chart: ChartStyle; onChart: (c: ChartStyle) => void; onInfo: () => void }) {
  const btn = 'flex items-center justify-center rounded-lg text-muted transition hover:bg-white/10 hover:text-ink'
  const bar = 'absolute inset-x-0 top-0 z-20 flex items-center border-b border-white/[.06] bg-[linear-gradient(180deg,#0d1e29,#0a1720)]'
  if (compact)
    return (
      <div className={`${bar} h-[52px] gap-2 px-2.5`}>
        <Token size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 leading-none">
            <span className="text-[10.5px] font-black tracking-wide text-ink">
              BOJE<span className="text-dim">/USD</span>
            </span>
            <Change compact />
          </div>
          <div className="mt-[5px]">
            <PriceText compact />
          </div>
        </div>
        <MoodBadge compact />
        {/* one button switches the chart's style */}
        <button
          onClick={() => (sfx.click(), onChart(chart === 'line' ? 'candles' : 'line'))}
          className={`${btn} h-9 w-9 bg-black/25 ring-1 ring-white/[.06]`}
          aria-label={chart === 'line' ? 'Candle chart' : 'Line chart'}
          title={chart === 'line' ? 'Show candles' : 'Show the line'}
        >
          {chart === 'line' ? <CandleIcon /> : <LineIcon />}
        </button>
        <button onClick={onInfo} className={`${btn} -ml-1 h-9 w-8`} aria-label="How it works">
          <InfoIcon />
        </button>
      </div>
    )
  return (
    <div className={`${bar} h-[62px] gap-4 px-4`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <Token size={36} />
        <div className="min-w-0 leading-tight">
          <div className="text-[14px] font-black tracking-wide text-ink">
            BOJE<span className="text-dim">/USD</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            Live market
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <PriceText compact={false} />
        <Change compact={false} />
      </div>
      <MoodBadge compact={false} />
      <div className="ml-auto flex items-center gap-1">
        <div className="flex rounded-lg bg-black/25 p-0.5 ring-1 ring-white/[.06]" role="group" aria-label="Chart style">
          {(['line', 'candles'] as const).map((c) => (
            <button
              key={c}
              onClick={() => c !== chart && (sfx.click(), onChart(c))}
              aria-pressed={chart === c}
              aria-label={c === 'line' ? 'Line chart' : 'Candle chart'}
              className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-bold transition ${chart === c ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.06)]' : 'text-muted hover:text-ink'}`}
            >
              {c === 'line' ? <LineIcon /> : <CandleIcon />}
              {c === 'line' ? 'Line' : 'Candles'}
            </button>
          ))}
        </div>
        <button onClick={onInfo} className={`${btn} h-9 gap-1.5 px-2.5 text-[12px] font-bold`} aria-label="How it works">
          <InfoIcon />
          How it works
        </button>
      </div>
    </div>
  )
}

/** the moment the mood changes: a banner drops over the chart (louder, and shaking, when it turns wild) */
export function MoodBanner({ mood, compact }: { mood: number; compact: boolean }) {
  const look = MOOD_LOOK[mood]
  const wild = mood === 2
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3"
      initial={{ opacity: 0, y: -24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 20 }}
      role="status"
    >
      <motion.div
        animate={wild ? { x: [0, -4, 4, -3, 3, -1, 0] } : undefined}
        transition={wild ? { duration: 0.5, delay: 0.15 } : undefined}
        className={`flex items-center gap-3 rounded-2xl border-2 shadow-[0_18px_40px_-14px_rgba(0,0,0,.9)] ${compact ? 'px-3.5 py-2' : 'px-5 py-2.5'}`}
        style={{
          borderColor: wild ? '#ffb36b' : look.ring,
          background: wild ? 'linear-gradient(100deg,#ff4d61 0%,#ff7a2f 55%,#ffb13b 100%)' : `linear-gradient(180deg, rgba(14,30,40,.96), rgba(9,20,28,.96))`,
        }}
      >
        {wild ? (
          <svg width={compact ? 22 : 28} height={compact ? 22 : 28} viewBox="0 0 24 24" aria-hidden>
            <path d="M13.5 2 4.5 13.5h6L9 22l10-12.5h-6.2Z" fill="#fff6c8" stroke="#5a1200" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="flex h-3 items-end gap-[2px]">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-[4px] rounded-sm" style={{ height: 5 + i * 4, background: i <= mood ? look.color : 'rgba(255,255,255,.2)' }} />
            ))}
          </span>
        )}
        <div className="leading-tight">
          <div className={`font-black uppercase italic tracking-[0.08em] ${compact ? 'text-[15px]' : 'text-[20px]'} ${wild ? 'text-white [text-shadow:0_2px_0_rgba(90,18,0,.55)]' : ''}`} style={wild ? undefined : { color: look.color }}>
            {look.banner}
          </div>
          <div className={`font-bold ${compact ? 'text-[10.5px]' : 'text-[12px]'} ${wild ? 'text-white/85' : 'text-muted'}`}>{look.sub}</div>
        </div>
      </motion.div>
    </motion.div>
  )
}
