import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'
import { BOJE_B, BOJE_HEX } from '../../art/brand'

/*
  Sic Bo's lobby cover and navigation icon. The cover is the game's identity in the lobby's cartoon style (ink
  outlines, bold gradients): the glass dome on its gold pedestal under a warm spotlight, three ivory dice tumbling
  inside, a golden lightning bolt striking down, and the ×25 a lucky strike can bring. Plain SVG, no three.js: it is
  part of the main bundle. The icon is a 24 × 24 stroke drawing like the other nav icons: three dice, the top one tumbling.
*/

const INK = '#1d0f30'
const FONT = 'Manrope, system-ui, sans-serif'

/** pip centres on a unit face, as on the table */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
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
    [0.29, 0.24],
    [0.71, 0.24],
    [0.29, 0.5],
    [0.71, 0.5],
    [0.29, 0.76],
    [0.71, 0.76],
  ],
}

/**
 * A die seen from above and to the side (isometric), `s` from its centre to a corner, turned by `rot`: the top face
 * and the two front faces, each with its pips laid on the face (a unit square mapped onto the face).
 */
function CoverDie({ x, y, s, rot, faces }: { x: number; y: number; s: number; rot: number; faces: [number, number, number] }) {
  const c = 0.866 * s
  // [origin, edge u, edge v] of each face: the top, the left front, the right front
  const quads: [number, number, number, number, number, number][] = [
    [c, -s / 2, c, s / 2, -c, -s / 2],
    [c, s / 2, 0, s, -c, -s / 2],
    [c, -s / 2, 0, s, 0, 0],
  ]
  const paint = ['#fffaf0', '#efe1c4', '#dcc69f']
  const outline = `M0 ${-s} L${c} ${-s / 2} L${c} ${s / 2} L0 ${s} L${-c} ${s / 2} L${-c} ${-s / 2}Z`
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <path d={outline} fill="#c9b088" transform="translate(0 2.5)" opacity=".5" />
      {quads.map(([ux, uy, vx, vy, ox, oy], i) => (
        <g key={i}>
          <path d={`M${ox} ${oy} l${ux} ${uy} l${vx} ${vy} l${-ux} ${-uy}Z`} fill={paint[i]} />
          <g transform={`matrix(${ux} ${uy} ${vx} ${vy} ${ox} ${oy})`}>
            {PIPS[faces[i]].map(([px, py], j) => (
              <circle key={j} cx={px} cy={py} r={faces[i] === 1 ? 0.15 : 0.095} fill={faces[i] === 1 || faces[i] === 4 ? '#d21f30' : '#24171b'} />
            ))}
          </g>
        </g>
      ))}
      <path d={`M${-c} ${-s / 2} L0 0 L${c} ${-s / 2} M0 0 L0 ${s}`} fill="none" stroke={INK} strokeOpacity=".35" strokeWidth="1.1" strokeLinejoin="round" />
      <path d={outline} fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
    </g>
  )
}

