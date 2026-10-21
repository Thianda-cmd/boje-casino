import { useEffect, useState } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { useUid } from '../../art/ids'
import { dealSfx } from './sound'
import { coinText, multText } from './words'

/*
  The Banker. He sits in a booth over the studio floor: a silhouette behind frosted amber glass, a green banker's lamp
  and an old black telephone on his desk. When a round is done his phone rings (the handset jumps, the glass flashes
  red), and his offer comes up on the big screen over the cases: first the call ("The Banker is calling…"), then the
  figure builds on a riser and rolls up to his price, then the giant DEAL and NO DEAL buttons come up (and, at the
  final two, SWAP). A tap on the screen while it builds skips to the buttons.
*/

const INK = '#0b1220'

/** the booth: silhouette, lamp and phone; `ringing` makes the phone jump and the glass flash */
export function BankerBooth({ w, ringing, talking = false }: { w: number; ringing: boolean; talking?: boolean }) {
  const u = useUid() + 'bk'
  const h = (w * 80) / 140
  return (
    <svg width={w} height={h} viewBox="0 0 140 80" aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={`${u}wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a3820" />
          <stop offset="1" stopColor="#21120a" />
        </linearGradient>
        <radialGradient id={`${u}glass`} cx=".5" cy=".42" r=".7">
          <stop offset="0" stopColor="#ffe2a0" />
          <stop offset=".55" stopColor="#f0a040" />
          <stop offset="1" stopColor="#7a3a0c" />
        </radialGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f2c14e" />
          <stop offset="1" stopColor="#a8720c" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="136" height="76" rx="12" fill={`url(#${u}wood)`} stroke={INK} strokeWidth="2.5" />
      <rect x="5" y="5" width="130" height="70" rx="10" fill="none" stroke={`url(#${u}gold)`} strokeWidth="1.6" />
      {/* the frosted window and its light */}
      <rect x="12" y="10" width="116" height="52" rx="7" fill={`url(#${u}glass)`} stroke={INK} strokeWidth="2" />
      <motion.rect x="12" y="10" width="116" height="52" rx="7" fill="#ff3348" initial={false} animate={{ opacity: ringing ? [0, 0.55, 0, 0.55, 0] : 0 }} transition={ringing ? { duration: 1.25, repeat: Infinity } : { duration: 0.2 }} />
      {/* the man himself */}
      <g fill="#140a05">
        <path d="M40 62 C41 50 50 45 60 43.5 L64 40 H76 L80 43.5 C90 45 99 50 100 62Z" />
        <rect x="64.5" y="36" width="11" height="8" rx="3" />
        <ellipse cx="70" cy="27.5" rx="10.5" ry="12" />
        <ellipse cx="59.8" cy="28.5" rx="2" ry="3.2" />
        <ellipse cx="80.2" cy="28.5" rx="2" ry="3.2" />
        <path d="M59.5 24 C59.5 15 65 13.5 70 13.5 C77 13.5 81 17 80.6 24 C78 20 74 19 70 19 C65 19 62 20.5 59.5 24Z" />
      </g>
      <path d="M66 44 L70 52 L74 44" fill="none" stroke="#3a1a0a" strokeWidth="1.6" />
      <motion.ellipse cx="70" cy="34" rx="3" ry="1.2" fill="#3a1a0a" initial={false} animate={{ ry: talking ? [0.6, 1.8, 0.6] : 0.6 }} transition={talking ? { duration: 0.32, repeat: Infinity } : { duration: 0.2 }} />
      {/* frosted glass sheen */}
      <path d="M16 14 L46 14 L28 58 L16 58Z" fill="#fff" opacity=".12" />
      {/* the desk */}
      <rect x="8" y="58" width="124" height="14" rx="3" fill="#2c180c" stroke={INK} strokeWidth="1.8" />
      <rect x="10" y="59.5" width="120" height="2.5" rx="1" fill="#fff" opacity=".1" />
      {/* the banker's lamp */}
      <path d="M26 58 V52" stroke={`url(#${u}gold)`} strokeWidth="2" />
      <path d="M17 52 C17 46 22 44 26.5 44 C31 44 36 46 36 52Z" fill="#1d8a4a" stroke={INK} strokeWidth="1.6" />
      <path d="M19 51 C20 48 23 46.5 26 46.3" stroke="#7cf0a8" strokeWidth="1.2" fill="none" opacity=".7" />
      <ellipse cx="26.5" cy="53" rx="8" ry="1.6" fill="#fff3b8" opacity=".6" />
      {/* the phone */}
      <path d="M100 58 L103 49 H119 L122 58Z" fill="#111" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="111" cy="53.5" r="3" fill="#eae0c8" stroke={INK} strokeWidth="1" />
      <motion.g style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }} initial={false} animate={ringing ? { rotate: [0, -10, 9, -8, 7, 0], y: [0, -3, 0, -3, 0, 0] } : { rotate: 0, y: 0 }} transition={ringing ? { duration: 0.42, repeat: Infinity, repeatDelay: 0.2 } : { duration: 0.2 }}>
        <path d="M98 47 C98 43 101 42 104 43 L106 45 H116 L118 43 C121 42 124 43 124 47 L121 48.5 C119.5 47 117.5 46.6 116 47.6 H106 C104.5 46.6 102.5 47 101 48.5Z" fill="#161616" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      </motion.g>
      <AnimatePresence>
        {ringing && (
          <motion.g key="waves" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.62, repeat: Infinity }} stroke="#ffd45c" strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M127 40 C130 43 130 47 127 50" />
            <path d="M131 36 C136 41 136 49 131 54" />
            <path d="M95 40 C92 43 92 47 95 50" />
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  )
}

