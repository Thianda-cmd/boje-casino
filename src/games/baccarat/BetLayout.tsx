import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Chip, chipLabel } from '../../art/Chip'
import { useUid } from '../../art/ids'
import { BET_INFO, BET_KEYS, type BetKey, type BetOutcome, type Bets } from './rules'

/*
  The betting layout: two curved bands printed on the felt, concentric with the dealer, like a real baccarat table.
  The near band holds Player and Banker, the far band the Player Pair, Tie and Banker Pair. Zones are SVG paths
  (they take the clicks), labels run along the arcs, and the chip stacks sit on top as HTML so they can slide off to
  the dealer or back to the player.
*/

export interface LayoutBox {
  vw: number
  vh: number
}
export const DESK_BOX: LayoutBox = { vw: 1000, vh: 330 }
export const PHONE_BOX: LayoutBox = { vw: 360, vh: 212 }

export type Leaving = 'dealer' | 'player'

export const ZONE_TONE: Record<BetKey, { fill: string; ink: string; glow: string; fillAlpha: number }> = {
  player: { fill: '#2f7cf6', ink: '#b3d1ff', glow: '#5aa2ff', fillAlpha: 0.2 },
  banker: { fill: '#e8344e', ink: '#ffb6c0', glow: '#ff6278', fillAlpha: 0.2 },
  tie: { fill: '#22d36f', ink: '#a6f5c9', glow: '#47ee8e', fillAlpha: 0.15 },
  pPair: { fill: '#9fb8d6', ink: '#dbe6f0', glow: '#5aa2ff', fillAlpha: 0.07 },
  bPair: { fill: '#9fb8d6', ink: '#dbe6f0', glow: '#ff6278', fillAlpha: 0.07 },
}

interface Zone {
  key: BetKey
  path: string
  name: { d: string; size: number }
  pays: { d: string; size: number }
  /** chip spot, in layout units */
  anchor: [number, number]
}

interface Geom {
  zones: Zone[]
  rail: string[]
  /** the arc the house line is printed on */
  motto: string
}

