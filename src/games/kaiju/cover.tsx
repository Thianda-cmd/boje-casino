import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'
import { COLORS } from './models/palette'

/*
  Kaiju Clash's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold
  gradients): Neon Bay at night under a big moon, searchlights crossing a magenta sky, a skyline of dark towers with lit
  windows and neon signs (the green BOJE sign among them) reflected in the bay, and two kaiju facing off over it in the
  same colours and features as their models and portraits: Rexor on the left, plates blazing cyan, firing its Atomic
  Breath, and Gorrath on the right, ember eyes and scars, driving a fist into the beam where the two meet in a burst
  of sparks. The gold "KO!" plaque sits in the corner like the other covers' plaques. Plain SVG, part of the main
  bundle. The icon is a 24 × 24 stroke drawing like the other nav icons: a kaiju's head in profile with its plates.
*/

const INK = '#0b0a24'
const FONT = 'Manrope, system-ui, sans-serif'
const R = COLORS.rexor
const G = COLORS.gorrath

/** lit windows on a tower: a few columns, some dark */
function Windows({ x, y, w, h, color, seed }: { x: number; y: number; w: number; h: number; color: string; seed: number }) {
  const cols = Math.max(1, Math.floor((w - 4) / 5))
  const rows = Math.max(1, Math.floor((h - 4) / 6))
  const out = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = Math.sin((r + 1) * 12.9898 + (c + 1) * 78.233 + seed * 37.719) * 43758.5453
      if (k - Math.floor(k) < 0.42) continue
      out.push(<rect key={`${r}-${c}`} x={x + 3 + c * 5} y={y + 4 + r * 6} width="2.4" height="3" fill={color} opacity={0.55 + 0.45 * (k - Math.floor(k))} />)
    }
  return <g>{out}</g>
}

