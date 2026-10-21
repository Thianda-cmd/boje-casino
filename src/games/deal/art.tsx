import { motion } from 'framer-motion'
import { ROUNDS, type BoardId } from './rules'
import { Sheen } from './Case'
import { TIERS } from './words'

/*
  Banker's Deal's set: the studio behind the cases (a lit wall of LED columns tinted by tonight's board, a truss of
  bulbs, two swaying spotlights, a glossy floor and the audience's heads in the warm light at the bottom), the board's
  tier badge (Classic in steel blue, Gold with a sheen, Diamond iridescent and sparkling), the round track (the cases
  of each round as pips, the final two last) and the podium the player's case stands on.
*/

const INK = '#0b1220'

/** the audience's heads along the bottom edge: fixed so they never jump between renders */
const HEADS = Array.from({ length: 46 }, (_, i) => {
  const s = Math.sin(i * 12.9898) * 43758.5453
  const r = s - Math.floor(s)
  return { x: i / 45, r: 0.7 + r * 0.45, dy: (r * 7) % 3 }
})

export function Studio({ w, h, board, floorY, wide, hype = 0 }: { w: number; h: number; board: BoardId | null; floorY: number; wide: boolean; hype?: number }) {
  const t = TIERS[board ?? 'classic']
  const headR = wide ? 13 : 9
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 100% 75% at 50% 0%, #252a5c 0%, #121530 46%, #070914 100%)' }} />
      {/* the LED wall */}
      <motion.div
        className="absolute inset-x-0 top-0"
        style={{
          height: floorY,
          backgroundImage: `repeating-linear-gradient(90deg, transparent 0 ${wide ? 34 : 22}px, ${t.wall} ${wide ? 34 : 22}px ${wide ? 38 : 25}px, transparent ${wide ? 38 : 25}px ${wide ? 44 : 29}px)`,
          maskImage: 'radial-gradient(ellipse 70% 90% at 50% 10%, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 90% at 50% 10%, black 0%, transparent 75%)',
        }}
        initial={false}
        animate={{ opacity: 0.16 + hype * 0.18 }}
        transition={{ duration: 0.6 }}
      />
      <div className="absolute inset-x-0 top-0" style={{ height: floorY, background: `radial-gradient(ellipse 60% 55% at 50% 0%, ${t.glow}, transparent 70%)`, opacity: 0.55 }} />
      {/* the truss of bulbs along the top */}
      <div className="absolute inset-x-0 top-0 h-[10px] bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute inset-x-3 top-[3px] flex justify-between">
        {Array.from({ length: Math.max(8, Math.round(w / (wide ? 28 : 22))) }, (_, i) => (
          <span key={i} className="h-[5px] w-[5px] rounded-full" style={{ background: i % 2 ? '#fff3c4' : t.a, boxShadow: `0 0 6px ${i % 2 ? '#ffd45c' : t.a}`, opacity: 0.85 }} />
        ))}
      </div>
      {/* the spotlights */}
      {[-1, 1].map((side) => (
        <motion.div
          key={side}
          className="absolute top-[-20px]"
          style={{ left: side < 0 ? w * 0.12 : w * 0.88, width: wide ? 280 : 170, height: h * 1.05, marginLeft: wide ? -140 : -85, transformOrigin: '50% 0%', background: 'linear-gradient(180deg, rgba(255,246,214,.20), rgba(255,246,214,0) 85%)', clipPath: 'polygon(44% 0, 56% 0, 100% 100%, 0 100%)' }}
          animate={{ rotate: side < 0 ? [-22, -8, -22] : [22, 8, 22] }}
          transition={{ duration: side < 0 ? 9 : 11, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {/* the floor */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: floorY - (wide ? 40 : 24), background: 'linear-gradient(180deg, rgba(10,14,30,0) 0%, rgba(14,20,42,.92) 22%, #0a0d1d 100%)' }} />
      <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%]" style={{ top: floorY - (wide ? 30 : 18), width: w * 1.1, height: wide ? 180 : 110, background: `radial-gradient(closest-side, ${t.glow}, transparent 75%)`, opacity: 0.32 }} />
      <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%] border border-white/[.06]" style={{ top: floorY - (wide ? 10 : 6), width: w * 0.86, height: wide ? 120 : 70 }} />
      <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%] border border-white/[.04]" style={{ top: floorY + (wide ? 12 : 8), width: w * 0.62, height: wide ? 80 : 46 }} />
      {/* the audience, in the warm light from the floor */}
      {wide && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-[70px]" style={{ background: 'radial-gradient(ellipse 60% 100% at 50% 100%, rgba(255,150,80,.22), transparent 75%)' }} />
          <svg className="absolute inset-x-0 bottom-0" width={w} height={headR * 2.6} viewBox={`0 0 ${w} ${headR * 2.6}`} preserveAspectRatio="none">
            {HEADS.map((p, i) => {
              const x = p.x * w
              const r = headR * p.r
              const y = headR * 1.1 + p.dy + (i % 2 ? 4 : 0)
              return (
                <g key={i} fill="#04050b">
                  <circle cx={x} cy={y} r={r} />
                  <ellipse cx={x} cy={y + r * 1.6} rx={r * 1.7} ry={r * 1.1} />
                </g>
              )
            })}
          </svg>
        </>
      )}
    </div>
  )
}

