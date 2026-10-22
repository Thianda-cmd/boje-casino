import type { ReactNode } from 'react'
import { useUid } from '../../art/ids'
import { COLORS, INK, type KaijuColors } from './models/palette'
import type { KaijuId } from './types'

/*
  Kaiju portraits: crisp head-and-shoulders drawings of the eight, for the betting board, the tale of the tape, the
  fight card and the history. Plain SVG on a 100-unit grid in the same toon style and colours as the 3D models
  (models/palette.ts): flat fills with one shade tone, ink outlines, and the glowing parts (eyes, plates, scars,
  cracks, eyespots, lines) lit in the kaiju's glow colour with a soft halo drawn as a radial gradient, so they stay
  cheap in long lists. Each faces right in three-quarter view; `mirror` turns it to face left (the B corner).

  `mood` changes the face: calm (the default), fierce (brows down, teeth bared), hurt (an eye squeezed shut, a bead
  of sweat), ko (crossed-out eyes, tongue out, the glow gone dim, stars), win (happy eyes, a roar, sparkles, the glow
  bright). `bg` puts it on a rounded tile lit in its glow colour.
*/

export type Mood = 'calm' | 'fierce' | 'hurt' | 'ko' | 'win'

interface Draw {
  c: KaijuColors
  mood: Mood
  /** the id prefix for this portrait's gradients */
  u: string
}

const SW = 2.6
const ink = { stroke: INK, strokeWidth: SW, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
const thin = { stroke: INK, strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }

/** a soft glow behind something bright */
const Halo = ({ x, y, r, u, o = 1 }: { x: number; y: number; r: number; u: string; o?: number }) => <circle cx={x} cy={y} r={r} fill={`url(#${u}halo)`} opacity={o} />

/** a glowing eye in its mood: a lit almond with a slit pupil, a squeezed-shut chevron, a cross, a happy arc */
function Eye({ x, y, w, h, rot = -12, d, pupil = 'slit', brow }: { x: number; y: number; w: number; h: number; rot?: number; d: Draw; pupil?: 'slit' | 'round' | 'bar' | 'none'; brow?: string }) {
  const { c, mood, u } = d
  if (mood === 'ko')
    return (
      <g {...ink} strokeWidth={2.2} fill="none">
        <path d={`M${x - w * 0.8} ${y - h * 0.8}L${x + w * 0.8} ${y + h * 0.8}M${x + w * 0.8} ${y - h * 0.8}L${x - w * 0.8} ${y + h * 0.8}`} />
      </g>
    )
  if (mood === 'hurt')
    return <path d={`M${x - w} ${y - h * 0.7}L${x + w * 0.4} ${y}L${x - w} ${y + h * 0.7}`} fill="none" {...ink} strokeWidth={2.2} />
  if (mood === 'win')
    return (
      <g>
        <Halo x={x} y={y} r={w * 2.4} u={u} />
        <path d={`M${x - w} ${y + h * 0.5}Q${x} ${y - h * 1.5} ${x + w} ${y + h * 0.5}`} fill="none" stroke={INK} strokeWidth={4.2} strokeLinecap="round" />
        <path d={`M${x - w} ${y + h * 0.5}Q${x} ${y - h * 1.5} ${x + w} ${y + h * 0.5}`} fill="none" stroke={c.glow} strokeWidth={2.2} strokeLinecap="round" />
      </g>
    )
  const fierce = mood === 'fierce'
  return (
    <g transform={`rotate(${rot} ${x} ${y})`}>
      <Halo x={x} y={y} r={w * 2.2} u={u} o={fierce ? 1 : 0.8} />
      <ellipse cx={x} cy={y} rx={w} ry={fierce ? h * 0.72 : h} fill={c.glow} {...thin} />
      <ellipse cx={x} cy={y} rx={w * 0.55} ry={(fierce ? h * 0.72 : h) * 0.55} fill="#ffffff" opacity=".55" />
      {pupil === 'slit' && <ellipse cx={x + w * 0.15} cy={y} rx={w * 0.2} ry={(fierce ? h * 0.72 : h) * 0.8} fill={INK} />}
      {pupil === 'round' && <circle cx={x + w * 0.2} cy={y} r={Math.min(w, h) * 0.42} fill={INK} />}
      {pupil === 'bar' && <rect x={x - w * 0.55} y={y - h * 0.16} width={w * 1.2} height={h * 0.32} rx={h * 0.16} fill={INK} />}
      {brow && <path d={`M${x - w * 1.4} ${y - h * (fierce ? 0.35 : 0.95)}L${x + w * 1.35} ${y - h * (fierce ? 0.05 : 0.75)}L${x + w * 1.3} ${y - h * 1.9}L${x - w * 1.5} ${y - h * 2.1}Z`} fill={brow} />}
    </g>
  )
}

/** the little extras round a face in some moods */
function MoodMarks({ d, x, y }: { d: Draw; x: number; y: number }) {
  if (d.mood === 'hurt')
    return <path d={`M${x} ${y}c2.6 3.6 3.6 6 3.6 7.6a3.6 3.6 0 0 1 -7.2 0c0 -1.6 1 -4 3.6 -7.6z`} fill="#8fd8ff" {...thin} strokeWidth={1.2} />
  if (d.mood === 'ko')
    return (
      <g fill="#ffd23f" {...thin} strokeWidth={1.1}>
        {[
          [x - 14, y + 2, 3.4],
          [x, y - 4, 4],
          [x + 14, y + 1, 3.2],
        ].map(([sx, sy, r], i) => (
          <path key={i} d={star(sx, sy, r)} />
        ))}
      </g>
    )
  if (d.mood === 'win')
    return (
      <g fill="#fff6c8">
        {[
          [x - 12, y, 3],
          [x + 10, y - 6, 3.6],
          [x + 18, y + 6, 2.4],
        ].map(([sx, sy, r], i) => (
          <path key={i} d={sparkle(sx, sy, r)} />
        ))}
      </g>
    )
  return null
}

const star = (x: number, y: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    return `${i ? 'L' : 'M'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`
  }).join('') + 'Z'
