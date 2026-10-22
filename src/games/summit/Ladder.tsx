import { motion } from 'framer-motion'
import { PITCHES, ROUTES, multiplierOf, nextMultiplier, type RouteId } from './rules'
import type { Layout } from './geom'
import { FlagMark } from './art'
import { fmt } from '../../lib/format'
import { LOOK, altOf, multText } from './words'

/*
  The altitude ladder down the side of the stage: the eleven camps from Base Camp to the summit, with what the climb
  is worth at each one made (a rope runs up the side, coloured by the route that made each pitch), the camp the
  climber is on lit up, the next camp showing what it could make (the range from the Trail to the Sheer Wall, or the
  route pointed at), and the summit with the most the climb could still reach. On a phone it is a slim gauge of the
  same eleven stops.
*/

const maxFrom = (path: readonly RouteId[]) => multiplierOf([...path, ...Array<RouteId>(PITCHES - path.length).fill('wall')])

export function Ladder({ L, path, at, fellOn, hover, choosing }: { L: Layout; path: readonly RouteId[]; at: number; fellOn: RouteId | null; hover: RouteId | null; choosing: boolean }) {
  const box = L.ladder
  const rows = PITCHES + 1
  if (!L.wide) {
    // the phone's gauge
    const step = (box.h - 18) / (rows - 1)
    const yOf = (k: number) => box.h - 9 - k * step
    return (
      <div className="pointer-events-none absolute z-[12]" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
        <div className="absolute inset-0 rounded-full bg-black/35 ring-1 ring-white/10 backdrop-blur-[2px]" />
        <svg className="absolute inset-0" width={box.w} height={box.h} aria-hidden>
          <line x1={box.w / 2} x2={box.w / 2} y1={yOf(0)} y2={yOf(PITCHES)} stroke="rgba(255,255,255,.18)" strokeWidth={2} />
          {path.map((r, i) => (
            <line key={i} x1={box.w / 2} x2={box.w / 2} y1={yOf(i)} y2={yOf(i + 1)} stroke={LOOK[r].a} strokeWidth={3} strokeLinecap="round" />
          ))}
          {Array.from({ length: rows }, (_, k) => {
            const made = k <= path.length
            const now = k === at
            const fell = fellOn && k === path.length + 1
            const next = choosing && k === at + 1
            const c = k === 0 ? '#e8eef5' : made ? LOOK[path[k - 1]].a : fell ? '#ff4d61' : next && hover ? LOOK[hover].a : 'rgba(255,255,255,.28)'
            return (
              <g key={k}>
                {now && <circle cx={box.w / 2} cy={yOf(k)} r={8} fill="none" stroke="#fff" strokeWidth={1.6} opacity={0.85} />}
                {k === PITCHES && !now ? (
                  <g>
                    <path d={`M${box.w / 2 - 3} ${yOf(k) + 5}V${yOf(k) - 6}`} stroke="#e8eef5" strokeWidth={1.6} strokeLinecap="round" />
                    <path d={`M${box.w / 2 - 2.5} ${yOf(k) - 6}H${box.w / 2 + 5}L${box.w / 2 + 3} ${yOf(k) - 3}L${box.w / 2 + 5} ${yOf(k)}H${box.w / 2 - 2.5}Z`} fill={path.length >= PITCHES ? '#f7c548' : '#ff4d61'} stroke="#0b1220" strokeWidth={0.8} />
                  </g>
                ) : (
                  <circle cx={box.w / 2} cy={yOf(k)} r={now ? 5 : 3.4} fill={c} stroke="#0b1220" strokeWidth={1.2} />
                )}
                {fell && <path d={`M${box.w / 2 - 3} ${yOf(k) - 3}l6 6m0-6l-6 6`} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />}
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  const rowH = (box.h - 26) / rows
  const hi = choosing ? Math.max(...ROUTES.map((r) => nextMultiplier(path, r.id))) : 0
  return (
    <div className="pointer-events-none absolute z-[12] flex flex-col overflow-hidden rounded-2xl bg-[#070d1a]/60 ring-1 ring-white/10 backdrop-blur-[3px]" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div className="flex h-[26px] shrink-0 items-center justify-between px-2.5 text-[9.5px] font-black uppercase tracking-[0.18em] text-white/45">
        <span>Metres</span>
        <span>Pays</span>
      </div>
      <div className="relative flex-1">
        {/* the rope up the side */}
        <div className="absolute w-[2px] bg-white/15" style={{ left: 17, top: rowH / 2, bottom: rowH / 2 }} />
        {path.map((r, i) => (
          <div key={i} className="absolute w-[3px] rounded-full" style={{ left: 16.5, background: LOOK[r].a, top: (PITCHES - i - 1) * rowH + rowH / 2, height: rowH }} />
        ))}
        {Array.from({ length: rows }, (_, j) => {
          const k = PITCHES - j
          const made = k >= 1 && k <= path.length
          const now = k === at
          const fell = !!fellOn && k === path.length + 1
          const next = choosing && k === at + 1
          const m = made ? multiplierOf(path.slice(0, k)) : 0
          let right: React.ReactNode
          let upTo = false
          let tone = 'text-white/30'
          if (k === 0) {
            right = 'stake'
            tone = 'text-white/45'
          } else if (made) {
            right = multText(m)
            tone = now ? 'text-gold' : 'text-white/85'
          } else if (fell) {
            right = 'fell'
            tone = 'text-danger'
          } else if (next) {
            right = multText(hover ? nextMultiplier(path, hover) : hi)
            upTo = !hover
            tone = hover ? '' : 'text-white/70'
          } else if (k === PITCHES) {
            right = multText(maxFrom(path))
            upTo = true
            tone = 'text-white/50'
          } else right = '·'
          const dot = k === 0 ? '#e8eef5' : made ? LOOK[path[k - 1]].a : fell ? '#ff4d61' : next && hover ? LOOK[hover].a : '#2a3550'
          const lit = k === 0 || made || fell || (next && !!hover)
          return (
            <div key={k} className="absolute inset-x-0 flex items-center gap-1.5 pl-[8px] pr-2" style={{ top: j * rowH, height: rowH }}>
              {now && <motion.div layoutId="summit-now" className="absolute inset-x-1 inset-y-[3px] rounded-lg bg-gold/15 ring-1 ring-gold/50" transition={{ type: 'spring', stiffness: 260, damping: 28 }} />}
              <span className="relative flex h-[19px] w-[19px] shrink-0 items-center justify-center">
                {k === PITCHES ? (
                  <span className="flex h-[19px] w-[19px] items-center justify-center rounded-full bg-[#0b1220] text-white/70 ring-1 ring-white/20">
                    <FlagMark size={12} color={path.length >= PITCHES ? '#f7c548' : '#ff4d61'} />
                  </span>
                ) : (
                  <span className={`flex items-center justify-center rounded-full text-[9.5px] font-black leading-none ring-2 ring-[#0b1220] ${now ? 'h-[19px] w-[19px]' : 'h-[16px] w-[16px]'}`} style={{ background: dot, color: lit ? '#0b1220' : 'rgba(255,255,255,.55)' }}>
                    {k === 0 ? 'B' : fell ? '✕' : k}
                  </span>
                )}
              </span>
              <span className={`tnum relative min-w-0 flex-1 truncate text-[11px] font-extrabold leading-none ${now ? 'text-white' : made || k === 0 ? 'text-white/75' : 'text-white/40'}`}>{k === PITCHES ? '' : fmt(altOf(k), 0)}</span>
              <span className={`tnum relative shrink-0 text-right font-black leading-none ${tone}`} style={next && hover ? { color: LOOK[hover].a } : undefined}>
                {upTo && <span className="block text-[8.5px] font-extrabold uppercase tracking-[0.08em] opacity-70">up to</span>}
                <span className="text-[11.5px]">{right}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