/** a sparkle: a four-pointed star */
export function Spark({ x, y, r, color = '#fff' }: { x: number; y: number; r: number; color?: string }) {
  return <path d={`M${x} ${y - r * 2}L${x + r * 0.45} ${y - r * 0.45}L${x + r * 2} ${y}L${x + r * 0.45} ${y + r * 0.45}L${x} ${y + r * 2}L${x - r * 0.45} ${y + r * 0.45}L${x - r * 2} ${y}L${x - r * 0.45} ${y - r * 0.45}Z`} fill={color} />
}

function TierIcon({ board, size }: { board: BoardId; size: number }) {
  if (board === 'diamond')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <path d="M6 4h12l4 5-10 12L2 9z" fill="#e8fbff" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M2 9h20M9 4l-2 5 5 12 5-12-2-5" fill="none" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" opacity=".6" />
        <path d="M7 9l5 12 5-12z" fill="#9fdcff" opacity=".7" />
      </svg>
    )
  if (board === 'gold')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <path d="M3 8l4.5 4L12 4l4.5 8L21 8l-2 11H5z" fill="#fff3b8" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="12" cy="14.5" r="1.8" fill="#e09a10" />
      </svg>
    )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="8" width="18" height="12" rx="2.5" fill="#e6eef6" stroke={INK} strokeWidth="1.8" />
      <path d="M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2" fill="none" stroke={INK} strokeWidth="1.8" />
      <rect x="10" y="11.5" width="4" height="3" rx="1" fill="#2a6fd8" />
    </svg>
  )
}

const BADGE: Record<BoardId, string> = {
  classic: 'linear-gradient(180deg,#d9ecff 0%,#7fb6ef 45%,#3c6fb4 100%)',
  gold: 'linear-gradient(180deg,#fff6c8 0%,#ffd04f 45%,#c9860a 100%)',
  diamond: 'linear-gradient(110deg,#e9fdff 0%,#9fe3ff 30%,#c9a8ff 62%,#ffd1f4 100%)',
}

/** the board's badge; `label` replaces the board's name (the reveal flicks through them) */
export function TierBadge({ board, size = 'md', label, top }: { board: BoardId; size?: 'sm' | 'md' | 'lg'; label?: string; top?: string }) {
  const s = size === 'lg' ? { h: 52, fs: 22, icon: 28, px: 18 } : size === 'md' ? { h: 34, fs: 14, icon: 19, px: 12 } : { h: 26, fs: 11.5, icon: 15, px: 9 }
  return (
    <div className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border-2 border-[#0b1220] shadow-[0_3px_0_rgba(11,18,32,.7)]" style={{ height: s.h, paddingLeft: s.px - 3, paddingRight: s.px, background: BADGE[board] }}>
      <span className="pointer-events-none absolute inset-x-[10%] top-[8%] h-[36%] rounded-full bg-white/35" />
      {board !== 'classic' && <Sheen period={board === 'diamond' ? 1.8 : 2.4} />}
      <span className="relative">
        <TierIcon board={board} size={s.icon} />
      </span>
      <span className="relative whitespace-nowrap font-black uppercase leading-none tracking-[0.08em] text-[#14100a]" style={{ fontSize: s.fs }}>
        {label ?? TIERS[board].name}
      </span>
      {top && (
        <span className="tnum relative rounded-full bg-[#0b1220]/80 px-1.5 py-[2px] font-black leading-none text-white" style={{ fontSize: s.fs * 0.78 }}>
          {top}
        </span>
      )}
      {board === 'diamond' &&
        [0.16, 0.56, 0.88].map((x, i) => (
          <motion.svg
            key={i}
            aria-hidden
            className="pointer-events-none absolute"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            style={{ left: `${x * 100}%`, top: i % 2 ? '8%' : '52%', marginLeft: -5 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0.5, 1.1, 0.5] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.45 }}
          >
            <Spark x={5} y={5} r={2.2} />
          </motion.svg>
        ))}
    </div>
  )
}