export function SicBoCover() {
  const u = useUid() + 'sb'
  // the dome: a half ellipse standing on the plinth's top ring
  const ring = { cx: 100, cy: 182, rx: 64, ry: 15 }
  const domeTop = 74
  const dome = `M${ring.cx - ring.rx} ${ring.cy} C${ring.cx - ring.rx} ${domeTop + 12} ${ring.cx - 36} ${domeTop} ${ring.cx} ${domeTop} C${ring.cx + 36} ${domeTop} ${ring.cx + ring.rx} ${domeTop + 12} ${ring.cx + ring.rx} ${ring.cy}`
  const BOLT = 'M152 -6 L129 46 L143 47 L118 98 L134 99 L104 150 L150 84 L134 83 L160 40 L146 39 L170 -6 Z'
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#d4243f" />
          <stop offset=".55" stopColor="#8a0f2a" />
          <stop offset="1" stopColor="#2a0512" />
        </linearGradient>
        <radialGradient id={`${u}spot`} cx=".5" cy=".42" r=".55">
          <stop offset="0" stopColor="#ffd9a0" stopOpacity=".55" />
          <stop offset=".6" stopColor="#ff9a6a" stopOpacity=".12" />
          <stop offset="1" stopColor="#ff9a6a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9a5a0c" />
          <stop offset=".22" stopColor="#f9cf55" />
          <stop offset=".45" stopColor="#fff2b8" />
          <stop offset=".7" stopColor="#e8a62a" />
          <stop offset="1" stopColor="#8a4a08" />
        </linearGradient>
        <linearGradient id={`${u}goldTop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2b8" />
          <stop offset="1" stopColor="#e3a12a" />
        </linearGradient>
        <linearGradient id={`${u}ruby`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5a0616" />
          <stop offset=".45" stopColor="#c81e3c" />
          <stop offset="1" stopColor="#4a0512" />
        </linearGradient>
        <radialGradient id={`${u}felt`} cx=".45" cy=".4" r=".7">
          <stop offset="0" stopColor="#2a9a72" />
          <stop offset="1" stopColor="#0d4a38" />
        </radialGradient>
        <radialGradient id={`${u}glass`} cx=".5" cy=".75" r=".75">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".02" />
          <stop offset=".75" stopColor="#ffffff" stopOpacity=".08" />
          <stop offset="1" stopColor="#ffe6f0" stopOpacity=".32" />
        </radialGradient>
        <linearGradient id={`${u}bolt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset=".45" stopColor="#ffd84a" />
          <stop offset="1" stopColor="#f59a12" />
        </linearGradient>
        <radialGradient id={`${u}flash`}>
          <stop offset="0" stopColor="#fff6c8" stopOpacity=".95" />
          <stop offset=".4" stopColor="#ffd45c" stopOpacity=".5" />
          <stop offset="1" stopColor="#ffb02e" stopOpacity="0" />
        </radialGradient>
        <filter id={`${u}blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <clipPath id={`${u}inside`}>
          <path d={`${dome} A${ring.rx} ${ring.ry} 0 0 1 ${ring.cx - ring.rx} ${ring.cy}Z`} />
        </clipPath>
      </defs>

      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      <circle cx="176" cy="20" r="70" fill="#fff" opacity=".05" />
      <circle cx="8" cy="236" r="92" fill="#000" opacity=".12" />
      {/* the spotlight over the pedestal */}
      <path d="M78 -10 L122 -10 L196 230 L4 230 Z" fill="#ffe2b0" opacity=".08" />
      <ellipse cx="100" cy="130" rx="112" ry="120" fill={`url(#${u}spot)`} />

      {/* the pedestal: a gold plinth with a ruby band and the Boje gem */}
      <ellipse cx="100" cy="230" rx="86" ry="14" fill="#14020a" opacity=".55" />
      <path d="M22 214 Q22 226 100 228 Q178 226 178 214 L172 204 Q100 214 28 204 Z" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M32 186 L32 204 Q100 216 168 204 L168 186 Z" fill={`url(#${u}ruby)`} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M32 190 Q100 202 168 190" fill="none" stroke="#f9cf55" strokeWidth="2.2" />
      <path d="M32 200 Q100 212 168 200" fill="none" stroke="#f9cf55" strokeWidth="1.6" opacity=".8" />
      <ellipse cx={ring.cx} cy={ring.cy + 2} rx={ring.rx + 6} ry={ring.ry + 3} fill={`url(#${u}goldTop)`} stroke={INK} strokeWidth="2.6" />
      <g transform="translate(88 196) scale(.75)">
        <path d={BOJE_HEX} fill="#22d36f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M16 2.6 27.6 9.3 16 16 4.4 9.3Z" fill="#7dffb8" opacity=".6" />
        <path d={BOJE_B} fill={INK} />
      </g>

      {/* the felt inside the dome */}
      <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} fill={`url(#${u}felt)`} stroke={INK} strokeWidth="2" />
      <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx - 9} ry={ring.ry - 4} fill="none" stroke="#f9cf55" strokeOpacity=".55" strokeWidth="1" strokeDasharray="2 2.5" />

      {/* three dice tumbling, under the glass */}
      <g clipPath={`url(#${u}inside)`}>
        <ellipse cx="72" cy="184" rx="15" ry="4.5" fill="#062a1f" opacity=".55" />
        <ellipse cx="124" cy="186" rx="14" ry="4" fill="#062a1f" opacity=".5" />
        <ellipse cx="100" cy="182" rx="10" ry="3" fill="#062a1f" opacity=".35" />
        <CoverDie x={74} y={160} s={20} rot={-14} faces={[4, 2, 6]} />
        <CoverDie x={124} y={164} s={18} rot={18} faces={[1, 3, 5]} />
        <CoverDie x={99} y={112} s={19} rot={38} faces={[6, 4, 1]} />
      </g>
      {/* motion marks round the die in the air */}
      <g fill="none" stroke="#fff" strokeLinecap="round" opacity=".8">
        <path d="M70 104 Q66 116 72 128" strokeWidth="2.2" />
        <path d="M128 98 Q134 110 129 122" strokeWidth="2.2" />
      </g>

      {/* the glass: clear, a fresnel rim, the studio's highlights */}
      <path d={`${dome} A${ring.rx} ${ring.ry} 0 0 1 ${ring.cx - ring.rx} ${ring.cy}Z`} fill={`url(#${u}glass)`} />
      <path
        d={`M${ring.cx - ring.rx + 9} ${ring.cy - 22} C${ring.cx - ring.rx + 6} ${domeTop + 46} ${ring.cx - 42} ${domeTop + 14} ${ring.cx - 18} ${domeTop + 8}`}
        fill="none"
        stroke="#fff"
        strokeOpacity=".75"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d={`M${ring.cx + 30} ${domeTop + 12} C${ring.cx + 46} ${domeTop + 20} ${ring.cx + 54} ${domeTop + 34} ${ring.cx + 57} ${domeTop + 50}`}
        fill="none"
        stroke="#fff"
        strokeOpacity=".5"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d={dome} fill="none" stroke={INK} strokeWidth="2.8" />
      <path d={dome} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" transform="translate(0 2.5) scale(1 .985)" style={{ transformOrigin: '100px 182px' }} />

      {/* the lucky strike: a golden bolt down onto the glass, and its flash */}
      <circle cx="108" cy="146" r="34" fill={`url(#${u}flash)`} />
      <path d={BOLT} fill="#ffc23a" opacity=".55" filter={`url(#${u}blur)`} />
      <path d={BOLT} fill={`url(#${u}bolt)`} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M156 4 L138 44" stroke="#fff" strokeOpacity=".85" strokeWidth="2.2" strokeLinecap="round" />

      {/* what it can bring */}
      <g transform="rotate(-9 44 40)" style={{ filter: 'drop-shadow(0 5px 6px rgba(30,0,10,.5))' }}>
        <rect x="14" y="24" width="60" height="32" rx="16" fill="#f7c548" stroke={INK} strokeWidth="2.6" />
        <rect x="21" y="27.5" width="46" height="9" rx="4.5" fill="#fff" opacity=".35" />
        <text x="44" y="47.5" textAnchor="middle" fontSize="21" fontWeight="900" fill="#2a1200" fontFamily={FONT}>
          ×25
        </text>
      </g>
      {/* sparkles */}
      {[
        [34, 96, 4.5],
        [176, 120, 3.6],
        [160, 168, 3],
        [24, 150, 3],
      ].map(([x, y, r], i) => {
        const k = r * 0.22
        return <path key={i} d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z`} fill="#fff6d0" />
      })}
    </svg>
  )
}

export function SicBoIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <rect x="2" y="12.5" width="8.5" height="8.5" rx="2" />
      <rect x="13.5" y="12.5" width="8.5" height="8.5" rx="2" />
      <rect x="7.75" y="2.75" width="8.5" height="8.5" rx="2" transform="rotate(14 12 7)" />
      <g fill="currentColor" stroke="none">
        <circle cx="6.25" cy="16.75" r="1.1" />
        <circle cx="15.9" cy="14.9" r=".95" />
        <circle cx="19.6" cy="18.6" r=".95" />
        <circle cx="12" cy="7" r="1.1" />
      </g>
    </svg>
  )
}
