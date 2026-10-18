import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Reef Raid's lobby cover and navigation icon. The cover is the game's moment in the lobby's cartoon style (ink
  outlines, bold fills, a soft light): a clownfish darting across a sunlit reef, a torpedo's rope net flung open
  beside it in a burst of gold coins, a hammerhead cruising overhead, and the cannon's barrel peeking in at the corner
  with the torpedo's bubble trail behind it. Plain SVG, no three.js: it ships in the main bundle. The icon is a 24 × 24 stroke
  drawing like the other nav icons: a fish in the cannon's crosshair.
*/

const INK = '#171338'

/** a five-point star of outer radius r round the origin */
const star = (r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5 - Math.PI / 2
    const k = i % 2 ? r * 0.45 : r
    return `${i ? 'L' : 'M'}${(Math.cos(a) * k).toFixed(2)} ${(Math.sin(a) * k).toFixed(2)}`
  }).join(' ') + 'Z'

/** a gold coin, tipped `tilt` degrees and squashed by `squash` (a coin seen edge-on is a sliver) */
function Coin({ x, y, r, tilt = 0, squash = 1, grad }: { x: number; y: number; r: number; tilt?: number; squash?: number; grad: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${squash} 1)`}>
      <circle r={r} fill="#c77d12" stroke={INK} strokeWidth="1.8" transform={`translate(${r * 0.16} ${r * 0.1})`} />
      <circle r={r} fill={`url(#${grad})`} stroke={INK} strokeWidth="1.8" />
      <circle r={r * 0.62} fill="none" stroke="#d99a2b" strokeWidth="1.1" />
      <path d={star(r * 0.42)} fill="#fff4c2" />
      <ellipse cx={-r * 0.38} cy={-r * 0.42} rx={r * 0.26} ry={r * 0.13} fill="#fff" opacity=".8" transform={`rotate(-35 ${-r * 0.38} ${-r * 0.42})`} />
    </g>
  )
}

/** a four-point twinkle */
function Twinkle({ x, y, r, color = '#fff' }: { x: number; y: number; r: number; color?: string }) {
  return <path d={`M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z`} fill={color} />
}

/** a bubble with its shine */
function Bubble({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#dff9ff" fillOpacity=".28" stroke="#fff" strokeOpacity=".85" strokeWidth={Math.max(0.9, r * 0.2)} />
      <circle cx={x - r * 0.35} cy={y - r * 0.35} r={r * 0.28} fill="#fff" opacity=".9" />
    </g>
  )
}