const sparkle = (x: number, y: number, r: number) => `M${x} ${y - r * 2}L${x + r * 0.45} ${y - r * 0.45}L${x + r * 2} ${y}L${x + r * 0.45} ${y + r * 0.45}L${x} ${y + r * 2}L${x - r * 0.45} ${y + r * 0.45}L${x - r * 2} ${y}L${x - r * 0.45} ${y - r * 0.45}Z`

/** how open a mouth is in each mood (0 shut .. 1 roaring) */
const open = (m: Mood) => (m === 'calm' ? 0 : m === 'hurt' ? 0.25 : m === 'fierce' ? 0.65 : m === 'ko' ? 0.55 : 1)
/** how bright the glow burns in each mood */
const burn = (m: Mood) => (m === 'ko' ? 0.35 : m === 'win' ? 1 : m === 'fierce' ? 0.95 : 0.8)

/* ------------------------------------------------------------------ */
/*  The eight                                                           */
/* ------------------------------------------------------------------ */

function Rexor(d: Draw) {
  const { c, mood } = d
  const o = open(mood)
  const jaw = 16 * o
  return (
    <g>
      {/* dorsal plates behind the neck, glowing */}
      <g opacity={burn(mood)}>
        <Halo x={22} y={46} r={26} u={d.u} />
        {[
          [14, 70, 15, -28],
          [18, 50, 17, -18],
          [28, 32, 14, -6],
        ].map(([x, y, s, r], i) => (
          <path key={i} transform={`translate(${x} ${y}) rotate(${r}) scale(${s / 10})`} d="M-4.4 0L-5.2 -3L-3 -3.8L-3.8 -6.8L-1.3 -7L0 -10.8L1.3 -7L3.8 -6.8L3 -3.8L5.2 -3L4.4 0Z" fill={c.glow} {...ink} strokeWidth={SW / (s / 10)} />
        ))}
        {[
          [14, 70, 7, -28],
          [18, 50, 8, -18],
          [28, 32, 6.5, -6],
        ].map(([x, y, s, r], i) => (
          <path key={i} transform={`translate(${x} ${y}) rotate(${r}) scale(${s / 10})`} d="M-2 -1L0 -8L2 -1Z" fill="#ffffff" opacity=".7" />
        ))}
      </g>
      {/* shoulders and the pale chest */}
      <path d="M-4 104C-2 86 10 74 30 70C46 67 60 70 70 76C82 82 92 92 96 104Z" fill={c.body} {...ink} />
      <path d="M40 104C40 92 46 82 56 78C66 80 76 88 80 104Z" fill={c.accent} {...thin} />
      <path d="M48 90H72M46 97H76" stroke={c.extra} strokeWidth="1.6" strokeLinecap="round" />
      {/* the neck and the big head, snout to the right */}
      <path d="M28 80C24 66 26 52 34 40C40 30 50 24 62 24C70 24 78 28 84 33C90 37 95 41 95 47C95 51 92 53 88 54L66 56L58 66C52 74 44 80 36 84Z" fill={c.body} {...ink} />
      <path d="M30 76C27 64 29 52 36 42" fill="none" stroke={c.dark} strokeWidth="5" strokeLinecap="round" opacity=".55" />
      {/* the jaw, dropped by the mood */}
      <g transform={`rotate(${jaw} 60 56)`}>
        {o > 0.1 && <path d="M64 55L92 54C90 58 86 61 80 62L64 63Z" fill="#3a0d1e" />}
        <path d="M58 56L90 55C91 60 88 64 82 65C74 67 64 67 56 66Z" fill={c.body} {...ink} />
        <path d="M60 63C68 65 76 65 82 63" fill="none" stroke={c.accent} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M70 56l1.6 -3.4l1.6 3.4M77 55.6l1.6 -3.2l1.6 3.2M84 55.2l1.4 -3l1.4 3" fill="#f3efd8" {...thin} strokeWidth={0.9} />
      </g>
      <path d="M66 55.2l1.6 3.6l1.6 -3.6M73 55l1.6 3.6l1.6 -3.6M80 54.6l1.5 3.4l1.5 -3.4M86.5 54.2l1.3 3l1.3 -3" fill="#f3efd8" {...thin} strokeWidth={0.9} />
      <path d="M66 56L92 54" fill="none" {...thin} />
      {/* the heavy brow, the eye under it, the nostril, the spikes at the back */}
      <path d="M52 33C58 27 68 26 76 29L75 34C68 32 60 33 54 37Z" fill={c.dark} {...thin} />
      <Eye x={66} y={40} w={5.4} h={3.5} rot={-10} d={d} brow={c.dark} />
      <ellipse cx="88" cy="42" rx="1.8" ry="1.2" fill={c.dark} />
      <path d="M38 36L28 30L38 42M36 48L24 46L36 54" fill={c.dark} {...thin} />
      <MoodMarks d={d} x={76} y={14} />
    </g>
  )
}

