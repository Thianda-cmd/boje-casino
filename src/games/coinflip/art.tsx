import { useUid } from '../../art/ids'
import { B_PATH, CROWN_BALLS, CROWN_BAND, CROWN_BODY, CROWN_CROSS, CROWN_INNER, CROWN_JEWELS, ENAMEL, FACET_SHADE, GEM_B_X, GEM_B_Y, GEM_HEX, GEM_SCALE, INK, ROUNDEL_R } from './faces'
import type { Side } from './rules'

/*
  The coin in SVG, from the same shapes the 3D coin is painted from (faces.ts): for the side picker, the history row,
  the info sheet and the lobby cover. `detail` adds the beads and the rim's reeding for the big sizes; the small ones
  draw the emblem larger, so the green gem and the blue crown read even at 20 px.
*/

const FACET_GREENS = FACET_SHADE.map((k) => {
  // the brand green, lit per facet like the 3D enamel
  const c = [0x22, 0xd3, 0x6f].map((v) => Math.round(Math.min(255, v * (0.62 + 0.42 * k) + (k > 0.95 ? 30 : 0))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
})

/** the design (200 box, field radius 100) inside a face of radius `r` centred on (cx, cy) */
export function FaceDesign({ side, cx = 50, cy = 50, r = 39, ink = INK, gold = '#ffe28a', simple = false }: { side: Side; cx?: number; cy?: number; r?: number; ink?: string; gold?: string; simple?: boolean }) {
  const s = r / 100
  const sw = (w: number) => w / s
  const hex = GEM_HEX.map(([x, y]) => `${x},${y}`).join(' ')
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s}) translate(-100 -100)`} strokeLinejoin="round">
      {side === 'heads' ? (
        <>
          {GEM_HEX.map((a, i) => {
            const b = GEM_HEX[(i + 1) % 6]
            return <path key={i} d={`M100 100L${a[0]} ${a[1]}L${b[0]} ${b[1]}Z`} fill={FACET_GREENS[i]} />
          })}
          <polygon points={hex} fill="none" stroke={gold} strokeWidth={sw(1.5)} />
          <polygon points={hex} fill="none" stroke={ink} strokeWidth={sw(0.55)} />
          <g transform={`translate(${GEM_B_X} ${GEM_B_Y}) scale(${GEM_SCALE})`}>
            <path d={B_PATH} fill={gold} fillRule="evenodd" stroke={ink} strokeWidth={sw(0.5) / GEM_SCALE} />
          </g>
        </>
      ) : (
        <>
          {/* the blue enamel roundel in its gold bezel */}
          <circle cx="100" cy="100" r={ROUNDEL_R + 1.5} fill={ENAMEL.blueDeep} stroke={gold} strokeWidth={sw(1.3)} />
          <circle cx="100" cy="100" r={ROUNDEL_R + 1.5 + sw(0.65)} fill="none" stroke={ink} strokeWidth={sw(0.45)} />
          <circle cx="98" cy="97.5" r={ROUNDEL_R - 4} fill={ENAMEL.blue} />
          {!simple && <path d={`M${100 - ROUNDEL_R * 0.78} ${100 - ROUNDEL_R * 0.3} A${ROUNDEL_R * 0.84} ${ROUNDEL_R * 0.84} 0 0 1 ${100 - ROUNDEL_R * 0.18} ${100 - ROUNDEL_R * 0.8}`} fill="none" stroke={ENAMEL.blueLight} strokeOpacity=".7" strokeWidth={sw(1.1)} strokeLinecap="round" />}
          {/* the crown */}
          <path d={CROWN_BODY} fill={gold} stroke={ink} strokeWidth={sw(0.6)} />
          {!simple && <path d={CROWN_INNER} fill="none" stroke="#c98a1c" strokeWidth={sw(0.35)} />}
          <path d={CROWN_CROSS} fill={gold} stroke={ink} strokeWidth={sw(0.5)} />
          <rect x={CROWN_BAND.x} y={CROWN_BAND.y} width={CROWN_BAND.w} height={CROWN_BAND.h} rx={CROWN_BAND.r} fill={gold} stroke={ink} strokeWidth={sw(0.6)} />
          {CROWN_BALLS.map(([x, y, br], i) => (
            <circle key={i} cx={x} cy={y} r={br} fill={gold} stroke={ink} strokeWidth={sw(0.5)} />
          ))}
          {CROWN_JEWELS.map(([x, y, rx, ry, c], i) => (
            <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill={c} stroke={ink} strokeWidth={sw(0.45)} />
          ))}
        </>
      )}
    </g>
  )
}

/** the whole coin, face on: gold rim, sunk field, the design */
export function CoinArt({ side, size = 32, detail = size >= 44, className = '' }: { side: Side; size?: number; detail?: boolean; className?: string }) {
  const u = useUid() + 'cf'
  const small = size < 24
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${u}rim`} x1=".2" y1="0" x2=".8" y2="1">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset=".35" stopColor="#f7c548" />
          <stop offset=".75" stopColor="#dc951f" />
          <stop offset="1" stopColor="#a8621a" />
        </linearGradient>
        <radialGradient id={`${u}field`} cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor="#ffe07a" />
          <stop offset=".7" stopColor="#f2b634" />
          <stop offset="1" stopColor="#cc8a20" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill={`url(#${u}rim)`} stroke={INK} strokeWidth={small ? 6 : 3} />
      {detail &&
        Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2
          return <line key={i} x1={50 + Math.cos(a) * 43.2} y1={50 + Math.sin(a) * 43.2} x2={50 + Math.cos(a) * 45.6} y2={50 + Math.sin(a) * 45.6} stroke="#a3600f" strokeOpacity=".55" strokeWidth="1.3" />
        })}
      <circle cx="50" cy="50" r={detail ? 39.5 : 41} fill={`url(#${u}field)`} stroke="#9a5510" strokeOpacity=".7" strokeWidth="1.6" />
      {detail &&
        Array.from({ length: 30 }, (_, i) => {
          const a = (i / 30) * Math.PI * 2
          return <circle key={i} cx={50 + Math.cos(a) * 34.5} cy={50 + Math.sin(a) * 34.5} r="1.05" fill="#fff1b8" opacity=".85" />
        })}
      <FaceDesign side={side} r={detail ? 40 : 58} simple={!detail} />
      {!small && <path d="M17 33 A36 36 0 0 1 40 13" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth={3} strokeLinecap="round" />}
    </svg>
  )
}