/** a rope line: ink under a tan cord */
function Rope({ d, w = 2 }: { d: string; w?: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={w + 2.4} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#e2ac6c" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
}

/** Reef Raid: a clownfish on a sunlit reef, a torpedo's net bursting with gold beside it, a hammerhead cruising over */
export function ReefCover() {
  const u = useUid()
  // the net: a dome of rope mesh flung open at (NX, NY), tipped towards the viewer
  const NX = 150
  const NY = 116
  const dome = `M${NX - 30} ${NY + 6} Q${NX - 30} ${NY - 34} ${NX} ${NY - 34} Q${NX + 30} ${NY - 34} ${NX + 30} ${NY + 6} Q${NX} ${NY + 16} ${NX - 30} ${NY + 6} Z`
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}sea`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor="#8cf0f4" />
          <stop offset=".42" stopColor="#36bde0" />
          <stop offset="1" stopColor="#1a6ab4" />
        </linearGradient>
        <linearGradient id={`${u}ray`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".6" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}sand`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9ad" />
          <stop offset="1" stopColor="#e6b25e" />
        </linearGradient>
        <linearGradient id={`${u}shark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9c0d6" />
          <stop offset=".55" stopColor="#7d96b0" />
          <stop offset="1" stopColor="#5f7894" />
        </linearGradient>
        <radialGradient id={`${u}clown`} cx=".62" cy=".3" r=".9">
          <stop offset="0" stopColor="#ffb05a" />
          <stop offset=".55" stopColor="#ff8a2a" />
          <stop offset="1" stopColor="#e9621c" />
        </radialGradient>
        <radialGradient id={`${u}coin`} cx=".36" cy=".32" r=".8">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset=".55" stopColor="#ffc93d" />
          <stop offset="1" stopColor="#e09a12" />
        </radialGradient>
        <radialGradient id={`${u}burst`}>
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset=".35" stopColor="#ffe27a" stopOpacity=".8" />
          <stop offset="1" stopColor="#ffd24a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}barrel`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffa0d0" />
          <stop offset=".45" stopColor="#ff4fa0" />
          <stop offset="1" stopColor="#d22f7e" />
        </linearGradient>
        <clipPath id={`${u}dome`}>
          <path d={dome} />
        </clipPath>
      </defs>

      {/* the sea and the sun shafts slanting down through it */}
      <rect width="200" height="250" fill={`url(#${u}sea)`} />
      <g fill={`url(#${u}ray)`}>
        <path d="M24 -6 L48 -6 L104 196 L70 196 Z" opacity=".5" />
        <path d="M70 -6 L84 -6 L140 176 L118 176 Z" opacity=".35" />
        <path d="M-12 -6 L4 -6 L40 160 L16 160 Z" opacity=".35" />
        <path d="M128 -6 L136 -6 L184 150 L172 150 Z" opacity=".25" />
      </g>
      {/* a far school of tangs, pale in the blue */}
      <g fill="#2b86c6" opacity=".5">
        {[
          [26, 70, 0.9],
          [40, 62, 0.75],
          [14, 60, 0.7],
          [36, 78, 0.65],
        ].map(([x, y, k], i) => (
          <path key={i} transform={`translate(${x} ${y}) scale(${k})`} d="M9 0 Q3 -6 -6 -2 L-11 -6 L-10 0 L-11 6 L-6 2 Q3 6 9 0Z" />
        ))}
      </g>

      {/* the hammerhead cruising over the reef, its hammer turned to the gold */}
      <g stroke={INK} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
        <path d="M100 30 Q106 8 122 -2 Q124 14 122 28 Z" fill="#7d96b0" />
        <path d="M-12 26 C30 14 110 14 160 26 L160 46 C110 58 30 56 -12 46 Z" fill={`url(#${u}shark)`} />
        <path d="M0 46 C40 54 110 54 156 44" fill="none" stroke="#e6eff7" strokeWidth="4.5" />
        <path d="M116 46 Q130 56 132 74 Q118 66 104 50 Z" fill="#6c86a2" />
        <path d="M156 24 Q170 18 182 10 Q190 6 190 14 L190 58 Q190 66 182 62 Q170 54 156 48 Q150 36 156 24 Z" fill={`url(#${u}shark)`} />
      </g>
      <path d="M96 30 v8 M103 30 v8 M110 31 v8" stroke={INK} strokeOpacity=".35" strokeWidth="1.6" strokeLinecap="round" />
      <g stroke={INK} strokeWidth="1.9">
        <circle cx="186" cy="16" r="6.4" fill="#fff" />
        <circle cx="186" cy="57" r="6.4" fill="#fff" />
      </g>
      <circle cx="184.2" cy="18.2" r="3.4" fill={INK} />
      <circle cx="184.2" cy="58.6" r="3.4" fill={INK} />
      <circle cx="183" cy="16.8" r="1.2" fill="#fff" />
      <circle cx="183" cy="57.2" r="1.2" fill="#fff" />
      <path d="M179 8 Q186 5 193 9" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M168 40 q5 4 10 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />

      {/* the reef floor: sand and ripples, the light dancing on it */}
      <path d="M-5 192 Q34 182 70 188 T136 186 T205 182 V255 H-5 Z" fill={`url(#${u}sand)`} stroke={INK} strokeWidth="2.4" />
      <g fill="none" stroke="#d29a46" strokeWidth="1.6" strokeLinecap="round" opacity=".7">
        <path d="M60 212 q10 -4 20 0 M96 206 q12 -5 24 0 M74 230 q12 -4 24 0 M128 222 q10 -4 20 0" />
      </g>
      <g fill="none" stroke="#fff7da" strokeWidth="1.4" strokeLinecap="round" opacity=".8">
        <path d="M84 198 q6 -3 10 2 q5 4 10 -1 M112 216 q5 -4 10 0 q5 4 9 0 M56 222 q6 -3 9 1" />
      </g>

      {/* the reef on the left: kelp, a pink branching coral, purple tubes */}
      <g stroke={INK} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M4 196 C-2 168 10 150 4 124 C14 144 18 168 13 196 Z" fill="#3fc47a" />
        <path d="M14 196 C14 172 26 158 22 136 C30 158 28 178 24 196 Z" fill="#5ad88e" />
        <path d="M30 196 L33 172 L24 158 M33 172 L42 152 M38 162 L50 158 M29 182 L19 174" fill="none" stroke={INK} strokeWidth="8.4" />
        <path d="M30 196 L33 172 L24 158 M33 172 L42 152 M38 162 L50 158 M29 182 L19 174" fill="none" stroke="#ff6fa8" strokeWidth="4.6" />
      </g>
      {[
        [24, 158],
        [42, 152],
        [50, 158],
        [19, 174],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3.6" fill="#ff9cc6" stroke={INK} strokeWidth="1.8" />
      ))}
      <g stroke={INK} strokeWidth="2">
        {[
          [52, 196, 12],
          [60, 197, 17],
          [68, 198, 10],
        ].map(([x, y, h], i) => (
          <g key={i}>
            <rect x={x - 3.8} y={y - h} width="7.6" height={h} rx="3.4" fill="#9a6bff" />
            <ellipse cx={x} cy={y - h} rx="3.8" ry="1.8" fill="#5b33c9" />
          </g>
        ))}
      </g>

      {/* the reef on the right: an orange sea fan, a brain coral, a starfish and a shell */}
      <g stroke={INK} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M150 190 C142 168 150 146 168 140 C188 136 202 150 200 172 C198 182 192 188 186 190 Z" fill="#ff9a3c" />
        <path d="M168 188 L168 148 M168 170 L154 156 M168 166 L184 150 M168 178 L190 166 M168 158 L176 144" fill="none" stroke="#d9661e" strokeWidth="1.6" />
        {[
          [158, 160],
          [180, 156],
          [190, 172],
          [158, 178],
          [176, 180],
          [184, 146],
          [162, 148],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.2" fill="#ffc27a" stroke="none" />
        ))}
        <ellipse cx="128" cy="196" rx="15" ry="9" fill="#2fd0c0" />
        <path d="M116 196 q6 -5 12 0 t12 0 M118 191 q5 -3 10 0 t10 0" fill="none" stroke="#17958a" strokeWidth="1.4" />
        <path d="M98 212 l2.8 5.8 6.2 .4 -4.8 4 1.8 6 -5.6 -3.2 -5.4 3.4 1.6 -6.2 -5 -3.8 6.2 -.6 Z" fill="#ff5a6e" strokeWidth="1.7" />
        <path d="M44 214 q8 -10 16 0 Z" fill="#ffe3ef" strokeWidth="1.8" />
      </g>

      {/* the burst: a flash and rays where the net flies open */}
      <circle cx={NX} cy={NY - 6} r="50" fill={`url(#${u}burst)`} />
      <g fill="#fff">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d={`M${NX} ${NY - 6} L${NX - 2.6} ${NY - 56} L${NX + 2.6} ${NY - 56} Z`} transform={`rotate(${i * 30 + 10} ${NX} ${NY - 6})`} opacity={i % 2 ? 0.45 : 0.85} />
        ))}
      </g>

      {/* the net: a rope dome flung open, its mesh and the rim of floats, coins bursting out of it */}
      <path d={dome} fill="#fff6d0" fillOpacity=".35" />
      <g clipPath={`url(#${u}dome)`}>
        {[-40, -26, -12, 2, 16, 30].map((k) => (
          <Rope key={`a${k}`} d={`M${NX + k - 20} ${NY + 20} L${NX + k + 30} ${NY - 40}`} w={1.6} />
        ))}
        {[-40, -26, -12, 2, 16, 30].map((k) => (
          <Rope key={`b${k}`} d={`M${NX - k + 20} ${NY + 20} L${NX - k - 30} ${NY - 40}`} w={1.6} />
        ))}
      </g>
      <Rope d={`M${NX - 30} ${NY + 6} Q${NX - 30} ${NY - 34} ${NX} ${NY - 34} Q${NX + 30} ${NY - 34} ${NX + 30} ${NY + 6}`} w={2.4} />
      <Rope d={`M${NX - 30} ${NY + 6} Q${NX} ${NY + 16} ${NX + 30} ${NY + 6}`} w={2.8} />
      {(
        [
          [NX - 30, NY + 6, '#ff4b3e'],
          [NX - 12, NY + 11, '#fff'],
          [NX + 12, NY + 11, '#ff4b3e'],
          [NX + 30, NY + 6, '#fff'],
        ] as const
      ).map(([x, y, c], i) => (
        <ellipse key={i} cx={x} cy={y} rx="4.6" ry="3.6" fill={c} stroke={INK} strokeWidth="1.7" />
      ))}
      <Coin x={NX - 2} y={NY - 52} r={9.5} grad={`${u}coin`} />
      <Coin x={NX - 30} y={NY - 44} r={8} tilt={-24} squash={0.8} grad={`${u}coin`} />
      <Coin x={NX + 26} y={NY - 46} r={8.5} tilt={20} squash={0.7} grad={`${u}coin`} />
      <Coin x={NX + 40} y={NY - 18} r={7} tilt={34} squash={0.55} grad={`${u}coin`} />
      <Coin x={NX - 44} y={NY - 18} r={7} tilt={-36} squash={0.6} grad={`${u}coin`} />
      <Coin x={NX + 16} y={NY - 62} r={6.5} squash={0.45} grad={`${u}coin`} />
      <Coin x={NX - 22} y={NY - 62} r={6} tilt={-10} grad={`${u}coin`} />
      <Coin x={NX + 42} y={NY + 14} r={6.5} tilt={12} squash={0.8} grad={`${u}coin`} />
      <Coin x={NX + 6} y={NY - 26} r={7} tilt={-6} squash={0.9} grad={`${u}coin`} />
      <g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".95">
        <path d={`M${NX - 40} ${NY - 58} l-6 -6 M${NX + 36} ${NY - 62} l6 -6 M${NX + 50} ${NY - 30} l7 -2 M${NX - 54} ${NY - 30} l-7 -2 M${NX + 2} ${NY - 66} v-5`} />
      </g>
      <Twinkle x={NX - 40} y={NY - 64} r={5} />
      <Twinkle x={NX + 44} y={NY - 52} r={4} color="#fff6c2" />
      <Twinkle x={NX - 50} y={NY - 4} r={3.6} color="#fff6c2" />
      <Twinkle x={NX + 34} y={NY - 2} r={3.2} />

      {/* the clownfish darting past, beaming at the haul */}
      <g stroke={INK} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
        <path d="M40 132 Q24 108 8 106 Q18 132 8 158 Q24 156 40 132 Z" fill={`url(#${u}clown)`} />
        <path d="M54 104 Q60 82 76 86 Q84 90 86 100 Z" fill={`url(#${u}clown)`} />
        <path d="M88 101 Q98 86 110 94 Q114 100 113 106 Z" fill={`url(#${u}clown)`} />
        <path d="M36 132 C36 104 62 98 84 100 C108 102 126 116 128 132 C126 148 108 162 84 164 C62 166 36 160 36 132 Z" fill={`url(#${u}clown)`} />
        <path d="M100 103 C92 116 92 148 100 161 L111 157 C104 144 104 120 111 107 Z" fill="#fff" />
        <path d="M66 99 C58 116 58 148 66 165 L79 165 C71 148 71 116 79 99 Z" fill="#fff" />
        <path d="M42 113 C38 122 38 142 42 151 L50 155 C45 143 45 121 50 109 Z" fill="#fff" />
        <path d="M66 164 Q74 180 88 172 Q84 166 82 162 Z" fill={`url(#${u}clown)`} />
        <path d="M90 138 Q104 146 106 162 Q94 158 86 144 Z" fill="#ffa24c" />
      </g>
      <circle cx="113" cy="122" r="9.6" fill="#fff" stroke={INK} strokeWidth="2.2" />
      <circle cx="115.4" cy="122.8" r="6" fill={INK} />
      <circle cx="113.4" cy="120.2" r="2.2" fill="#fff" />
      <circle cx="117.6" cy="125.4" r="1" fill="#fff" />
      <path d="M106 109 Q113 106 120 110" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="114" cy="139" rx="4.4" ry="2.6" fill="#ff5a7a" opacity=".55" />
      <path d="M120 136 Q124 142 129 137 Q126 133 120 136 Z" fill="#a8253a" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <ellipse cx="96" cy="116" rx="10" ry="4" fill="#fff" opacity=".35" transform="rotate(-16 96 116)" />
      <g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".85">
        <path d="M2 122 h-8 M4 134 h-12 M6 146 h-8" />
      </g>

      {/* the torpedo's bubble trail, from the cannon to the net */}
      {[
        [167, 194, 3.8],
        [164, 182, 3.2],
        [161, 171, 2.8],
        [158, 161, 2.4],
        [156, 152, 2],
        [172, 203, 2.4],
      ].map(([x, y, r], i) => (
        <Bubble key={i} x={x} y={y} r={r} />
      ))}

      {/* the cannon's barrel peeking in at the corner, aimed up at the net */}
      <g transform="translate(176 226) rotate(-14)" stroke={INK} strokeWidth="2.6" strokeLinejoin="round">
        <path d="M-12 60 L-11 4 L11 4 L12 60 Z" fill={`url(#${u}barrel)`} />
        <path d="M-6 56 V9" stroke="#fff" strokeOpacity=".5" strokeWidth="3.6" strokeLinecap="round" />
        <rect x="-14" y="16" width="28" height="6.4" rx="2.8" fill="#ffcf5a" />
        <rect x="-14" y="32" width="28" height="6.4" rx="2.8" fill="#ffcf5a" />
        <path d="M-4.4 27.2 l4.4 -4.4 4.4 4.4 -4.4 4.4 Z" fill="#3be8ff" strokeWidth="1.6" />
        <path d="M-11 6 L-17 -6 L17 -6 L11 6 Z" fill="#ffcf5a" />
        <ellipse cx="0" cy="-6" rx="17" ry="4.6" fill="#ffcf5a" />
        <ellipse cx="0" cy="-6" rx="10.5" ry="2.5" fill={INK} stroke="none" opacity=".75" />
      </g>

      {/* bubbles rising */}
      <Bubble x={80} y={70} r={3.4} />
      <Bubble x={86} y={56} r={2.2} />
      <Bubble x={14} y={100} r={3} />
      <Bubble x={22} y={88} r={1.8} />
      <Bubble x={60} y={80} r={2} />
    </svg>
  )
}

/** a big round fish filling the icon (readable at nav size), bubbles rising from it */
export function ReefIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <path d="M2.6 14c2.5-4.3 8-5.4 12-2.2l5.3-3.4v11.2l-5.3-3.4c-4 3.2-9.5 2.1-12-2.2Z" />
      <circle cx="7.2" cy="13.2" r="1.2" fill="currentColor" stroke="none" />
      <path d="M11 11.6c.9 1.6.9 3.3 0 5" strokeWidth="1.6" />
      <circle cx="12.5" cy="5" r="1.7" strokeWidth="1.6" />
      <circle cx="17.2" cy="2.8" r="1.1" strokeWidth="1.5" />
    </svg>
  )
}