function Gorrath(d: Draw) {
  const { c, mood } = d
  const o = open(mood)
  return (
    <g>
      {/* the mountain of shoulders, bristling */}
      <path d="M-6 104C-6 76 6 58 24 52L36 48L66 48L80 52C96 58 106 76 106 104Z" fill={c.body} {...ink} />
      {[
        [6, 66, -40],
        [14, 56, -25],
        [86, 56, 25],
        [94, 66, 40],
        [28, 48, -10],
        [72, 48, 10],
      ].map(([x, y, r], i) => (
        <path key={i} transform={`translate(${x} ${y}) rotate(${r})`} d="M-5 2L0 -9L5 2Z" fill={c.extra} {...thin} />
      ))}
      {/* the bare chest with its ember scars */}
      <path d="M24 104C26 86 36 76 50 74C64 76 74 86 76 104Z" fill={c.accent} {...ink} />
      <g opacity={burn(mood)}>
        <Halo x={50} y={92} r={24} u={d.u} o={0.7} />
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${30 + i * 2} ${84 + i * 6}L${70 - i * 3} ${92 + i * 5}`} stroke={c.glow} strokeWidth="3.4" strokeLinecap="round" />
        ))}
      </g>
      {/* the head, sunk low: ears, a fur cap with a tufted crest, the heavy brow, the pale face and muzzle */}
      <circle cx="25" cy="45" r="5.5" fill={c.accent} {...thin} />
      <circle cx="75" cy="45" r="5.5" fill={c.accent} {...thin} />
      <path d="M24 50C22 34 32 21 50 20C68 21 78 34 76 50C72 62 62 67 50 67C38 67 28 62 24 50Z" fill={c.body} {...ink} />
      <path d="M40 23L44 13L49 21L54 12L58 22L62 16L63 25Z" fill={c.extra} {...thin} />
      <path d="M29 46C29 35 39 31 50 31C61 31 71 35 71 46C72 56 64 65 50 65C36 65 28 56 29 46Z" fill={c.accent} {...thin} />
      <path d="M32 41C39 35 61 34 69 40L68 44C60 41 41 41 33 45Z" fill={c.extra} {...thin} />
      <Eye x={42} y={46} w={4} h={2.8} rot={-6} d={d} pupil="round" brow={c.extra} />
      <Eye x={58} y={46} w={4} h={2.8} rot={6} d={d} pupil="round" brow={c.extra} />
      <path d="M38 54C40 50 60 50 62 54C64 60 58 64 50 64C42 64 36 60 38 54Z" fill={c.accent} {...thin} />
      <ellipse cx="46" cy="54" rx="2" ry="1.4" fill={c.dark} />
      <ellipse cx="54" cy="54" rx="2" ry="1.4" fill={c.dark} />
      {o > 0.1 ? (
        <g>
          <path d={`M41 59Q50 ${61 + o * 8} 59 59Q50 ${63 + o * 4} 41 59Z`} fill="#3a0d12" {...thin} />
          <path d="M43 59l1.4 3.6l1.4 -3.6M54.6 59l1.4 3.6l1.4 -3.6" fill={c.light} {...thin} strokeWidth={0.8} />
        </g>
      ) : (
        <path d="M42 60Q50 62 58 60M44 60l1.4 3l1.4 -3M54 60l1.4 3l1.4 -3" fill={c.light} {...thin} strokeWidth={1.1} />
      )}
      <MoodMarks d={d} x={50} y={10} />
    </g>
  )
}

function Titan(d: Draw) {
  const { c, mood } = d
  const lit = burn(mood)
  return (
    <g>
      {/* shoulder plates with hazard trim, the chest and its reactor */}
      <path d="M2 104L4 74C4 66 10 62 18 62L34 62L38 104Z" fill={c.body} {...ink} />
      <path d="M98 104L96 74C96 66 90 62 82 62L66 62L62 104Z" fill={c.body} {...ink} />
      <path d="M6 70H34M94 70H66" stroke={c.extra} strokeWidth="4" />
      <path d="M6 70H34M94 70H66" stroke={INK} strokeWidth="1" opacity=".4" />
      <path d="M28 104L30 78C30 72 36 68 50 68C64 68 70 72 70 78L72 104Z" fill={c.body} {...ink} />
      <g opacity={lit}>
        <Halo x={50} y={92} r={16} u={d.u} />
        <circle cx="50" cy="92" r="7.5" fill={c.accent} {...thin} />
        <circle cx="50" cy="92" r="5" fill={c.glow} />
        <circle cx="50" cy="92" r="2.2" fill="#ffffff" />
      </g>
      <path d="M34 82H42M34 86H42M58 82H66M58 86H66" stroke={c.accent} strokeWidth="2" strokeLinecap="round" />
      {/* the neck and the helmet: dark visor band, one red eye, ear fins, antenna */}
      <rect x="42" y="56" width="16" height="12" fill={c.accent} {...thin} />
      <path d="M58 18V8" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M58 18V8" stroke="#d8e2ee" strokeWidth="1.6" strokeLinecap="round" />
      <g opacity={lit}>
        <Halo x={58} y={7} r={6} u={d.u} />
        <circle cx="58" cy="7" r="2.4" fill={c.glow} {...thin} strokeWidth={1} />
      </g>
      <path d="M24 30L28 24L32 52L26 50Z" fill={c.extra} {...thin} />
      <path d="M30 26C30 20 34 16 42 16H66C74 16 78 20 78 28V48C78 56 72 60 64 60H40C34 60 30 56 30 50Z" fill={c.body} {...ink} />
      <path d="M44 16H58V24H44Z" fill={c.accent} {...thin} />
      <path d="M34 32H78V42H34Z" fill="#0d1219" {...thin} />
      {mood === 'ko' ? (
        <path d="M54 34L64 40M64 34L54 40" stroke={c.glow} strokeWidth="2" strokeLinecap="round" opacity=".6" />
      ) : mood === 'win' ? (
        <g>
          <Halo x={60} y={37} r={14} u={d.u} />
          <path d="M50 39Q60 31 70 39" fill="none" stroke={c.glow} strokeWidth="3" strokeLinecap="round" />
        </g>
      ) : (
        <g>
          <Halo x={60} y={37} r={14} u={d.u} o={mood === 'hurt' ? 0.4 : 1} />
          <rect x="40" y="35.4" width="34" height="3.4" rx="1.7" fill={c.glow} opacity={mood === 'hurt' ? 0.5 : 0.85} />
          <rect x={mood === 'fierce' ? 60 : 58} y={mood === 'fierce' ? 34.6 : 34} width={mood === 'hurt' ? 4 : 8} height={mood === 'fierce' ? 5 : 6} rx="2" fill="#ffffff" />
        </g>
      )}
      <path d="M38 50H70V56C70 58 68 60 66 60H42C40 60 38 58 38 56Z" fill={c.accent} {...thin} />
      <path d="M74 26L80 20L82 50L76 50Z" fill={c.extra} {...thin} />
      <MoodMarks d={d} x={88} y={12} />
    </g>
  )
}

function Kraka(d: Draw) {
  const { c, mood } = d
  const lit = burn(mood)
  return (
    <g>
      {/* tentacles curling up at the bottom */}
      <path d="M-4 104C2 92 0 82 8 78C14 76 18 80 16 86C14 90 10 90 10 86" fill="none" stroke={INK} strokeWidth="11" strokeLinecap="round" />
      <path d="M-4 104C2 92 0 82 8 78C14 76 18 80 16 86C14 90 10 90 10 86" fill="none" stroke={c.body} strokeWidth="6.5" strokeLinecap="round" />
      <path d="M18 104C22 92 30 86 38 88" fill="none" stroke={INK} strokeWidth="13" strokeLinecap="round" />
      <path d="M18 104C22 92 30 86 38 88" fill="none" stroke={c.dark} strokeWidth="8.5" strokeLinecap="round" />
      {/* the mantle, tilted back, and the head */}
      <path d="M22 70C14 52 14 30 24 16C32 4 46 2 54 10C62 18 64 34 66 48L80 54C90 58 94 66 92 76C88 86 74 92 58 92C40 92 28 84 22 70Z" fill={c.body} {...ink} />
      <path d="M28 64C22 48 22 30 30 18" fill="none" stroke={c.dark} strokeWidth="6" strokeLinecap="round" opacity=".5" />
      <path d="M40 88C52 92 70 90 82 82" fill="none" stroke={c.accent} strokeWidth="5" strokeLinecap="round" />
      {/* the glowing spots */}
      <g opacity={lit}>
        {[
          [36, 22, 2.6],
          [46, 14, 2],
          [30, 40, 2.4],
          [44, 34, 2],
          [52, 46, 2.2],
          [70, 80, 2],
        ].map(([x, y, r], i) => (
          <g key={i}>
            <Halo x={x} y={y} r={r * 3} u={d.u} />
            <circle cx={x} cy={y} r={r} fill={c.glow} />
          </g>
        ))}
      </g>
      {/* the huge eye, pale with a glowing iris and a bar pupil */}
      <path d="M58 52C64 44 80 46 84 58" fill="none" stroke={c.dark} strokeWidth="5" strokeLinecap="round" />
      {mood === 'ko' || mood === 'hurt' || mood === 'win' ? (
        <g>
          <ellipse cx="72" cy="62" rx="10" ry="9" fill="#f6ecd0" {...thin} />
          <Eye x={72} y={62} w={5.5} h={4} d={d} />
        </g>
      ) : (
        <g>
          <ellipse cx="72" cy="62" rx="10" ry={mood === 'fierce' ? 7.5 : 9} fill="#f6ecd0" {...thin} />
          <Halo x={73} y={62} r={12} u={d.u} />
          <circle cx="73" cy="62" r="6" fill={c.glow} />
          <rect x="68" y="60.6" width="10" height="2.8" rx="1.4" fill={INK} />
          <circle cx="69.5" cy="58.5" r="1.5" fill="#ffffff" />
          {mood === 'fierce' && <path d="M60 54L84 58L84 52L60 50Z" fill={c.body} />}
        </g>
      )}
      {/* the beak */}
      <path d={`M84 76L94 ${80 + open(mood) * 4}L84 ${84 + open(mood) * 3}Z`} fill="#2a1630" {...thin} />
      {/* a striking tentacle raised in front */}
      <path d="M96 104C92 90 98 80 92 70" fill="none" stroke={INK} strokeWidth="12" strokeLinecap="round" />
      <path d="M96 104C92 90 98 80 92 70" fill="none" stroke={c.body} strokeWidth="7.5" strokeLinecap="round" />
      <path d="M93 98l3 -1M93 90l3 -1M94 82l3 -1" stroke={c.accent} strokeWidth="2" strokeLinecap="round" />
      <MoodMarks d={d} x={44} y={2} />
    </g>
  )
}

function Lumina(d: Draw) {
  const { c, mood } = d
  const lit = burn(mood)
  const wing = (s: 1 | -1) => (
    <g transform={s < 0 ? 'translate(100 0) scale(-1 1)' : undefined}>
      <path d="M44 56C34 40 18 28 4 26C-4 26 -6 34 -4 44C0 58 14 66 30 66Z" fill={c.body} {...ink} />
      <path d="M8 28C0 30 -2 38 0 46C2 40 6 34 12 30Z" fill={c.extra} />
      <path d="M40 58C30 50 22 44 12 40" fill="none" stroke={c.extra} strokeWidth="1.4" />
      <g opacity={lit}>
        <Halo x={18} y={44} r={14} u={d.u} />
        <circle cx="18" cy="44" r="7.6" fill={c.extra} />
        <circle cx="18" cy="44" r="5.6" fill={c.glow} />
        <circle cx="18" cy="44" r="3" fill="#2a1a0c" />
        <circle cx="16.8" cy="42.8" r="1.1" fill="#ffffff" />
      </g>
    </g>
  )
  return (
    <g>
      {wing(1)}
      {wing(-1)}
      {/* the fuzzy body and its ruff */}
      <path d="M24 104C24 86 34 74 50 74C66 74 76 86 76 104Z" fill={c.body} {...ink} />
      <path d="M38 104C38 92 44 84 50 84C56 84 62 92 62 104Z" fill={c.accent} />
      {[26, 34, 42, 50, 58, 66, 74].map((x, i) => (
        <circle key={i} cx={x} cy={72 + (i % 2) * 3} r="6.4" fill={i % 2 ? c.light : c.accent} {...thin} />
      ))}
      {/* the antennae: feathery combs */}
      {[1, -1].map((s) => (
        <g key={s} transform={s < 0 ? 'translate(100 0) scale(-1 1)' : undefined}>
          <path d="M42 30C38 20 32 12 24 8" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M${39 - i * 3.4} ${24 - i * 3.6}l-4 -1.5M${39 - i * 3.4} ${24 - i * 3.6}l1 -4.2`} stroke={c.accent} strokeWidth="1.8" strokeLinecap="round" />
          ))}
          <g opacity={lit}>
            <Halo x={24} y={8} r={6} u={d.u} />
            <circle cx="24" cy="8" r="2.2" fill={c.glow} />
          </g>
        </g>
      ))}
      {/* the round fuzzy head and the huge compound eyes */}
      <circle cx="50" cy="48" r="20" fill={c.body} {...ink} />
      <path d="M34 40C36 32 42 28 50 28" fill="none" stroke={c.light} strokeWidth="3" strokeLinecap="round" opacity=".5" />
      {[1, -1].map((s) => {
        const x = 50 + s * 10
        if (mood === 'ko')
          return <path key={s} d={`M${x - 5} 42L${x + 5} 52M${x + 5} 42L${x - 5} 52`} {...ink} fill="none" />
        if (mood === 'win') return <path key={s} d={`M${x - 6} 49Q${x} 40 ${x + 6} 49`} fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
        return (
          <g key={s}>
            <ellipse cx={x} cy="47" rx="8" ry={mood === 'hurt' && s > 0 ? 2 : 9.5} fill="#1c1230" {...thin} />
            {!(mood === 'hurt' && s > 0) && <circle cx={x - 2.5} cy="43" r="2.4" fill="#ffffff" />}
            {!(mood === 'hurt' && s > 0) && <circle cx={x + 2.5} cy="51" r="1.3" fill={c.glow} />}
            {mood === 'fierce' && <path d={`M${x - 9} ${38 + (s > 0 ? 4 : 0)}L${x + 9} ${38 + (s > 0 ? 0 : 4)}L${x + 9} 34L${x - 9} 34Z`} fill={c.body} />}
          </g>
        )
      })}
      <path d={`M46 ${60 + open(mood) * 0.5}Q50 ${62 + open(mood) * 4} 54 ${60 + open(mood) * 0.5}`} fill={open(mood) > 0.2 ? '#5a2a1a' : 'none'} stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
      <MoodMarks d={d} x={50} y={16} />
    </g>
  )
}

