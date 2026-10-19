import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Craps' lobby cover and navigation icon. The cover is the game's identity in the lobby's cartoon style (ink
  outlines, bold gradients): the far end of a craps table under a warm lamp, its rubber pyramids along the
  backboard, the felt printed with the numbers, Come and the Pass Line, the puck ON on the eight, chips on the line,
  and two red casino dice tumbling through the air toward the wall, as the stickman calls "Yo-leven!". Plain SVG, no
  three.js: it is part of the main bundle. The icon is a 24 × 24 stroke drawing like the other nav icons: two dice in
  flight.
*/

const INK = '#1d0f30'
const FONT = 'Manrope, system-ui, sans-serif'
const SERIF = 'Georgia, "Times New Roman", serif'

/** pip centres on a unit face */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.28, 0.24],
    [0.72, 0.24],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.76],
    [0.72, 0.76],
  ],
}

/**
 * A red casino die seen from above and to the side (isometric), `s` from its centre to a corner, turned by `rot`:
 * the top face and the two front faces, each with its white pips laid on the face, and a glint of the light through
 * the translucent red.
 */
function CoverDie({ x, y, s, rot, faces }: { x: number; y: number; s: number; rot: number; faces: [number, number, number] }) {
  const c = 0.866 * s
  // [edge u, edge v, origin] of each face: the top, the left front, the right front
  const quads: [number, number, number, number, number, number][] = [
    [c, -s / 2, c, s / 2, -c, -s / 2],
    [c, s / 2, 0, s, -c, -s / 2],
    [c, -s / 2, 0, s, 0, 0],
  ]
  const paint = ['#ff4d55', '#d2121f', '#a00a16']
  const outline = `M0 ${-s} L${c} ${-s / 2} L${c} ${s / 2} L0 ${s} L${-c} ${s / 2} L${-c} ${-s / 2}Z`
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {quads.map(([ux, uy, vx, vy, ox, oy], i) => (
        <g key={i}>
          <path d={`M${ox} ${oy} l${ux} ${uy} l${vx} ${vy} l${-ux} ${-uy}Z`} fill={paint[i]} />
          <g transform={`matrix(${ux} ${uy} ${vx} ${vy} ${ox} ${oy})`}>
            {PIPS[faces[i]].map(([px, py], j) => (
              <circle key={j} cx={px} cy={py} r={faces[i] === 1 ? 0.14 : 0.092} fill={i ? '#f6e9e2' : '#fffaf5'} />
            ))}
          </g>
        </g>
      ))}
      {/* the light through the red: a warm glow low on the front faces, a gleam on the top edge */}
      <path d={`M${-c * 0.85} ${s * 0.1} L0 ${s * 0.62} L${c * 0.85} ${s * 0.1} L${c * 0.85} ${s * 0.42} L0 ${s * 0.9} L${-c * 0.85} ${s * 0.42}Z`} fill="#ff8a5c" opacity=".22" />
      <path d={`M${-c * 0.7} ${-s * 0.55} L0 ${-s * 0.92}`} stroke="#fff" strokeOpacity=".7" strokeWidth={s * 0.07} strokeLinecap="round" />
      <path d={`M${-c} ${-s / 2} L0 0 L${c} ${-s / 2} M0 0 L0 ${s}`} fill="none" stroke={INK} strokeOpacity=".4" strokeWidth="1.1" strokeLinejoin="round" />
      <path d={outline} fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
    </g>
  )
}