export function KaijuCover() {
  const u = useUid() + 'kj'
  // the skyline, left to right: x, top, width, window colour
  const towers: [number, number, number, string][] = [
    [-4, 128, 18, '#ffd36b'],
    [12, 112, 16, '#7fdcff'],
    [26, 138, 14, '#ffd36b'],
    [38, 100, 20, '#ff9ad2'],
    [56, 124, 16, '#ffd36b'],
    [70, 92, 22, '#7fdcff'],
    [90, 118, 16, '#ffd36b'],
    [104, 84, 20, '#ffd36b'],
    [122, 110, 16, '#ff9ad2'],
    [136, 96, 20, '#7fdcff'],
    [154, 122, 16, '#ffd36b'],
    [168, 104, 18, '#ffd36b'],
    [184, 130, 20, '#7fdcff'],
  ]
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#120a3a" />
          <stop offset=".45" stopColor="#3a1670" />
          <stop offset=".72" stopColor="#a02a7a" />
          <stop offset=".8" stopColor="#ff4f8a" />
        </linearGradient>
        <linearGradient id={`${u}sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2a6a" />
          <stop offset="1" stopColor="#070c2a" />
        </linearGradient>
        <linearGradient id={`${u}beam`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fff6d6" stopOpacity=".38" />
          <stop offset="1" stopColor="#fff6d6" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${u}moon`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff8e0" stopOpacity=".7" />
          <stop offset="1" stopColor="#fff8e0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}cyan`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor={R.glow} stopOpacity=".8" />
          <stop offset="1" stopColor={R.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}ember`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor={G.glow} stopOpacity=".85" />
          <stop offset="1" stopColor={G.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}clash`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".3" stopColor="#fff2b0" stopOpacity=".9" />
          <stop offset="1" stopColor="#ffb04f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}breath`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={R.glow} />
          <stop offset="1" stopColor="#e8fdff" />
        </linearGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c98d14" />
        </linearGradient>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}sky)`} />
      {/* the moon and a few stars */}
      <circle cx="58" cy="44" r="34" fill={`url(#${u}moon)`} />
      <circle cx="58" cy="44" r="17" fill="#fff4d6" stroke={INK} strokeWidth="2" />
      <circle cx="52" cy="40" r="3.6" fill="#f0dfb4" />
      <circle cx="63" cy="49" r="2.6" fill="#f0dfb4" />
      {[
        [130, 22, 1.6],
        [170, 40, 1.2],
        [18, 70, 1.3],
        [150, 62, 1],
        [100, 30, 1.1],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fff6d6" />
      ))}
      {/* searchlights sweeping the sky */}
      <path d="M40 200L-8 20L12 16Z" fill={`url(#${u}beam)`} />
      <path d="M170 200L196 8L214 18Z" fill={`url(#${u}beam)`} />
      {/* the skyline: dark towers, lit windows, neon */}
      <g>
        {towers.map(([x, top, w, col], i) => (
          <g key={i}>
            <rect x={x} y={top} width={w} height={186 - top} fill={i % 2 ? '#1a1240' : '#221650'} stroke={INK} strokeWidth="1.6" />
            <Windows x={x} y={top} w={w} h={186 - top - 6} color={col} seed={i} />
          </g>
        ))}
        {/* a spire, neon strips, and the BOJE sign */}
        <path d="M108 84V82M120 84V82" stroke={INK} strokeWidth="1.6" />
        <path d="M78 92V74" stroke={INK} strokeWidth="1.6" />
        <circle cx="78" cy="72" r="1.6" fill="#ff4f8a" />
        <rect x="70" y="92" width="22" height="2.6" fill="#ff5fa2" />
        <rect x="136" y="96" width="20" height="2.6" fill="#4cb4ff" />
        <g transform="translate(102 72) rotate(-3)">
          <rect x="0" y="0" width="24" height="10" rx="2.5" fill="#06180f" stroke="#22d36f" strokeWidth="1.4" />
          <text x="12" y="7.4" textAnchor="middle" fontSize="7.4" fontWeight="900" fill="#7dffb6" fontFamily={FONT} letterSpacing=".4">BOJE</text>
        </g>
      </g>
      {/* the bay, with the city's reflections */}
      <rect x="-5" y="184" width="210" height="70" fill={`url(#${u}sea)`} />
      <path d="M-5 184H205" stroke={INK} strokeWidth="2" />
      {[
        [8, 192, 26, '#ffd36b'],
        [44, 198, 18, '#ff9ad2'],
        [72, 194, 24, '#7fdcff'],
        [120, 200, 20, '#ffd36b'],
        [150, 192, 26, '#7fdcff'],
        [30, 214, 30, '#ff4f8a'],
        [110, 220, 34, '#ffd36b'],
        [160, 212, 22, '#ff9ad2'],
      ].map(([x, y, w, c], i) => (
        <rect key={i} x={x} y={y} width={w} height="2" rx="1" fill={c as string} opacity=".55" />
      ))}

      {/* Rexor, on the left, firing the Atomic Breath */}
      <g>
        <circle cx="34" cy="128" r="46" fill={`url(#${u}cyan)`} opacity=".55" />
        {/* plates down its back */}
        {[
          [2, 182, 18, -44],
          [8, 154, 20, -32],
          [20, 128, 20, -20],
          [36, 108, 16, -6],
        ].map(([x, y, s, r], i) => (
          <path key={i} transform={`translate(${x} ${y}) rotate(${r}) scale(${s / 10})`} d="M-4.4 0L-5.2 -3L-3 -3.8L-3.8 -6.8L-1.3 -7L0 -10.8L1.3 -7L3.8 -6.8L3 -3.8L5.2 -3L4.4 0Z" fill={R.glow} stroke={INK} strokeWidth={2.4 / (s / 10)} strokeLinejoin="round" />
        ))}
        {/* body, neck, head with the jaw wide open */}
        <path d="M-12 254C-12 214 -4 184 8 162C16 146 28 128 42 118C52 110 66 106 78 110C86 113 92 120 92 127L72 133L66 150C62 168 60 200 60 254Z" fill={R.body} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M36 252C38 216 44 190 58 170" fill="none" stroke={R.accent} strokeWidth="16" strokeLinecap="round" />
        <path d="M30 236H48M32 220H50M38 204H54M44 188H58" stroke={R.extra} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M6 204C8 180 18 160 30 144" fill="none" stroke={R.dark} strokeWidth="7" strokeLinecap="round" opacity=".5" />
        <path d="M64 136L90 140C90 146 86 150 80 152L62 152Z" fill={R.body} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M66 132L92 127L90 140L64 136Z" fill="#3a0d1e" />
        <path d="M70 131l1.4 3.2l1.4 -3.2M77 129.6l1.4 3.2l1.4 -3.2M84 128.4l1.3 3l1.3 -3M72 137l1.3 -3l1.3 3M79 138.2l1.3 -3l1.3 3" fill={R.light} stroke={INK} strokeWidth=".8" />
        <path d="M58 116C64 112 72 112 78 115L76 120C70 118 64 119 60 122Z" fill={R.dark} stroke={INK} strokeWidth="1.4" />
        <circle cx="70" cy="121" r="6" fill={`url(#${u}cyan)`} />
        <ellipse cx="70" cy="121.5" rx="3.6" ry="2.2" fill={R.glow} stroke={INK} strokeWidth="1.2" transform="rotate(-10 70 121.5)" />
        <ellipse cx="70.6" cy="121.5" rx=".8" ry="1.8" fill={INK} />
        {/* the little arm, clawing */}
        <path d="M56 172C64 168 70 170 74 176" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
        <path d="M56 172C64 168 70 170 74 176" fill="none" stroke={R.body} strokeWidth="6" strokeLinecap="round" />
        <path d="M73 173l4 -2M74 178l4 1" stroke={R.light} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {/* the Atomic Breath, across to the clash */}
      <path d="M88 134L112 122L114 132L88 140Z" fill={R.glow} opacity=".55" />
      <path d="M88 135.5L113 126L113.5 129.5L88 138Z" fill={`url(#${u}breath)`} />

      {/* Gorrath, on the right, driving a fist into it */}
      <g>
        <circle cx="160" cy="134" r="46" fill={`url(#${u}ember)`} opacity=".45" />
        <path d="M110 254C112 214 118 186 128 168L132 150C136 134 148 124 164 122C182 120 198 128 206 140V254Z" fill={G.body} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        {[
          [196, 136, 30],
          [184, 126, 15],
          [136, 140, -30],
        ].map(([x, y, r], i) => (
          <path key={i} transform={`translate(${x} ${y}) rotate(${r})`} d="M-5 2L0 -9L5 2Z" fill={G.extra} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
        ))}
        {/* the bare chest and its ember scars */}
        <path d="M134 254C134 214 142 192 160 184C178 190 190 210 192 254Z" fill={G.accent} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="164" cy="210" r="24" fill={`url(#${u}ember)`} opacity=".7" />
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${144 + i * 2} ${198 + i * 9}L${184 - i * 3} ${210 + i * 8}`} stroke={G.glow} strokeWidth="3.6" strokeLinecap="round" />
        ))}
        {/* the head, low between the shoulders, facing left */}
        <circle cx="134" cy="136" r="5" fill={G.accent} stroke={INK} strokeWidth="1.4" />
        <circle cx="178" cy="136" r="5" fill={G.accent} stroke={INK} strokeWidth="1.4" />
        <path d="M134 142C132 128 140 114 156 112C172 114 180 126 178 142C174 152 166 157 156 157C146 157 138 152 134 142Z" fill={G.body} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M148 115L151 106L155 113L159 105L162 114Z" fill={G.extra} stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M138 137C138 127 147 123 156 123C165 123 174 127 174 137C175 148 167 156 156 156C145 156 137 148 138 137Z" fill={G.accent} stroke={INK} strokeWidth="1.6" />
        <path d="M139 132C146 127 166 126 173 132L172 136C165 133 147 133 140 137Z" fill={G.extra} stroke={INK} strokeWidth="1.3" />
        {[148, 164].map((x) => (
          <g key={x}>
            <circle cx={x} cy="140" r="6" fill={`url(#${u}ember)`} />
            <ellipse cx={x} cy="140.5" rx="3.4" ry="2" fill={G.glow} stroke={INK} strokeWidth="1.1" />
            <circle cx={x - 0.8} cy="140.5" r="1.1" fill={INK} />
          </g>
        ))}
        <path d="M144 147C146 144 162 144 166 147C168 153 162 156 155 156C148 156 142 153 144 147Z" fill={G.accent} stroke={INK} strokeWidth="1.4" />
        <path d="M146 151.5Q155 158 164 151.5Q155 155 146 151.5Z" fill="#3a0d12" stroke={INK} strokeWidth="1.2" />
        <path d="M148 151.6l1.2 3l1.2 -3M159.6 151.6l1.2 3l1.2 -3" fill={G.light} stroke={INK} strokeWidth=".7" />
        {/* the arm, flung out to the left with the fist into the beam */}
        <path d="M150 176C138 166 128 150 124 136" fill="none" stroke={INK} strokeWidth="20" strokeLinecap="round" />
        <path d="M150 176C138 166 128 150 124 136" fill="none" stroke={G.body} strokeWidth="15" strokeLinecap="round" />
        <path d="M134 156l-6 -2M140 164l-6 0" stroke={G.extra} strokeWidth="2" strokeLinecap="round" />
        <circle cx="121" cy="128" r="11" fill={G.extra} stroke={INK} strokeWidth="2.6" />
        <path d="M112 124C114 120 118 118 122 119M111 129C112 126 115 125 118 125M112 134C113 131 116 131 119 131" fill="none" stroke={G.accent} strokeWidth="2.6" strokeLinecap="round" />
      </g>

      {/* the clash: where the breath meets the fist */}
      <circle cx="112" cy="128" r="22" fill={`url(#${u}clash)`} />
      <path d="M112 106L115 122L130 116L119 127L134 134L117 132L118 148L111 133L100 144L106 129L92 122L108 124Z" fill="#fff8d6" stroke="#ffb04f" strokeWidth="1.2" strokeLinejoin="round" />
      {[
        [96, 108, 1.8],
        [132, 104, 1.6],
        [138, 146, 1.4],
        [92, 150, 1.6],
        [126, 98, 1.2],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? R.glow : '#ffd36b'} />
      ))}

      {/* the plaque */}
      <g transform="rotate(10 170 40)">
        <path d="M144 24L158 20L166 10L174 20L192 18L184 32L194 44L178 46L172 60L164 48L148 52L154 38Z" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
        <text x="170" y="37" textAnchor="middle" dominantBaseline="central" fontSize="16" fontWeight="900" fontStyle="italic" fill="#3a1200" fontFamily={FONT} letterSpacing="-.5">
          KO!
        </text>
      </g>
    </svg>
  )
}

export function KaijuIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <path d="M5 21v-7.2C5 9.5 8.4 6 12.6 6h3.2c3 0 5.4 2.2 5.4 5v1.4h-6.4" />
      <path d="M21.2 12.4v.9c0 1.7-1.3 3-3 3h-4.6L10 21" />
      <path d="M5.1 14.6 2.4 13l2.9-1.2-2-2.6 3.3-.3-.6-3.2 2.9 1.5" />
      <circle cx="15.6" cy="9.4" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}