export type OfferPhase = 'ring' | 'build' | 'ready' | 'deal' | 'nodeal'

/** the figure rolling up to the offer as it builds */
function useRoll(to: number, on: boolean) {
  const [v, setV] = useState(on ? 0 : to)
  useEffect(() => {
    if (!on) return setV(to)
    const c = animate(0, to, {
      duration: 1.15,
      ease: [0.3, 0.1, 0.25, 1],
      onUpdate: (x) => {
        setV(x)
        dealSfx.count(x / (to || 1))
      },
    })
    return () => c.stop()
  }, [to, on])
  return v
}

/** where the offer sits among the prizes still in play: each prize a dot on a square-root scale, the average and the offer marked */
function OfferMeter({ left, offer, avg, narrow }: { left: { coins: number; high: boolean }[]; offer: number; avg: number; narrow: boolean }) {
  const max = Math.max(...left.map((p) => p.coins), offer, 0.01)
  const at = (v: number) => `${(Math.sqrt(Math.max(0, v) / max) * 100).toFixed(2)}%`
  return (
    <div className={`relative w-full ${narrow ? 'mt-2 h-[30px] max-w-[300px]' : 'mt-4 h-[40px] max-w-[400px]'}`} aria-hidden>
      <div className="absolute inset-x-0 top-[9px] h-[8px] rounded-full bg-[linear-gradient(90deg,#1a55c4,#3b93f5_45%,#ffd04f_70%,#e39b14)] opacity-30" />
      <div className="absolute inset-x-0 top-[9px] h-[8px] rounded-full ring-1 ring-white/10" />
      {left.map((p, i) => (
        <span key={i} className="absolute top-[8px] h-[10px] w-[10px] -translate-x-1/2 rounded-full border-[1.5px] border-[#0b1220]" style={{ left: at(p.coins), background: p.high ? '#ffd04f' : '#5aa8ff' }} />
      ))}
      <span className="absolute top-[3px] h-[20px] w-[2px] -translate-x-1/2 rounded-full bg-white/80" style={{ left: at(avg) }} />
      <span className="absolute top-[24px] -translate-x-1/2 whitespace-nowrap text-[9.5px] font-black uppercase tracking-[0.12em] text-white/55" style={{ left: at(avg) }}>
        avg
      </span>
      <motion.span className="absolute top-[-4px] -translate-x-1/2" initial={{ left: '0%' }} animate={{ left: at(offer) }} transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.1 }}>
        <svg width="16" height="14" viewBox="0 0 16 14" className="drop-shadow-[0_0_6px_rgba(255,212,92,.8)]">
          <path d="M1 1h14L8 13z" fill="#ffd45c" stroke="#0b1220" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </motion.span>
      {!narrow && (
        <>
          <span className="tnum absolute left-0 top-[24px] text-[10px] font-bold text-white/35">{coinText(Math.min(...left.map((p) => p.coins)))}</span>
          <span className="tnum absolute right-0 top-[24px] text-[10px] font-bold text-white/35">{coinText(max)}</span>
        </>
      )}
    </div>
  )
}