/** The zone paths for a layout box: rounded annular sectors with a hairline gap between neighbours. */
export function layoutGeom({ vw, vh }: LayoutBox, phone: boolean): Geom {
  const pad = phone ? 7 : 14
  const halfChord = vw / 2 - pad
  const sag = vw * (phone ? 0.05 : 0.058)
  const R = (halfChord * halfChord + sag * sag) / (2 * sag)
  const cx = vw / 2
  const cy = vh - pad - R
  const theta = Math.asin(halfChord / R)
  const t2 = phone ? 92 : 132
  const t1 = phone ? 68 : 92
  const gap = phone ? 7 : 10
  const corner = phone ? 9 : 12
  const half = gap / 2
  const r2o = R
  const r2i = R - t2
  const r1o = r2i - gap
  const r1i = r1o - t1
  const P = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy + r * Math.cos(a)).toFixed(2)}`
  // angle of an edge at radius r, nudged into the zone by half the gap
  const edge = (r: number, a: number, side: 1 | -1) => a + side * Math.asin(half / r)

  const sector = (ri: number, ro: number, a0: number, a1: number) => {
    const d = corner
    const oL = edge(ro, a0, 1)
    const oR = edge(ro, a1, -1)
    const iL = edge(ri, a0, 1)
    const iR = edge(ri, a1, -1)
    return [
      `M${P(ro, oL + d / ro)}`,
      `A${ro} ${ro} 0 0 0 ${P(ro, oR - d / ro)}`,
      `Q${P(ro, oR)} ${P(ro - d, edge(ro - d, a1, -1))}`,
      `L${P(ri + d, edge(ri + d, a1, -1))}`,
      `Q${P(ri, iR)} ${P(ri, iR - d / ri)}`,
      `A${ri} ${ri} 0 0 1 ${P(ri, iL + d / ri)}`,
      `Q${P(ri, iL)} ${P(ri + d, edge(ri + d, a0, 1))}`,
      `L${P(ro - d, edge(ro - d, a0, 1))}`,
      `Q${P(ro, oL)} ${P(ro, oL + d / ro)}Z`,
    ].join(' ')
  }
  /** an arc from left to right at radius r, for text */
  const arc = (r: number, a0: number, a1: number) => `M${P(r, a0)} A${r} ${r} 0 0 0 ${P(r, a1)}`
  const mid = (ri: number, ro: number, a0: number, a1: number): [number, number] => {
    const r = (ri + ro) / 2
    const a = (a0 + a1) / 2
    return [cx + r * Math.sin(a), cy + r * Math.cos(a)]
  }

  const tieHalf = theta * 0.36
  const spans: Record<BetKey, [number, number, number, number]> = {
    // [inner r, outer r, left angle, right angle]
    player: [r2i, r2o, -theta, 0],
    banker: [r2i, r2o, 0, theta],
    pPair: [r1i, r1o, -theta, -tieHalf],
    tie: [r1i, r1o, -tieHalf, tieHalf],
    bPair: [r1i, r1o, tieHalf, theta],
  }
  const big = phone ? 22 : 31
  const small = phone ? 10.5 : 14
  const zones = BET_KEYS.map((key): Zone => {
    const [ri, ro, a0, a1] = spans[key]
    const t = ro - ri
    const main = key === 'player' || key === 'banker'
    const nameSize = main ? big : key === 'tie' ? big * 0.86 : big * 0.62
    // text arcs reach past the zone so long words never clip; the name sits a little above centre
    const rName = ri + t * 0.5 + nameSize * 0.36
    const rPays = ro - t * 0.13
    return {
      key,
      path: sector(ri, ro, a0, a1),
      name: { d: arc(rName, a0 - 0.2, a1 + 0.2), size: nameSize },
      pays: { d: arc(rPays, a0 - 0.2, a1 + 0.2), size: small },
      anchor: mid(ri, ro, a0, a1),
    }
  })
  const out = phone ? 4 : 6
  const rail = [sector(r1i - out, r2o + out, -theta - out / R, theta + out / R)]
  return { zones, rail, motto: arc(r1i - (phone ? 9 : 14), -theta * 0.8, theta * 0.8) }
}

const EASE_IN = [0.5, 0, 0.75, 0] as const

const amountLabel = (v: number) => (v >= 1000 || Number.isInteger(v) ? chipLabel(v) : v.toFixed(2))

const CHIP_VALUES = [5000, 1000, 500, 100, 25, 10, 5, 1]
/** chip values for a stack, bottom to top, largest first, at most five */
function stackOf(amount: number): number[] {
  const out: number[] = []
  let left = Math.round(amount * 100) / 100
  for (const v of CHIP_VALUES)
    while (left >= v - 1e-9 && out.length < 5) {
      out.push(v)
      left = Math.round((left - v) * 100) / 100
    }
  if (!out.length) out.push(1)
  return out
}

function ChipPile({ amount, size, label }: { amount: number; size: number; label?: string }) {
  const values = stackOf(amount)
  const step = size * 0.1
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {values.map((v, i) => {
        const top = i === values.length - 1
        return (
          <motion.span
            key={i}
            className="absolute left-0 top-0"
            initial={i ? { y: -i * step - 14, opacity: 0 } : false}
            animate={{ y: -i * step, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 700, damping: 30 }}
          >
            <Chip value={top ? amount : v} size={size} label={top ? (label ?? chipLabel(amount)) : undefined} />
          </motion.span>
        )
      })}
    </div>
  )
}

export function BetLayout({
  box,
  phone,
  left,
  top,
  width,
  height,
  stageH,
  bets,
  wins,
  leaving,
  outcomes,
  interactive,
  onPlace,
  shake,
}: {
  box: LayoutBox
  phone: boolean
  left: number
  top: number
  width: number
  height: number
  stageH: number
  bets: Bets
  /** winnings paid next to a stake (payout minus stake) */
  wins: Bets
  leaving: Leaving
  outcomes: Partial<Record<BetKey, BetOutcome>> | null
  interactive: boolean
  onPlace: (k: BetKey) => void
  shake: { key: BetKey; n: number } | null
}) {
  const u = useUid()
  const g = layoutGeom(box, phone)
  const k = Math.min(width / box.vw, height / box.vh)
  const ox = (width - box.vw * k) / 2
  const oy = (height - box.vh * k) / 2
  const chip = Math.round(phone ? 32 : Math.max(36, Math.min(50, 58 * k)))
  const [flash, setFlash] = useState<Record<string, number>>({})

  const press = (key: BetKey) => {
    if (!interactive) return
    setFlash((f) => ({ ...f, [key]: (f[key] ?? 0) + 1 }))
    onPlace(key)
  }
  const onKey = (e: ReactKeyboardEvent, key: BetKey) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      press(key)
    }
  }

  return (
    <div className="absolute" style={{ left, top, width, height }}>
      <svg viewBox={`0 0 ${box.vw} ${box.vh}`} className="absolute inset-0 h-full w-full overflow-visible" aria-label="Betting layout">
        <defs>
          {BET_KEYS.map((key) => {
            const t = ZONE_TONE[key]
            return (
              <linearGradient key={key} id={`${u}${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={t.fill} stopOpacity={t.fillAlpha * 0.55} />
                <stop offset="1" stopColor={t.fill} stopOpacity={t.fillAlpha} />
              </linearGradient>
            )
          })}
        </defs>
        {g.rail.map((d, i) => (
          <path key={i} d={d} fill="rgba(0,0,0,.14)" stroke="rgba(247,197,72,.28)" strokeWidth={phone ? 1 : 1.3} />
        ))}
        <text fontSize={phone ? 7.5 : 11} fontWeight={800} letterSpacing={phone ? 2.2 : 4} fill="rgba(247,197,72,.5)">
          <textPath href={`#${u}motto`} startOffset="50%" textAnchor="middle">
            {phone ? 'TIE PAYS 8 TO 1 · PAIRS PAY 11 TO 1' : 'BANKER PAYS 0.95 TO 1 · TIE PAYS 8 TO 1 · PAIRS PAY 11 TO 1'}
          </textPath>
        </text>
        <path id={`${u}motto`} d={g.motto} fill="none" />
        {g.zones.map((z) => {
          const t = ZONE_TONE[z.key]
          const o = outcomes?.[z.key]
          const placed = !!bets[z.key]
          return (
            <motion.g
              // a refused chip shakes the zone: a new key replays the shake
              key={`${z.key}${shake?.key === z.key ? shake.n : ''}`}
              className={`group outline-none ${interactive ? 'cursor-pointer' : ''}`}
              role="button"
              tabIndex={interactive ? 0 : -1}
              aria-label={`${BET_INFO[z.key].name}, pays ${BET_INFO[z.key].pays}${bets[z.key] ? `, ${bets[z.key]} on it` : ''}`}
              onClick={() => press(z.key)}
              onKeyDown={(e) => onKey(e, z.key)}
              animate={shake?.key === z.key ? { x: [0, -7, 6, -4, 2, 0] } : { x: 0 }}
              transition={{ duration: 0.36 }}
            >
              <path d={z.path} fill={`url(#${u}${z.key})`} stroke="rgba(247,197,72,.62)" strokeWidth={phone ? 1.1 : 1.5} />
              {/* hover and keyboard focus */}
              <path
                d={z.path}
                fill="#fff"
                className={`opacity-0 transition-opacity duration-200 ${interactive ? 'group-hover:opacity-[.07] group-focus-visible:opacity-[.1]' : ''}`}
              />
              {/* the press flash */}
              {flash[z.key] ? (
                <motion.path key={flash[z.key]} d={z.path} fill={t.glow} initial={{ opacity: 0.32 }} animate={{ opacity: 0 }} transition={{ duration: 0.45, ease: 'easeOut' }} pointerEvents="none" />
              ) : null}
              {/* result */}
              <AnimatePresence>
                {o === 'win' && (
                  <motion.g key="win" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }} transition={{ duration: 0.35 }} pointerEvents="none">
                    <path d={z.path} fill={t.glow} opacity={0.22} />
                    <motion.path
                      d={z.path}
                      fill="none"
                      stroke={t.glow}
                      strokeWidth={phone ? 5 : 8}
                      strokeLinejoin="round"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 0.75, 0.35, 0.65] }}
                      transition={{ duration: 1.6, times: [0, 0.25, 0.6, 1], ease: 'easeInOut' }}
                    />
                    <path d={z.path} fill="none" stroke="#ffe08a" strokeWidth={phone ? 1.6 : 2.2} />
                  </motion.g>
                )}
                {o === 'push' && (
                  <motion.path key="push" d={z.path} fill="none" stroke="rgba(255,255,255,.7)" strokeWidth={phone ? 1.4 : 2} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} pointerEvents="none" />
                )}
              </AnimatePresence>
              <g pointerEvents="none" style={{ opacity: placed ? 0.32 : o === 'lose' ? 0.5 : 1, transition: 'opacity .3s' }}>
                <text fontSize={z.name.size} fontWeight={800} letterSpacing={z.name.size * 0.16} fill={t.ink}>
                  <textPath href={`#${u}n${z.key}`} startOffset="50%" textAnchor="middle">
                    {z.key === 'pPair' ? (
                      <>
                        <tspan fill="#7fb4ff">P</tspan> PAIR
                      </>
                    ) : z.key === 'bPair' ? (
                      <>
                        <tspan fill="#ff8d9d">B</tspan> PAIR
                      </>
                    ) : (
                      BET_INFO[z.key].name.toUpperCase()
                    )}
                  </textPath>
                </text>
              </g>
              <text pointerEvents="none" fontSize={z.pays.size} fontWeight={800} letterSpacing={z.pays.size * 0.12} fill="#f7c548" fillOpacity={0.85}>
                <textPath href={`#${u}p${z.key}`} startOffset="50%" textAnchor="middle">
                  {BET_INFO[z.key].pays}
                </textPath>
              </text>
              <path id={`${u}n${z.key}`} d={z.name.d} fill="none" pointerEvents="none" />
              <path id={`${u}p${z.key}`} d={z.pays.d} fill="none" pointerEvents="none" />
            </motion.g>
          )
        })}
      </svg>

      {/* chips */}
      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence custom={leaving}>
          {g.zones.flatMap((z) => {
            const ax = ox + z.anchor[0] * k
            const ay = oy + z.anchor[1] * k
            const up = top + ay + chip
            const down = stageH - top - ay + chip
            const out = (to: Leaving) =>
              to === 'dealer'
                ? { y: -up * 0.62, opacity: 0, scale: 0.8, transition: { duration: 0.55, ease: EASE_IN } }
                : { y: down, opacity: 0, transition: { duration: 0.55, ease: EASE_IN } }
            const items = []
            const stakeAmt = bets[z.key]
            const winAmt = wins[z.key]
            if (stakeAmt)
              items.push(
                <motion.div
                  key={z.key}
                  className="absolute"
                  style={{ left: ax - chip / 2, top: ay - chip / 2 }}
                  initial={{ opacity: 0, scale: 0.6, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0, x: winAmt ? -chip * 0.42 : 0 }}
                  exit="out"
                  variants={{ out }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                >
                  <ChipPile amount={stakeAmt} size={chip} />
                </motion.div>,
              )
            if (winAmt)
              items.push(
                <motion.div
                  key={`${z.key}-win`}
                  className="absolute"
                  style={{ left: ax - chip / 2 + chip * 0.42, top: ay - chip / 2 }}
                  initial={{ opacity: 0, y: -up * 0.5, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit="out"
                  variants={{ out }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.2 } }}
                >
                  <ChipPile amount={winAmt} size={chip} label={amountLabel(winAmt)} />
                </motion.div>,
              )
            return items
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