function Pincer(d: Draw) {
  const { c, mood } = d
  const lit = burn(mood)
  const o = open(mood)
  return (
    <g>
      {/* the big claw raised at the right, open in a fight, shut when calm */}
      <path d="M70 104L74 80L84 66" fill="none" stroke={INK} strokeWidth="13" strokeLinecap="round" />
      <path d="M70 104L74 80L84 66" fill="none" stroke={c.body} strokeWidth="8.5" strokeLinecap="round" />
      <path d="M76 70C70 56 74 40 86 34C96 30 104 38 102 50C100 60 92 68 84 72Z" fill={c.body} {...ink} />
      <path d="M80 66C78 56 82 46 90 42" fill="none" stroke={c.accent} strokeWidth="4" strokeLinecap="round" />
      <g transform={`rotate(${-10 - o * 22} 88 36)`}>
        <path d="M86 36C84 24 88 12 96 6C98 14 98 26 94 36Z" fill={c.body} {...ink} />
        <path d="M94 8L97 2L98 10Z" fill={c.extra} {...thin} strokeWidth={1} />
      </g>
      <path d="M90 32L94 22L96 30M84 42L80 34L86 38" fill={c.dark} {...thin} strokeWidth={1.1} />
      {/* the carapace: spiked rim, pale underside */}
      <path d="M-6 104C-6 84 10 70 34 66C48 64 62 66 72 72C80 78 84 88 84 104Z" fill={c.body} {...ink} />
      {[
        [4, 78, -50],
        [14, 70, -35],
        [26, 65, -15],
        [62, 66, 20],
        [74, 72, 40],
      ].map(([x, y, r], i) => (
        <path key={i} transform={`translate(${x} ${y}) rotate(${r})`} d="M-3.4 2L0 -7L3.4 2Z" fill={c.dark} {...thin} />
      ))}
      <path d="M8 104C12 94 24 88 38 88C52 88 64 94 68 104Z" fill={c.accent} {...thin} />
      <g opacity={lit}>
        <Halo x={38} y={74} r={8} u={d.u} />
        <circle cx="38" cy="74" r="2.4" fill={c.glow} />
      </g>
      {/* the mandibles and the glowing mouth */}
      <g opacity={lit}>
        <Halo x={46} y={90} r={10} u={d.u} o={0.6} />
      </g>
      <path d={`M38 88Q46 ${92 + o * 5} 54 88`} fill={c.glow} opacity={lit} {...thin} />
      <path d="M36 86L42 92L36 94ZM56 86L50 92L56 94Z" fill={c.extra} {...thin} strokeWidth={1.1} />
      {/* the eye stalks with glowing tips */}
      {[
        [32, 1],
        [52, -1],
      ].map(([x, s]) => (
        <g key={x}>
          <path d={`M${x} 70L${x + s * 2} 40`} stroke={INK} strokeWidth="6" strokeLinecap="round" />
          <path d={`M${x} 70L${x + s * 2} 40`} stroke={c.body} strokeWidth="3" strokeLinecap="round" />
          <circle cx={x + s * 2} cy="36" r="8" fill={c.accent} {...thin} />
          <Eye x={x + s * 2 + 1.5} y={36} w={4.6} h={4.6} rot={0} d={d} pupil="slit" />
        </g>
      ))}
      <MoodMarks d={d} x={42} y={16} />
    </g>
  )
}