export function OfferScreen({
  phase,
  coins,
  mult,
  avg,
  best,
  left,
  earlier,
  final,
  swapTo,
  narrow,
  onDeal,
  onNoDeal,
  onSwap,
  onSkip,
}: {
  phase: OfferPhase
  coins: number
  mult: number
  /** the average and the best of the prizes left, in coins */
  avg: number
  best: number
  /** the prizes left, in coins (for the meter) */
  left: { coins: number; high: boolean }[]
  /** the earlier offers, in coins */
  earlier: number[]
  final: boolean
  /** the case a swap would take (its number) */
  swapTo: number | null
  narrow: boolean
  onDeal: () => void
  onNoDeal: () => void
  onSwap: () => void
  onSkip: () => void
}) {
  const ringing = phase === 'ring'
  const rolled = useRoll(coins, phase === 'build')
  const ready = phase === 'ready'
  const big = narrow ? 'text-[38px]' : 'text-[68px]'
  return (
    <div
      className="relative h-full rounded-[22px] border-[3px] border-[#0b1220] p-[4px] shadow-[0_30px_70px_-20px_rgba(0,0,0,.9),0_0_60px_-10px_rgba(255,190,70,.35)]"
      style={{ background: 'linear-gradient(180deg,#fff0b0,#e8b23a 40%,#9a6508 100%)' }}
      onClick={phase === 'build' || ringing ? onSkip : undefined}
    >
      <div className="relative flex h-full flex-col items-center overflow-hidden rounded-[17px] border-2 border-[#0b1220] px-3 pb-3 pt-2.5 sm:px-6 sm:pb-5 sm:pt-4" style={{ background: 'radial-gradient(ellipse 85% 65% at 50% 28%, #24407a 0%, #12204a 48%, #080e22 100%)' }}>
        <motion.div className="pointer-events-none absolute inset-0" initial={false} animate={{ opacity: ringing ? [0.15, 0.6, 0.15] : 0 }} transition={ringing ? { duration: 0.62, repeat: Infinity } : { duration: 0.3 }} style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(255,50,72,.55), transparent 70%)' }} />
        <div className="pointer-events-none absolute inset-0 opacity-[.05] [background:repeating-linear-gradient(0deg,#fff_0,#fff_1px,transparent_1px,transparent_3px)]" />
        <div className="pointer-events-none absolute -top-[30%] left-1/2 h-[70%] w-[90%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,220,140,.16),transparent)]" />
        <AnimatePresence mode="wait">
          {ringing ? (
            <motion.div key="ring" className="relative flex flex-1 flex-col items-center justify-center gap-3" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}>
              <motion.div animate={{ rotate: [0, -2, 2, -2, 0] }} transition={{ duration: 0.4, repeat: Infinity, repeatDelay: 0.2 }}>
                <BankerBooth w={narrow ? 130 : 210} ringing />
              </motion.div>
              <motion.div className="text-center text-[14px] font-black uppercase tracking-[0.24em] text-[#ffd45c] sm:text-[18px]" animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 0.62, repeat: Infinity }}>
                The Banker is calling
              </motion.div>
              <div className="text-[11px] font-bold text-white/40">Tap to skip</div>
            </motion.div>
          ) : (
            <motion.div key="offer" className="relative flex w-full flex-1 flex-col items-center" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
              <div className="flex items-center gap-2.5">
                {!narrow && <BankerBooth w={64} ringing={false} talking={phase === 'build'} />}
                <div className="flex flex-col items-center">
                  <span className="text-[11px] font-black uppercase tracking-[0.28em] text-[#ffd45c] sm:text-[13px]">{final ? 'The last offer' : "The Banker's offer"}</span>
                  {!narrow && <span className="mt-0.5 text-[11px] font-bold text-white/45">{final ? 'Take it, keep your case, or swap' : 'for your case, right now'}</span>}
                </div>
              </div>
              <div className="relative flex w-full flex-1 flex-col items-center justify-center">
                <motion.div
                  className={`tnum flex items-center gap-2 font-black leading-none tracking-tight ${big}`}
                  animate={phase === 'deal' ? { scale: [1, 1.12, 1] } : ready ? { scale: [1.1, 1] } : {}}
                  transition={{ duration: 0.45 }}
                >
                  <span className="bg-[linear-gradient(180deg,#fffbe6_0%,#ffd75e_50%,#e8960e_100%)] bg-clip-text text-transparent [filter:drop-shadow(0_3px_0_rgba(0,0,0,.6))_drop-shadow(0_0_24px_rgba(255,200,80,.45))]">{fmt(rolled)}</span>
                  <Coin size={narrow ? 28 : 48} />
                </motion.div>
                <div className="tnum mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[11.5px] font-extrabold sm:text-[13px]">
                  <span className="rounded-full bg-[#ffd45c]/15 px-2.5 py-0.5 text-[#ffd45c] ring-1 ring-[#ffd45c]/30">{multText(mult)} your stake</span>
                  <span className="rounded-full bg-white/[.07] px-2.5 py-0.5 text-white/70">
                    avg left <b className="text-white">{coinText(avg)}</b>
                  </span>
                  {!narrow && (
                    <span className="rounded-full bg-white/[.07] px-2.5 py-0.5 text-white/70">
                      best left <b className="text-[#ffd45c]">{coinText(best)}</b>
                    </span>
                  )}
                </div>
                <OfferMeter left={left} offer={coins} avg={avg} narrow={narrow} />
                {!narrow && earlier.length > 0 && (
                  <div className="mt-2 flex max-w-full items-center gap-1 overflow-hidden">
                    <span className="mr-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/35">Earlier</span>
                    {earlier.map((o, i) => (
                      <span key={i} className="tnum shrink-0 rounded-md bg-white/[.07] px-1.5 py-0.5 text-[11px] font-extrabold text-white/60">
                        {coinText(o)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <AnimatePresence>
                {(ready || phase === 'deal' || phase === 'nodeal') && (
                  <motion.div key="buttons" className="mt-2 flex w-full flex-col gap-2" initial={{ opacity: 0, y: 24 }} animate={{ opacity: ready ? 1 : 0.4, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }}>
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <BigButton tone="deal" disabled={!ready} onClick={onDeal} label="DEAL" sub={`Take ${coinText(coins)}`} hint="D" narrow={narrow} />
                      <BigButton tone="nodeal" disabled={!ready} onClick={onNoDeal} label="NO DEAL" sub={final ? 'Open my case' : 'Play on'} hint="N" narrow={narrow} />
                    </div>
                    {final && swapTo != null && <BigButton tone="swap" disabled={!ready} onClick={onSwap} label="SWAP" sub={`Take case ${swapTo} instead`} hint="S" narrow={narrow} slim />}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

const TONES = {
  deal: { bg: 'linear-gradient(180deg,#8dffbd 0%,#22d36f 40%,#0c8a43 100%)', glow: 'rgba(34,211,111,.55)', ink: '#04230f' },
  nodeal: { bg: 'linear-gradient(180deg,#ffa3ad 0%,#ff4d61 40%,#b0122a 100%)', glow: 'rgba(255,77,97,.55)', ink: '#fff' },
  swap: { bg: 'linear-gradient(180deg,#cdbcff 0%,#8f6dff 45%,#5232c9 100%)', glow: 'rgba(143,109,255,.5)', ink: '#fff' },
}

function BigButton({ tone, label, sub, hint, onClick, disabled, narrow, slim = false }: { tone: keyof typeof TONES; label: string; sub: string; hint: string; onClick: () => void; disabled: boolean; narrow: boolean; slim?: boolean }) {
  const t = TONES[tone]
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      whileHover={disabled ? undefined : { y: -2, filter: 'brightness(1.08)' }}
      whileTap={disabled ? undefined : { y: 2, scale: 0.98 }}
      aria-label={`${label}: ${sub} (key ${hint})`}
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border-[3px] border-[#0b1220] disabled:cursor-default ${slim ? (narrow ? 'h-[44px]' : 'h-[50px]') : narrow ? 'h-[58px]' : 'h-[72px]'}`}
      style={{ background: t.bg, color: t.ink, boxShadow: `0 5px 0 rgba(11,18,32,.85), 0 12px 30px -8px ${t.glow}, inset 0 2px 0 rgba(255,255,255,.45)` }}
    >
      <span className="pointer-events-none absolute inset-x-[8%] top-[6%] h-[38%] rounded-full bg-white/25" />
      <span className={`relative font-black italic leading-none tracking-tight ${slim ? 'text-[18px] sm:text-[20px]' : narrow ? 'text-[22px]' : 'text-[30px]'}`} style={{ textShadow: tone === 'deal' ? '0 1px 0 rgba(255,255,255,.5)' : '0 2px 0 rgba(0,0,0,.35)' }}>
        {label}
      </span>
      <span className="tnum relative mt-0.5 text-[11px] font-extrabold opacity-80 sm:text-[12px]">{sub}</span>
      {!narrow && <span className="absolute right-2 top-1.5 rounded-md bg-black/20 px-1.5 text-[10px] font-black opacity-70">{hint}</span>}
    </motion.button>
  )
}
