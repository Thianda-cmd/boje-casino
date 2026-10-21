import { useEffect, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { marketSfx } from './sound'
import { signed } from './levels'

/*
  The moments a close brings, over the chart: a result pill at the foot of the chart for every close (the profit in
  green, a loss in grey, a liquidation in red), and for a close worth 3× its stake or more, the big win: the tier's
  lettering (Big win, Huge win at 10×, Legendary at 50×) over turning rays, the multiple, and the coins counted up. A
  tap ends it early.
*/

export const tierOf = (mult: number) => (mult >= 50 ? 3 : mult >= 10 ? 2 : mult >= 3 ? 1 : 0)
const TIER_NAME = ['', 'Big win!', 'Huge win!', 'Legendary!']
/** how long each tier counts the win up (ms), and how long it stays after */
export const TIER_MS = [0, 1500, 2200, 3200]
export const TIER_HOLD = 1700

function useCount(to: number, ms: number) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let last = 0
    const c = animate(0, to, {
      duration: ms / 1000,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (x) => {
        setV(x)
        const now = performance.now()
        if (now - last > 70) {
          last = now
          marketSfx.count(x / (to || 1))
        }
      },
    })
    return () => c.stop()
  }, [to, ms])
  return v
}

/** lettering in the lobby's cartoon style: a dark outline under a gradient face */
function Lettering({ text, face, className }: { text: string; face: string; className: string }) {
  return (
    <span className={`relative inline-block whitespace-nowrap font-black uppercase italic leading-none tracking-tight ${className}`}>
      <span aria-hidden className="absolute inset-0 pl-[0.06em] pr-[0.14em] text-[#04141a] [-webkit-text-stroke:0.16em_#04141a] [filter:drop-shadow(0_0.07em_0_#04141a)]">
        {text}
      </span>
      <span className="relative block bg-clip-text pl-[0.06em] pr-[0.14em] text-transparent" style={{ backgroundImage: face }}>
        {text}
      </span>
    </span>
  )
}

const FACE = [
  '',
  'linear-gradient(180deg,#f2fff9 0%,#7dffd6 42%,#00b88c 100%)',
  'linear-gradient(180deg,#fff6cf 0%,#ffd45c 45%,#f39b12 100%)',
  'linear-gradient(100deg,#ff4fd8 0%,#ffe23d 30%,#6dff5a 55%,#2fd3ff 78%,#b38bff 100%)',
]

export function BigWin({ tier, amount, mult, compact, onDone }: { tier: number; amount: number; mult: number; compact: boolean; onDone: () => void }) {
  const counted = useCount(amount, TIER_MS[tier])
  const legend = tier >= 3
  return (
    <motion.div
      className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      onClick={onDone}
      role="status"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_48%,rgba(2,10,14,.82)_0%,rgba(2,10,14,.5)_55%,transparent_90%)]" />
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(150vw,980px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 [mask-image:radial-gradient(circle,black_12%,transparent_50%)]"
        style={{
          background: legend
            ? 'repeating-conic-gradient(from 0deg, #ff4fd8 0deg 8deg, transparent 8deg 20deg, #ffe23d 20deg 28deg, transparent 28deg 40deg, #2fd3ff 40deg 48deg, transparent 48deg 60deg)'
            : tier === 2
              ? 'repeating-conic-gradient(from 0deg, #ffd45c 0deg 9deg, transparent 9deg 22deg)'
              : 'repeating-conic-gradient(from 0deg, #4dffd0 0deg 9deg, transparent 9deg 22deg)',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: legend ? 14 : 22, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div className="relative flex flex-col items-center" initial={{ scale: 0.35, y: 24 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <motion.div
          className={`mb-2 rounded-full bg-[#04141a] font-black tracking-[0.2em] text-[#7dffd6] ring-1 ring-[#7dffd6]/40 ${compact ? 'px-3 py-0.5 text-[10.5px]' : 'px-3.5 py-1 text-[13px]'}`}
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.15, 1] }}
          transition={{ delay: 0.3, duration: 0.4 }}
        >
          CLOSED AT {mult >= 100 ? fmt(mult, 0) : mult.toFixed(2)}×
        </motion.div>
        <motion.div animate={{ scale: [1, 1.05, 1], rotate: [-1, 1, -1] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <Lettering text={TIER_NAME[tier]} face={FACE[tier]} className={legend ? (compact ? 'text-[38px]' : 'text-[74px]') : compact ? 'text-[36px]' : 'text-[64px]'} />
        </motion.div>
        <div className={`flex items-center gap-2 rounded-full border-[3px] border-[#04141a] bg-white shadow-[0_6px_0_rgba(4,20,26,.5)] ${compact ? 'mt-2 px-3 py-1' : 'mt-3 px-4 py-1.5'}`}>
          <span className={`tnum flex items-center gap-1.5 font-black text-[#04141a] ${compact ? 'text-[19px]' : 'text-[28px]'}`}>
            {fmt(counted)} <Coin size={compact ? 18 : 24} />
          </span>
        </div>
      </motion.div>
      <div className="pointer-events-none absolute bottom-9 left-0 right-0 text-center text-[11.5px] font-bold text-white/55">Tap to continue</div>
    </motion.div>
  )
}

/** what a close came to, for a moment at the foot of the chart */
export function ResultPill({ net, mult, liquidated, label }: { net: number; mult: number; liquidated: boolean; label: string }) {
  const won = net > 0
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center px-3"
      initial={{ opacity: 0, y: 18, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 22 }}
    >
      <div
        className={`tnum flex items-center gap-2.5 rounded-full border-2 py-1.5 pl-1.5 pr-4 font-black shadow-[0_14px_30px_-12px_rgba(0,0,0,.9)] ${
          liquidated ? 'border-[#ff8a96] bg-[linear-gradient(180deg,#ff5468,#c81e38)] text-white' : won ? 'border-[#8dffbe] bg-[linear-gradient(180deg,#3df08c,#17b45a)] text-[#032412]' : 'border-white/20 bg-[#1b2d3a] text-ink'
        }`}
      >
        <span className={`rounded-full px-2.5 py-1 text-[10.5px] tracking-[0.14em] ${liquidated ? 'bg-[#5a0614]/60 text-white' : won ? 'bg-[#032412] text-[#7dffb4]' : 'bg-white/10 text-muted'}`}>{label}</span>
        <span className="flex items-center gap-1 text-[18px] leading-none">
          {signed(net)} <Coin size={16} />
        </span>
        <span className="text-[12px] font-extrabold opacity-70">{mult.toFixed(2)}×</span>
      </div>
    </motion.div>
  )
}