function Bedrock(d: Draw) {
  const { c, mood } = d
  const lit = burn(mood)
  const o = open(mood)
  return (
    <g>
      {/* boulder shoulders with lava cracks */}
      <path d="M-6 104L-4 72L10 60L30 58L38 70L36 104Z" fill={c.accent} {...ink} />
      <path d="M106 104L104 72L90 60L70 58L62 70L64 104Z" fill={c.body} {...ink} />
      <path d="M26 104L28 74L40 66L62 66L72 76L74 104Z" fill={c.body} {...ink} />
      <path d="M-4 72L10 60L18 68L8 76Z" fill={c.light} opacity=".35" />
      <g opacity={lit}>
        <Halo x={50} y={88} r={20} u={d.u} o={0.7} />
        <path d="M40 72L46 80L42 88L50 96L46 104" fill="none" stroke={c.glow} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M64 70L58 80L64 88L58 98" fill="none" stroke={c.glow} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M14 66L20 76L14 86" fill="none" stroke={c.glow} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {/* moss on the shoulders */}
      {[
        [8, 60],
        [90, 60],
      ].map(([x, y], i) => (
        <g key={i} {...thin} strokeWidth={1.2}>
          <ellipse cx={x - 4} cy={y} rx="6" ry="4" fill={c.extra} />
          <ellipse cx={x + 4} cy={y - 1} rx="5" ry="3.6" fill="#8cc45a" />
        </g>
      ))}
      {/* the rock of a head: facets, a brow ledge, eye slits and a crack of a mouth */}
      <path d="M30 56L28 34L40 20L62 18L74 30L74 52L62 62L40 62Z" fill={c.body} {...ink} />
      <path d="M40 20L62 18L74 30L56 30Z" fill={c.light} opacity=".35" />
      <path d="M28 34L40 20L44 32L30 44Z" fill={c.dark} opacity=".45" />
      <path d="M26 36L76 32L74 40L28 42Z" fill={c.accent} {...thin} />
      {mood === 'ko' ? (
        <path d="M38 44L44 50M44 44L38 50M58 44L64 50M64 44L58 50" {...ink} />
      ) : mood === 'win' ? (
        <g opacity={lit}>
          <Halo x={51} y={47} r={16} u={d.u} />
          <path d="M36 50Q41 43 46 50M56 50Q61 43 66 50" fill="none" stroke={c.glow} strokeWidth="3" strokeLinecap="round" />
        </g>
      ) : (
        <g opacity={lit}>
          <Halo x={51} y={47} r={16} u={d.u} />
          <path d={mood === 'hurt' ? 'M36 47H46' : 'M35 44L47 45L46 49L36 48Z'} fill={c.glow} stroke={c.glow} strokeWidth={mood === 'hurt' ? 2.4 : 0.6} strokeLinecap="round" />
          <path d="M56 45L68 44L67 48L57 49Z" fill={c.glow} stroke={c.glow} strokeWidth="0.6" />
        </g>
      )}
      <g opacity={lit}>
        <path d={`M38 55L44 ${56 + o * 4}L50 54L56 ${57 + o * 4}L64 54`} fill="none" stroke={c.glow} strokeWidth={2 + o * 2} strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {/* moss on the head */}
      <g {...thin} strokeWidth={1.2}>
        <ellipse cx="46" cy="20" rx="7" ry="4" fill={c.extra} />
        <ellipse cx="55" cy="18.5" rx="5.5" ry="3.6" fill="#8cc45a" />
      </g>
      <MoodMarks d={d} x={82} y={12} />
    </g>
  )
}