/** a stack of chips on the felt, seen from above at a slant: `n` chips of `colors` (bottom up), `r` across */
function ChipStack({ x, y, r, colors }: { x: number; y: number; r: number; colors: string[] }) {
  const ry = r * 0.42
  const h = r * 0.3
  return (
    <g>
      <ellipse cx={x} cy={y + h * 0.6} rx={r * 1.08} ry={ry * 1.1} fill="#04160e" opacity=".45" />
      {colors.map((c, i) => {
        const cy = y - i * h
        return (
          <g key={i}>
            <path d={`M${x - r} ${cy} v${-h} a${r} ${ry} 0 0 0 ${2 * r} 0 v${h} a${r} ${ry} 0 0 1 ${-2 * r} 0Z`} fill={c} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
            {/* the edge inserts */}
            {[-0.62, 0, 0.62].map((k) => (
              <rect key={k} x={x + k * r - r * 0.1} y={cy - h + ry * Math.sqrt(1 - k * k) - 0.2} width={r * 0.2} height={h * 0.82} fill="#fff" opacity=".85" />
            ))}
            {i === colors.length - 1 && (
              <>
                <ellipse cx={x} cy={cy - h} rx={r} ry={ry} fill={c} stroke={INK} strokeWidth="1.6" />
                <ellipse cx={x} cy={cy - h} rx={r * 0.66} ry={ry * 0.66} fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="1.1" strokeDasharray="2.4 2" />
                <ellipse cx={x - r * 0.3} cy={cy - h - ry * 0.3} rx={r * 0.32} ry={ry * 0.22} fill="#fff" opacity=".3" />
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}

export function CrapsCover() {
  const u = useUid() + 'cr'
  // the felt in perspective: u across (0-1), v from the backboard (0) toward us (1)
  const P = (fu: number, fv: number): [number, number] => {
    const y = 128 + 132 * fv ** 1.18
    const w = 156 + 270 * fv
    return [100 + (fu - 0.5) * w, y]
  }
  const quad = (u0: number, v0: number, u1: number, v1: number) => {
    const pts = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]
    return `M${pts.map((q) => q.map((n) => n.toFixed(1)).join(' ')).join(' L')}Z`
  }
  const [feltL] = P(0, 0)
  const [feltR] = P(1, 0)
  const boxes = [
    { u: 0.1, label: '5' },
    { u: 0.3, label: 'SIX', gold: true },
    { u: 0.5, label: '8', gold: true },
    { u: 0.7, label: 'NINE' },
  ]
  const [px, py] = P(0.668, 0.17)
  // the side rails run along the felt's edges toward us, widening
  const [bl, by] = P(0, 0)
  const [fl, fy] = P(0, 1.08)
  const [br] = P(1, 0)
  const [fr] = P(1, 1.08)
  const rail = (side: 1 | -1) => {
    const ib = side < 0 ? bl : br
    const ifr = side < 0 ? fl : fr
    return `M${ib} ${by} L${ifr} ${fy} L${ifr + side * 46} ${fy} L${ib + side * 14} ${by - 14} Z`
  }
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".6" y2="1">
          <stop offset="0" stopColor="#1fb57d" />
          <stop offset=".5" stopColor="#0c6a47" />
          <stop offset="1" stopColor="#04281b" />
        </linearGradient>
        <radialGradient id={`${u}spot`} cx=".5" cy=".38" r=".6">
          <stop offset="0" stopColor="#fff1c4" stopOpacity=".5" />
          <stop offset=".55" stopColor="#ffd98a" stopOpacity=".1" />
          <stop offset="1" stopColor="#ffd98a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}felt`} cx=".5" cy=".25" r=".85">
          <stop offset="0" stopColor="#21a26c" />
          <stop offset=".6" stopColor="#11744c" />
          <stop offset="1" stopColor="#0a4a31" />
        </radialGradient>
        <linearGradient id={`${u}wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9774a" />
          <stop offset=".45" stopColor="#7a4426" />
          <stop offset="1" stopColor="#3a1a0c" />
        </linearGradient>
        <pattern id={`${u}pyr`} width="9" height="11" patternUnits="userSpaceOnUse" x={feltL} y="113">
          <rect width="9" height="11" fill="#1a1517" />
          <path d="M4.5 0.6 L8.4 5.5 L4.5 10.4 L0.6 5.5Z" fill="#3a3236" />
          <path d="M4.5 0.6 L8.4 5.5 L4.5 5.5Z" fill="#5a5056" />
          <path d="M0.6 5.5 L4.5 10.4 L4.5 5.5Z" fill="#100c0e" />
        </pattern>
        <radialGradient id={`${u}puck`} cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9d2c4" />
        </radialGradient>
      </defs>

      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      <circle cx="178" cy="18" r="64" fill="#fff" opacity=".05" />
      {/* the lamp over the table */}
      <path d="M74 -10 L126 -10 L210 200 L-10 200 Z" fill="#fff4d0" opacity=".07" />
      <ellipse cx="100" cy="120" rx="118" ry="112" fill={`url(#${u}spot)`} />

      {/* the far end of the table: the walnut rail over the backboard's rubber pyramids */}
      <path d={`M${feltL - 14} 100 Q100 92 ${feltR + 14} 100 L${feltR + 10} 114 L${feltL - 10} 114 Z`} fill={`url(#${u}wood)`} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d={`M${feltL - 11} 103 Q100 95.5 ${feltR + 11} 103`} fill="none" stroke="#f3cf73" strokeWidth="1.4" opacity=".9" />
      <rect x={feltL} y="113" width={feltR - feltL} height="15" fill={`url(#${u}pyr)`} stroke={INK} strokeWidth="1.6" />

      {/* the side rails, and the felt with its print */}
      {([-1, 1] as const).map((side) => (
        <g key={side}>
          <path d={rail(side)} fill={`url(#${u}wood)`} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
          <path d={`M${(side < 0 ? bl : br) + side * 6} ${by - 7} L${(side < 0 ? fl : fr) + side * 22} ${fy}`} stroke="#f3cf73" strokeWidth="1.3" opacity=".75" />
        </g>
      ))}
      <path d={quad(0, 0, 1, 1.08)} fill={`url(#${u}felt)`} />
      <path d={`M${feltL} 128 L${feltR} 128`} stroke="#04160e" strokeOpacity=".5" strokeWidth="3" />
      <g fill="none" stroke="#f1e6c8" strokeOpacity=".7" strokeWidth="1.3" strokeLinejoin="round">
        {boxes.map((b) => (
          <path key={b.u} d={quad(b.u + 0.012, 0.13, b.u + 0.188, 0.38)} />
        ))}
        <path d={quad(0.06, 0.44, 0.94, 0.6)} />
        <path d={quad(0.03, 0.68, 0.97, 0.9)} />
      </g>
      {boxes.map((b) => {
        const [x, y] = P(b.u + 0.1, 0.27)
        const word = b.label.length > 1
        return (
          <text key={b.label} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontFamily={SERIF} fontWeight="700" fontSize={word ? 9.5 : 17} fill={b.gold ? '#f3cf73' : '#f1e6c8'} transform={`translate(${x} ${y}) scale(1 .82) translate(${-x} ${-y})`}>
            {b.label}
          </text>
        )
      })}
      {(() => {
        const [x, y] = P(0.5, 0.525)
        return (
          <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontFamily={SERIF} fontWeight="700" fontSize="20" letterSpacing="5" fill="#ff5a4e" transform={`translate(${x} ${y}) scale(1 .78) translate(${-x} ${-y})`}>
            COME
          </text>
        )
      })()}
      {(() => {
        const [x, y] = P(0.52, 0.76)
        return (
          <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontFamily={SERIF} fontWeight="700" fontSize="19" letterSpacing="3.5" fill="#f1e6c8" transform={`translate(${x} ${y}) scale(1 .8) translate(${-x} ${-y})`}>
            PASS LINE
          </text>
        )
      })()}

      {/* the puck, ON, on the eight */}
      <g>
        <ellipse cx={px} cy={py + 2.2} rx="11.5" ry="5.2" fill="#04160e" opacity=".5" />
        <path d={`M${px - 11} ${py} v2.6 a11 4.8 0 0 0 22 0 v-2.6`} fill="#bdb5a6" stroke={INK} strokeWidth="1.6" />
        <ellipse cx={px} cy={py} rx="11" ry="4.8" fill={`url(#${u}puck)`} stroke={INK} strokeWidth="1.6" />
        <ellipse cx={px} cy={py} rx="8" ry="3.4" fill="none" stroke="#141214" strokeWidth="1" />
        <text x={px} y={py + 0.2} textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="900" fontSize="6.4" fill="#141214" transform={`translate(${px} ${py}) scale(1 .62) translate(${-px} ${-py})`}>
          ON
        </text>
      </g>

      {/* chips on the line, and one more stack beside the Come */}
      <ChipStack x={22} y={247} r={15} colors={['#2f7cf6', '#1fb866', '#e8344e']} />
      <ChipStack x={178} y={243} r={13} colors={['#26313f', '#f59e0b']} />

      {/* the dice's shadows on the felt, far below them */}
      <ellipse cx="84" cy="176" rx="16" ry="5" fill="#04160e" opacity=".42" />
      <ellipse cx="126" cy="164" rx="13" ry="4.2" fill="#04160e" opacity=".36" />
      {/* motion through the air */}
      <g fill="none" stroke="#fff" strokeLinecap="round" opacity=".8">
        <path d="M44 156 Q52 130 62 118" strokeWidth="2.4" />
        <path d="M54 166 Q60 146 68 134" strokeWidth="1.6" opacity=".7" />
        <path d="M104 132 Q108 112 114 100" strokeWidth="2" />
      </g>
      <CoverDie x={82} y={110} s={24} rot={-16} faces={[5, 3, 6]} />
      <CoverDie x={130} y={84} s={21} rot={24} faces={[6, 2, 4]} />

      {/* the stickman's call */}
      <g transform="rotate(-6 54 40)" style={{ filter: 'drop-shadow(0 5px 6px rgba(0,20,10,.45))' }}>
        <path d="M14 26 Q14 18 22 18 L90 18 Q98 18 98 26 L98 44 Q98 52 90 52 L52 52 L42 62 L44 52 L22 52 Q14 52 14 44 Z" fill="#fffaf0" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
        <text x="56" y="36" textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="900" fontStyle="italic" fontSize="15.5" fill="#0f6b47">
          Yo-leven!
        </text>
      </g>
      {/* sparkles */}
      {[
        [170, 54, 4.2],
        [24, 100, 3.4],
        [156, 132, 3],
        [186, 160, 2.6],
      ].map(([x, y, r], i) => {
        const k = r * 0.22
        return <path key={i} d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z`} fill="#fff6d0" />
      })}
    </svg>
  )
}

export function CrapsIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <rect x="3.2" y="9.6" width="9" height="9" rx="2.1" transform="rotate(-15 7.7 14.1)" />
      <rect x="12.6" y="3.4" width="8.2" height="8.2" rx="2" transform="rotate(20 16.7 7.5)" />
      <path d="M2.4 5.8h3.4M3.6 3.3h2.2" opacity=".7" />
      <g fill="currentColor" stroke="none">
        <circle cx="5.8" cy="12.4" r="1" />
        <circle cx="7.7" cy="14.1" r="1" />
        <circle cx="9.6" cy="15.8" r="1" />
        <circle cx="15.3" cy="6.2" r=".95" />
        <circle cx="18.1" cy="8.8" r=".95" />
      </g>
    </svg>
  )
}
