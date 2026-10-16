import { memo } from 'react'
import { motion } from 'framer-motion'
import { ROAD_ROWS, bigRoad, roadCounts, type RoadEntry } from './rules'

/*
  The table's scoreboard for the current shoe: the bead plate (every result in order, six to a column), the Big
  Road (a column per streak, ties as green slashes) and the counts. It starts over with each new shoe.
*/

export const SIDE_COLOR = { P: '#2f7cf6', B: '#e8344e', T: '#1fb866' } as const
const POP = { type: 'spring', stiffness: 520, damping: 22 } as const

function Grid({ cols, cell }: { cols: number; cell: number }) {
  const w = cols * cell
  const h = ROAD_ROWS * cell
  let d = ''
  for (let c = 1; c < cols; c++) d += `M${c * cell} 0V${h}`
  for (let r = 1; r < ROAD_ROWS; r++) d += `M0 ${r * cell}H${w}`
  return <path d={d} stroke="rgba(255,255,255,.07)" strokeWidth={1} shapeRendering="crispEdges" fill="none" />
}

/** pair markers: banker pair top-left in red, player pair bottom-right in blue */
function PairDots({ x, y, cell, pp, bp }: { x: number; y: number; cell: number; pp?: boolean; bp?: boolean }) {
  const r = Math.max(1.6, cell * 0.12)
  const o = cell * 0.3
  return (
    <>
      {bp && <circle cx={x - o} cy={y - o} r={r} fill={SIDE_COLOR.B} stroke="#03130e" strokeWidth={0.8} />}
      {pp && <circle cx={x + o} cy={y + o} r={r} fill={SIDE_COLOR.P} stroke="#03130e" strokeWidth={0.8} />}
    </>
  )
}

const BeadPlate = memo(function BeadPlate({ hist, cols, cell, letters }: { hist: RoadEntry[]; cols: number; cell: number; letters: boolean }) {
  const total = Math.ceil(hist.length / ROAD_ROWS)
  const first = Math.max(0, total - cols) * ROAD_ROWS
  return (
    <svg width={cols * cell} height={ROAD_ROWS * cell} className="shrink-0 overflow-visible" aria-label="Bead plate">
      <Grid cols={cols} cell={cell} />
      {hist.slice(first).map((e, j) => {
        const i = first + j
        const x = (Math.floor(j / ROAD_ROWS) + 0.5) * cell
        const y = ((j % ROAD_ROWS) + 0.5) * cell
        return (
          <motion.g key={i} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={POP} style={{ transformOrigin: `${x}px ${y}px` }}>
            <circle cx={x} cy={y} r={cell * 0.41} fill={SIDE_COLOR[e.w]} />
            {letters && (
              <text x={x} y={y} dy=".36em" textAnchor="middle" fontSize={cell * 0.52} fontWeight={800} fill="#fff">
                {e.w}
              </text>
            )}
            <PairDots x={x} y={y} cell={cell} pp={e.pp} bp={e.bp} />
          </motion.g>
        )
      })}
    </svg>
  )
})

const BigRoad = memo(function BigRoad({ hist, cols, cell }: { hist: RoadEntry[]; cols: number; cell: number }) {
  const cells = bigRoad(hist)
  const maxCol = cells.reduce((m, c) => Math.max(m, c.col), -1)
  const shift = Math.max(0, maxCol + 1 - cols)
  const r = cell * 0.34
  const sw = Math.max(1.4, cell * 0.13)
  return (
    <svg width={cols * cell} height={ROAD_ROWS * cell} className="shrink-0 overflow-hidden" aria-label="Big Road">
      <Grid cols={cols} cell={cell} />
      {cells.map((c, i) => {
        if (c.col < shift) return null
        const x = (c.col - shift + 0.5) * cell
        const y = (c.row + 0.5) * cell
        return (
          <motion.g key={i} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={POP} style={{ transformOrigin: `${x}px ${y}px` }}>
            <circle cx={x} cy={y} r={r} fill="none" stroke={SIDE_COLOR[c.w]} strokeWidth={sw} />
            {c.ties > 0 && (
              <motion.g key={c.ties} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <path d={`M${x - r * 1.05} ${y + r * 1.05}L${x + r * 1.05} ${y - r * 1.05}`} stroke={SIDE_COLOR.T} strokeWidth={sw * 1.1} strokeLinecap="round" />
                {c.ties > 1 && (
                  <text x={x} y={y} dy=".36em" textAnchor="middle" fontSize={cell * 0.5} fontWeight={800} fill="#c9ffe0">
                    {c.ties}
                  </text>
                )}
              </motion.g>
            )}
            <PairDots x={x} y={y} cell={cell} pp={c.pp} bp={c.bp} />
          </motion.g>
        )
      })}
    </svg>
  )
})

