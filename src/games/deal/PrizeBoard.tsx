import { motion } from 'framer-motion'
import { Sheen } from './Case'
import { coinText } from './words'

/*
  The prize board, as the show has it: the sixteen prizes of tonight's board as value bars, the low half in blue and
  the high half in gold, the top prize with a sheen. A prize still in play is lit; as soon as a case shows it, its bar
  turns over to a dark face with the value struck through. On a wide stage the bars stand in two columns either side
  of the cases; on a phone they are two rows of chips over the cases.

  Each bar is a two-faced card turned in 3D, so the flip is a real flip; a prize already gone when the page comes up
  is drawn dark with no animation.
*/

export interface BarSpec {
  /** the prize's place on its board (0-15) */
  k: number
  coins: number
  lit: boolean
}

const FACE = {
  low: { bg: 'linear-gradient(180deg,#9fd3ff 0%,#3b93f5 42%,#1a55c4 100%)', ink: '#fff', shadow: '0 1px 0 rgba(0,20,60,.55)' },
  high: { bg: 'linear-gradient(180deg,#fff4c2 0%,#ffd04f 45%,#d9900c 100%)', ink: '#2a1600', shadow: '0 1px 0 rgba(255,255,255,.55)' },
}

function Bar({ spec, w, h, high, top, chip }: { spec: BarSpec; w: number; h: number; high: boolean; top: boolean; chip: boolean }) {
  const f = high ? FACE.high : FACE.low
  const text = coinText(spec.coins)
  const fs = chip ? Math.min(11, h * 0.5) : Math.min(17, h * 0.42, w / Math.max(4, text.length) * 1.45)
  const r = chip ? 6 : Math.min(12, h * 0.32)
  return (
    <div className="relative" style={{ width: w, height: h, perspective: 400 }}>
      <motion.div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }} initial={false} animate={{ rotateX: spec.lit ? 0 : 180 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }}>
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden border-[1.5px] border-[#0b1220] [backface-visibility:hidden]"
          style={{ borderRadius: r, background: top ? 'linear-gradient(110deg,#fff7d1 0%,#ffd04f 30%,#ff9fe0 62%,#8fd8ff 100%)' : f.bg, boxShadow: `inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 0 rgba(0,0,0,.18), 0 0 ${chip ? 6 : 12}px ${high ? 'rgba(255,196,60,.35)' : 'rgba(70,150,255,.3)'}` }}
        >
          <span className="pointer-events-none absolute inset-x-[6%] top-[8%] h-[34%] rounded-full bg-white/25" />
          {top && <Sheen period={2.6} />}
          <span className="tnum relative whitespace-nowrap font-black leading-none tracking-tight" style={{ fontSize: fs, color: top ? '#2a1600' : f.ink, textShadow: top ? FACE.high.shadow : f.shadow }}>
            {text}
          </span>
        </div>
        <div className="absolute inset-0 flex items-center justify-center border-[1.5px] border-[#1a2838] bg-[#0a121c] [backface-visibility:hidden] [transform:rotateX(180deg)]" style={{ borderRadius: r }}>
          <span className="tnum relative whitespace-nowrap font-extrabold leading-none text-[#3b5068]" style={{ fontSize: fs * 0.92 }}>
            {text}
            <span className="absolute inset-x-[-3px] top-1/2 h-[1.5px] -translate-y-1/2 bg-[#3b5068]/80" />
          </span>
        </div>
      </motion.div>
    </div>
  )
}

/** one column of eight bars (the wide stage): the low half on the left, the high half on the right */
export function PrizeColumn({ bars, w, barH, gap, high }: { bars: BarSpec[]; w: number; barH: number; gap: number; high: boolean }) {
  return (
    <div className="flex flex-col" style={{ gap }} role="list" aria-label={high ? 'High prizes' : 'Low prizes'}>
      {bars.map((b) => (
        <div key={b.k} role="listitem" aria-label={`${coinText(b.coins)}${b.lit ? '' : ', gone'}`}>
          <Bar spec={b} w={w} h={barH} high={high} top={b.k === 15} chip={false} />
        </div>
      ))}
    </div>
  )
}

/** two rows of eight chips (a phone) */
export function PrizeRows({ low, high, w, chipH, gap }: { low: BarSpec[]; high: BarSpec[]; w: number; chipH: number; gap: number }) {
  const cw = (w - gap * 7) / 8
  return (
    <div className="flex flex-col" style={{ gap }} role="list" aria-label="Prizes">
      {[low, high].map((row, ri) => (
        <div key={ri} className="flex" style={{ gap }}>
          {row.map((b) => (
            <div key={b.k} role="listitem" aria-label={`${coinText(b.coins)}${b.lit ? '' : ', gone'}`}>
              <Bar spec={b} w={cw} h={chipH} high={ri === 1} top={b.k === 15} chip />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