function Voltra(d: Draw) {
  const { c, mood } = d
  const o = open(mood)
  const lit = burn(mood)
  return (
    <g>
      {/* the neck rising out of the frame, sail fins down its back, the glowing line and the pale belly */}
      <path d="M8 26L16 34L10 40L20 46L12 54L22 60L14 68L24 74" fill={c.extra} {...ink} />
      <path d="M14 104C14 80 20 60 34 46L56 46C46 60 44 80 48 104Z" fill={c.body} {...ink} />
      <path d="M38 104C36 84 40 66 50 54" fill="none" stroke={c.accent} strokeWidth="7" strokeLinecap="round" />
      <g opacity={lit}>
        <Halo x={26} y={74} r={22} u={d.u} o={0.8} />
        <path d="M22 104C22 82 26 66 36 54" fill="none" stroke={c.glow} strokeWidth="2.6" strokeLinecap="round" strokeDasharray="7 3" />
      </g>
      {/* the horns, swept back */}
      <path d="M40 28C32 20 22 16 10 16C20 20 28 26 34 34Z" fill={c.light} {...ink} />
      <path d="M44 22C38 12 30 6 20 4C28 10 34 18 38 28Z" fill={c.light} {...ink} />
      {/* the head: skull and long snout to the right, the jaw dropped by the mood */}
      <g transform={`rotate(${o * 20} 54 50)`}>
        {o > 0.1 && <path d="M56 50L90 50L84 56L56 56Z" fill="#0a1a2a" />}
        <path d="M44 52L90 52C90 57 86 60 80 61L50 62Z" fill={c.accent} {...ink} />
        <path d="M62 52l1.4 -3l1.4 3M70 52l1.4 -3l1.4 3M78 52l1.4 -3l1.4 3" fill={c.light} {...thin} strokeWidth={0.8} />
      </g>
      <path d="M34 48C32 36 40 26 54 26C64 26 72 30 80 34C88 38 94 42 94 47C94 50 92 52 88 52L46 54Z" fill={c.body} {...ink} />
      <path d="M62 52l1.4 3l1.4 -3M70 52l1.4 3l1.4 -3M78 51.6l1.4 3l1.4 -3M85 51l1.2 2.6l1.2 -2.6" fill={c.light} {...thin} strokeWidth={0.8} />
      {/* the cheek frill */}
      <path d="M40 46L28 40L30 48L22 50L32 56L40 54Z" fill={c.extra} {...thin} />
      {/* the brow and the glowing eye, a glowing streak on the crown */}
      <path d="M52 34C58 30 66 30 72 33L70 37C64 35 58 36 54 39Z" fill={c.dark} {...thin} />
      <Eye x={64} y={39} w={4.4} h={2.8} rot={-8} d={d} brow={c.dark} />
      <g opacity={lit}>
        <Halo x={48} y={28} r={8} u={d.u} />
        <path d="M42 30Q50 26 58 28" fill="none" stroke={c.glow} strokeWidth="2.2" strokeLinecap="round" />
      </g>
      <ellipse cx="88" cy="43" rx="1.6" ry="1.1" fill={c.dark} />
      <MoodMarks d={d} x={76} y={14} />
    </g>
  )
}