function Count({ side, label, n, big }: { side: 'P' | 'B' | 'T'; label: string; n: number; big: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="grid shrink-0 place-items-center rounded-full font-extrabold text-white" style={{ background: SIDE_COLOR[side], width: big ? 15 : 13, height: big ? 15 : 13, fontSize: big ? 9 : 8 }}>
        {side}
      </span>
      {big && <span className="text-[11px] font-semibold text-white/55">{label}</span>}
      <motion.span key={n} initial={{ opacity: 0.4, y: -3 }} animate={{ opacity: 1, y: 0 }} className="tnum ml-auto text-[12px] font-extrabold text-white/90">
        {n}
      </motion.span>
    </div>
  )
}

export function Scoreboard({
  hist,
  left,
  top,
  width,
  height,
  phone,
  shoe,
}: {
  hist: RoadEntry[]
  left: number
  top: number
  width: number
  height: number
  phone: boolean
  /** cards left and the cut card's place; null before the first shoe */
  shoe: { left: number; size: number; cutAt: number; lastHand: boolean } | null
}) {
  const pad = phone ? 6 : 9
  const cell = Math.max(8, Math.floor((height - pad * 2) / ROAD_ROWS))
  const statsW = phone ? 36 : 116
  const gap = phone ? 5 : 9
  // four gaps between the bead plate, the road, the stats and their two dividers
  const inner = width - pad * 2 - statsW - gap * 4 - 2
  const beadCols = Math.max(4, Math.min(phone ? 6 : 12, Math.floor((inner * 0.3) / cell)))
  const roadCols = Math.max(4, Math.floor((inner - beadCols * cell) / cell))
  const c = roadCounts(hist)
  const dealt = shoe ? shoe.size - shoe.left : 0
  return (
    <div
      className="absolute flex items-center rounded-xl bg-[#03130e]/72 shadow-[0_10px_30px_-12px_rgba(0,0,0,.7),inset_0_1px_0_rgba(255,255,255,.05)] ring-1 ring-[#f7c548]/15"
      style={{ left, top, width, height, padding: pad, gap }}
    >
      <BeadPlate hist={hist} cols={beadCols} cell={cell} letters={cell >= 12} />
      <div className="h-full w-px shrink-0 bg-white/10" />
      <BigRoad hist={hist} cols={roadCols} cell={cell} />
      <div className="h-full w-px shrink-0 bg-white/10" />
      <div className="flex h-full shrink-0 flex-col justify-between" style={{ width: statsW }}>
        <Count side="B" label="Banker" n={c.B} big={!phone} />
        <Count side="P" label="Player" n={c.P} big={!phone} />
        <Count side="T" label="Tie" n={c.T} big={!phone} />
        {!phone && (
          <>
            <div className="flex items-center justify-between text-[11px] font-semibold text-white/55">
              <span>Pairs</span>
              <span className="tnum font-extrabold">
                <span style={{ color: '#ff8d9d' }}>{c.bp}</span>
                <span className="text-white/30"> · </span>
                <span style={{ color: '#7fb4ff' }}>{c.pp}</span>
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-semibold text-white/55">
              <span>Hand</span>
              <span className="tnum font-extrabold text-white/80">{hist.length}</span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10" title={shoe ? `${shoe.left} cards left` : 'New shoe'}>
              <div className="absolute inset-0 origin-left rounded-full bg-[#f7c548]/70 transition-transform duration-500" style={{ transform: `scaleX(${shoe ? dealt / shoe.size : 0})` }} />
              {shoe && <div className="absolute inset-y-0 w-[2px] bg-danger" style={{ left: `${((shoe.size - shoe.cutAt) / shoe.size) * 100}%` }} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