/** the rounds as pips: past rounds full, the current one filling, the final two last */
export function RoundTrack({ opened, round, final, compact }: { opened: number; round: number; final: boolean; compact: boolean }) {
  let start = 0
  const pip = compact ? 6 : 8
  return (
    <div className="flex items-center" style={{ gap: compact ? 5 : 8 }} aria-label={final ? 'The final two' : `Round ${round + 1} of ${ROUNDS.length}`}>
      {ROUNDS.map((n, r) => {
        const from = start
        start += n
        const cur = r === round && !final
        return (
          <div key={r} className={`flex items-center rounded-full ${cur ? 'bg-white/10 ring-1 ring-white/20' : ''}`} style={{ gap: 2, padding: compact ? '3px 4px' : '4px 6px' }}>
            {Array.from({ length: n }, (_, i) => {
              const done = from + i < opened
              return <span key={i} className="rounded-full transition-colors duration-300" style={{ width: pip, height: pip, background: done ? '#ffd45c' : cur ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.14)', boxShadow: done ? '0 0 6px rgba(255,212,92,.7)' : undefined }} />
            })}
          </div>
        )
      })}
      <div className={`rounded-full px-1.5 font-black leading-none ${final ? 'bg-[#ffd45c] text-[#2a1600]' : 'bg-white/10 text-white/40'}`} style={{ fontSize: compact ? 9 : 10.5, paddingTop: compact ? 3 : 4, paddingBottom: compact ? 3 : 4 }}>
        FINAL
      </div>
    </div>
  )
}

/** the pedestal the player's case stands on, centred at x with its top at y */
export function Podium({ x, y, w, lit }: { x: number; y: number; w: number; lit: boolean }) {
  const h = w * 0.34
  return (
    <div className="pointer-events-none absolute" style={{ left: x - w / 2, top: y - h * 0.3, width: w, height: h * 1.6 }} aria-hidden>
      <motion.div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ bottom: h * 1.1, width: w * 0.95, height: w * 1.4, background: 'linear-gradient(180deg, rgba(255,240,200,0), rgba(255,240,200,.16))', clipPath: 'polygon(38% 0, 62% 0, 100% 100%, 0 100%)' }}
        initial={false}
        animate={{ opacity: lit ? 1 : 0.35 }}
      />
      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 54" preserveAspectRatio="none">
        <defs>
          <linearGradient id="deal-pod-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1a1408" />
            <stop offset=".35" stopColor="#5a4316" />
            <stop offset=".5" stopColor="#8a6a22" />
            <stop offset=".65" stopColor="#5a4316" />
            <stop offset="1" stopColor="#1a1408" />
          </linearGradient>
          <radialGradient id="deal-pod-top" cx=".5" cy=".5" r=".55">
            <stop offset="0" stopColor="#3a3f63" />
            <stop offset="1" stopColor="#151830" />
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="46" rx="50" ry="8" fill="#000" opacity=".45" />
        <path d="M4 14 V38 C4 44.6 24.6 50 50 50 C75.4 50 96 44.6 96 38 V14Z" fill="url(#deal-pod-side)" stroke={INK} strokeWidth="1.4" />
        <ellipse cx="50" cy="14" rx="46" ry="10" fill="url(#deal-pod-top)" stroke="#f2c14e" strokeWidth="1.6" />
        <ellipse cx="50" cy="14" rx="40" ry="7.5" fill="none" stroke="#fff" strokeOpacity=".1" />
        {[16, 30, 50, 70, 84].map((cx) => (
          <circle key={cx} cx={cx} cy={cx === 50 ? 49 : cx === 30 || cx === 70 ? 47.5 : 44.5} r="1.5" fill="#fff3c4" opacity={lit ? 0.95 : 0.45} />
        ))}
      </svg>
    </div>
  )
}