const DRAW: Record<KaijuId, (d: Draw) => ReactNode> = { rexor: Rexor, gorrath: Gorrath, titan: Titan, kraka: Kraka, lumina: Lumina, pincer: Pincer, bedrock: Bedrock, voltra: Voltra }

export function KaijuPortrait({ id, size = 64, mirror = false, mood = 'calm', bg = false, className = '', title }: { id: KaijuId; size?: number; mirror?: boolean; mood?: Mood; bg?: boolean; className?: string; title?: string }) {
  const u = useUid() + 'kp'
  const c = COLORS[id]
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={`${u}halo`}>
          <stop offset="0" stopColor={c.glow} stopOpacity=".75" />
          <stop offset=".45" stopColor={c.glow} stopOpacity=".28" />
          <stop offset="1" stopColor={c.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}bg`} cx=".5" cy=".38" r=".75">
          <stop offset="0" stopColor={c.glow} stopOpacity=".42" />
          <stop offset=".55" stopColor={c.dark} stopOpacity=".55" />
          <stop offset="1" stopColor="#0a1620" />
        </radialGradient>
        <clipPath id={`${u}clip`}>
          <rect width="100" height="100" rx={bg ? 22 : 0} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${u}clip)`}>
        {bg && <rect width="100" height="100" fill={`url(#${u}bg)`} />}
        <g transform={mirror ? 'translate(100 0) scale(-1 1)' : undefined}>{DRAW[id]({ c, mood, u })}</g>
      </g>
      {bg && <rect x="1" y="1" width="98" height="98" rx="21" fill="none" stroke={c.glow} strokeOpacity=".35" strokeWidth="2" />}
    </svg>
  )
}
