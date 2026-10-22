import { useRef, type CSSProperties, type ReactNode } from 'react'
import { Avatar } from './Avatar'
import { Aura, AuraLayer, hasAura } from './auras'
import { FX_BACK, FX_FRAMES, FX_UNDER } from './fx-frames'
import { useOffscreenPause } from './fx-kit'
import { NAME_FX } from './fx-names'
import { useUid } from './ids'
import { SuitShape } from './suits'
import { GameIcon } from '../components/GameIcon'
import { shade } from '../lib/pixel'
import { TIERS } from '../store/levels'
import { gameInfo, type GameId } from '../store/games'
import { achievement, cosmetic, type Rarity } from '../store/cosmetics'
import { FX_BANNER_ART, FX_BANNER_BG } from './fx-banners'
import { Backdrop } from './backdrops'

/*
  How cosmetics look (src/store/cosmetics.ts has what they are and who may wear them).

  - FramedAvatar: an avatar inside one of the twenty-six frames (the twelve animated ones are in fx-frames.tsx), with
    an optional aura round it (auras.tsx). The avatar takes the middle 78% of the box and the frame is drawn round it
    in one SVG on a 100-unit grid, so it scales from a 20 px list row to a 160 px profile header. Below 36 px the fine
    detail (ticks, letters, sparkles) and the animation are left out, the animated frames only move from 56 px up, and
    auras start at 44 px, so long lists stay cheap; anything animated pauses while it is offscreen.
  - ProfileBanner: twenty-two scenes drawn in SVG on an 800 x 240 grid (the ten animated ones are in fx-banners.tsx),
    cropped to fill whatever box they are given (xMidYMid slice). The scene sits under the banner's children (a
    stacking context of its own), so a caller lays its content out in the banner like in any div.
  - NameTag: the eighteen name styles (the nine animated ones are in fx-names.ts). Every one has a dark drop shadow, so
    a name stays readable on any banner.
  - TitleChip: a title as a small plate, coloured by rarity (common grey, rare blue, epic purple, legendary gold, and
    the Mythic signature: a drifting rainbow with sparkles).
  - BadgeIcon: an achievement's medal. Its outline and rim say the rarity (a reeded disc, a hexagon, a seal, a
    sunburst with ribbons); the emblem in the middle says what it is for: a milestone's icon, a VIP tier's shield or,
    for a challenge, its game's icon on the game's colour. `locked` greys it out with a padlock.
  - CosmeticPreview: any cosmetic as a square picture, for the shop and the wardrobe (a backdrop as its scene behind
    a little profile card, still below 48 px; the scenes themselves are backdrops.tsx).

  The animations (flames, neon buzz, the hologram turning, fire and rainbow names, twinkles) are CSS keyframes in one
  style sheet added once to the page below; they move only transform and opacity (and a background position for the
  animated names), and stop when the player asks for reduced motion. The animated frames, auras, names and plates
  bring their own sheets (fx-kit.tsx explains the shared rules); for reduced motion they pause where they stand.
*/

/* ---------------- shared ---------------- */

/** what each rarity looks like */
export const RARITY: Record<Rarity, { name: string; color: string; light: string; dark: string }> = {
  common: { name: 'Common', color: '#9aa9ba', light: '#e3eaf1', dark: '#4c5a6b' },
  rare: { name: 'Rare', color: '#4c9dff', light: '#a8d1ff', dark: '#1b4ea6' },
  epic: { name: 'Epic', color: '#b06bff', light: '#dcc2ff', dark: '#5a22a6' },
  legendary: { name: 'Legendary', color: '#f7c548', light: '#fff0b0', dark: '#a86c0c' },
  mythic: { name: 'Mythic', color: '#ff4fd8', light: '#ffd3f6', dark: '#7d1a8f' },
}

const CSS = `
@keyframes bjc-pan{to{background-position:-200% 0}}
.bjc-pan{background-size:200% 100%!important;animation:bjc-pan 2.6s linear infinite}
@keyframes bjc-spin{to{transform:rotate(360deg)}}
.bjc-spin{animation:bjc-spin 6s linear infinite}
@keyframes bjc-flick{0%,100%{transform:scale(1,1)}35%{transform:scale(1.08,.74)}65%{transform:scale(.94,1.12)}}
.bjc-flick{transform-box:fill-box;transform-origin:50% 100%;animation:bjc-flick .9s ease-in-out infinite}
@keyframes bjc-tw{0%,100%{opacity:.1;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}
.bjc-tw{transform-box:fill-box;transform-origin:center;animation:bjc-tw 2.8s ease-in-out infinite}
@keyframes bjc-buzz{0%,86%,100%{opacity:1}88%{opacity:.4}90%{opacity:.95}93%{opacity:.55}95%{opacity:1}}
.bjc-buzz{animation:bjc-buzz 4.5s linear infinite}
@keyframes bjc-sheen{0%{transform:translateX(-140px)}55%,100%{transform:translateX(160px)}}
.bjc-sheen{animation:bjc-sheen 3.4s ease-in-out infinite}
@keyframes bjc-glint{0%{transform:translateX(-120%) skewX(-20deg)}55%,100%{transform:translateX(320%) skewX(-20deg)}}
.bjc-glint{animation:bjc-glint 3.6s ease-in-out infinite}
@keyframes bjc-wave{0%,100%{transform:translateX(0) scaleY(1)}50%{transform:translateX(-24px) scaleY(1.14)}}
.bjc-wave{transform-box:fill-box;transform-origin:50% 0;animation:bjc-wave 9s ease-in-out infinite}
@keyframes bjc-blink{0%,49%{opacity:1}50%,100%{opacity:.22}}
.bjc-blink{animation:bjc-blink 1.1s steps(1) infinite}
@keyframes bjc-rise{0%{transform:translateY(0);opacity:0}15%{opacity:.8}100%{transform:translateY(-170px);opacity:0}}
.bjc-rise{animation:bjc-rise 7s linear infinite}
@keyframes bjc-sway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
.bjc-sway{transform-box:fill-box;transform-origin:50% 100%;animation:bjc-sway 5s ease-in-out infinite}
@keyframes bjc-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.bjc-float{animation:bjc-float 4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.bjc-pan,.bjc-spin,.bjc-flick,.bjc-tw,.bjc-buzz,.bjc-sheen,.bjc-glint,.bjc-wave,.bjc-blink,.bjc-rise,.bjc-sway,.bjc-float{animation:none!important}}
`
if (typeof document !== 'undefined') {
  const el = document.getElementById('bjc-css') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'bjc-css' }))
  el.textContent = CSS
}

/** a point on a circle round (cx, cy), angle in degrees (0 is right, 90 is down) */
const at = (r: number, deg: number, cx = 50, cy = 50) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)] as const
const P = (r: number, deg: number, cx?: number, cy?: number) => at(r, deg, cx, cy).map((v) => v.toFixed(2)).join(' ')
/** a star with `n` points between radii r1 (points) and r2 (dips) */
const starPath = (n: number, r1: number, r2: number, cx: number, cy: number, rot = -90) =>
  Array.from({ length: n * 2 }, (_, i) => `${i ? 'L' : 'M'}${P(i % 2 ? r2 : r1, rot + (i * 180) / n, cx, cy)}`).join('') + 'Z'
/** a four-pointed sparkle at (x, y) */
const sparkle = (x: number, y: number, s: number) => `M${x} ${y - s}Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y}Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s}Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y}Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}Z`
/** an annulus sector between radii r0 and r1, angles a0 to a1 (degrees) */
const sector = (r0: number, r1: number, a0: number, a1: number) => `M${P(r0, a0)}L${P(r1, a0)}A${r1} ${r1} 0 0 1 ${P(r1, a1)}L${P(r0, a1)}A${r0} ${r0} 0 0 0 ${P(r0, a0)}Z`
/** a small deterministic random sequence (the same scene every time) */
function seq(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/* ---------------- frames ---------------- */

type Metal = readonly [string, string, string, string]
const BRONZE: Metal = ['#ffd9b2', '#d58c50', '#7a4320', '#eaa86f']
const SILVER: Metal = ['#ffffff', '#cfd9e3', '#6b7b8c', '#e6edf4']
const GOLD: Metal = ['#fff6c8', '#f7c548', '#9a600a', '#ffe28f']
const PLATINUM: Metal = ['#ffffff', '#c6f2ff', '#58879f', '#e8fbff']

function grad(id: string, m: Metal, flip = false) {
  return (
    <linearGradient id={id} x1="0" y1={flip ? 1 : 0} x2=".35" y2={flip ? 0 : 1}>
      <stop offset="0" stopColor={m[0]} />
      <stop offset=".45" stopColor={m[1]} />
      <stop offset=".8" stopColor={m[2]} />
      <stop offset="1" stopColor={m[3]} />
    </linearGradient>
  )
}

/** a bevelled metal band from r 38.8 to 49.2: the band, a chamfer on its inner edge lit from below, and fine lines */
function metalRing(u: string, m: Metal, reeded: boolean) {
  return (
    <>
      <defs>
        {grad(`${u}m`, m)}
        {grad(`${u}n`, m, true)}
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}m)`} strokeWidth="10.4" />
      <circle cx="50" cy="50" r="40.3" fill="none" stroke={`url(#${u}n)`} strokeWidth="2.8" />
      {reeded && <circle cx="50" cy="50" r="47.4" fill="none" stroke="#000" strokeOpacity=".2" strokeWidth="2.2" strokeDasharray="1.1 1.5" />}
      <circle cx="50" cy="50" r="48.7" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".9" />
      <circle cx="50" cy="50" r="49.5" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth=".7" />
      <circle cx="50" cy="50" r="38.9" fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="1.1" />
    </>
  )
}

/** a cut gem: a rotated square with a lit top facet */
function gem(key: string, x: number, y: number, r: number, light: string, dark: string) {
  return (
    <g key={key}>
      <path d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`} fill={dark} stroke="#000" strokeOpacity=".35" strokeWidth=".5" />
      <path d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r * 0.1}L${x - r} ${y}Z`} fill={light} />
      <path d={`M${x - r * 0.35} ${y - r * 0.35}L${x} ${y - r * 0.75}`} stroke="#fff" strokeOpacity=".9" strokeWidth={r * 0.22} strokeLinecap="round" />
    </g>
  )
}

const DIAMOND_FACETS = Array.from({ length: 16 }, (_, i) => {
  const a0 = (i / 16) * 360 - 90
  const a1 = ((i + 1) / 16) * 360 - 90
  return { a: `M${P(38.6, a0)}L${P(49.4, a0)}L${P(49.4, a1)}Z`, b: `M${P(38.6, a0)}L${P(49.4, a1)}L${P(38.6, a1)}Z` }
})
const DIAMOND_LIGHT = ['#ffffff', '#efe6ff', '#d4f6ff', '#f6f0ff']
const DIAMOND_DARK = ['#a782ff', '#6fd2ff', '#c2a6ff', '#86b8ff']

/** the pixel frame: a ring of 5-unit squares on a 20 x 20 grid, lit top left, shaded bottom right, with an outline */
const PIXEL = (() => {
  const o = { lit: '', base: '', dark: '', line: '', stud: '' }
  const studs = new Set(['9,1', '10,1', '18,9', '18,10', '9,18', '10,18', '1,9', '1,10'])
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const d = Math.hypot(x + 0.5 - 10, y + 0.5 - 10)
      const cell = `M${x * 5} ${y * 5}h5v5h-5z`
      if (d >= 9.55 && d < 10.35) o.line += cell
      else if (d >= 7.45 && d < 9.55) {
        if (studs.has(`${x},${y}`)) o.stud += cell
        else if (d >= 8.75 && x + y < 19) o.lit += cell
        else if (d < 8.3 && x + y > 19) o.dark += cell
        else o.base += cell
      }
    }
  return o
})()

/** a flame tongue standing on the ring (base at r 40, tip just past the box), drawn pointing up at the top */
const TONGUE_BACK = 'M43 10C42 4 47 .5 50 -5 53 .5 58 4 57 10Z'
const TONGUE_FRONT = 'M45 10.5C44.4 6 48 2.8 50 -1.4 52 2.8 55.6 6 55 10.5Z'

const LAUREL = Array.from({ length: 9 }, (_, k) => {
  const deg = 112 + k * 17
  const outer = k % 2 === 0
  const [x, y] = at(outer ? 47.2 : 44.4, deg)
  return { x, y, rot: deg + (outer ? 24 : -18), s: 1 - k * 0.035 }
})

const CHIP_INLAYS = Array.from({ length: 8 }, (_, i) => sector(39.3, 48.7, i * 45 - 8, i * 45 + 8))

const FRAME_ART: Record<string, (u: string, px: number) => ReactNode> = {
  'frame:bronze': (u) => (
    <>
      {metalRing(u, BRONZE, false)}
      {[45, 135, 225, 315].map((a) => {
        const [x, y] = at(44, a)
        return <circle key={a} cx={x} cy={y} r="1.7" fill="#ffe2c4" stroke="#6b3a1a" strokeWidth=".7" />
      })}
    </>
  ),
  'frame:silver': (u, px) => (
    <>
      {metalRing(u, SILVER, px >= 36)}
      {[0, 90, 180, 270].map((a) => {
        const [x, y] = at(44, a)
        return <path key={a} d={sparkle(x, y, 2.6)} fill="#fff" />
      })}
    </>
  ),
  'frame:gold': (u, px) => (
    <>
      {metalRing(u, GOLD, px >= 36)}
      {[270, 0, 90, 180].map((a, i) => {
        const [x, y] = at(44, a)
        return i % 2 ? gem(`g${a}`, x, y, 3.4, '#9dffcf', '#0f9a5a') : gem(`g${a}`, x, y, 3.8, '#ffb3bf', '#c2132f')
      })}
    </>
  ),
  'frame:platinum': (u, px) => (
    <>
      {metalRing(u, PLATINUM, false)}
      {px >= 36 &&
        Array.from({ length: 24 }, (_, i) => {
          const a = i * 15
          return <path key={a} d={`M${P(39.6, a)}L${P(48.4, a)}`} stroke={i % 2 ? '#fff' : '#2f5b70'} strokeOpacity={i % 2 ? 0.55 : 0.28} strokeWidth=".7" />
        })}
      {gem('top', 50, 6, 5.2, '#ffffff', '#7fd8ff')}
      {gem('l', 7.6, 50, 2.8, '#ffffff', '#7fd8ff')}
      {gem('r', 92.4, 50, 2.8, '#ffffff', '#7fd8ff')}
    </>
  ),
  'frame:diamond': (u, px) => (
    <>
      {DIAMOND_FACETS.map((f, i) => (
        <g key={i}>
          <path d={f.a} fill={DIAMOND_LIGHT[i % 4]} />
          <path d={f.b} fill={DIAMOND_DARK[i % 4]} />
        </g>
      ))}
      <circle cx="50" cy="50" r="49.4" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth=".9" />
      <circle cx="50" cy="50" r="38.8" fill="none" stroke="#2a1660" strokeOpacity=".6" strokeWidth="1.2" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}d)`} strokeWidth="10.6" />
      <defs>
        <linearGradient id={`${u}d`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#5b2fd6" stopOpacity=".35" />
        </linearGradient>
      </defs>
      {px >= 36 &&
        [
          [82, 14, 4.6, 0],
          [9, 34, 3.4, 0.9],
          [70, 94, 3.8, 1.7],
        ].map(([x, y, s, d]) => <path key={x} className="bjc-tw" style={{ animationDelay: `${d}s` }} d={sparkle(x, y, s)} fill="#fff" />)}
    </>
  ),
  'frame:neon': (_u, px) => (
    <>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#ff3fd0" strokeOpacity=".16" strokeWidth="15" />
      <circle cx="50" cy="50" r="44" fill="none" stroke="#120720" strokeWidth="9" />
      <g className={px >= 36 ? 'bjc-buzz' : undefined}>
        <circle cx="50" cy="50" r="44" fill="none" stroke="#ff3fd0" strokeOpacity=".5" strokeWidth="6.6" />
        <circle cx="50" cy="50" r="44" fill="none" stroke="#ff80e6" strokeWidth="3.4" />
        <circle cx="50" cy="50" r="44" fill="none" stroke="#fff0fc" strokeWidth="1.3" />
      </g>
      <circle cx="50" cy="50" r="39.5" fill="none" stroke="#36e6ff" strokeOpacity=".45" strokeWidth="2.8" />
      <circle cx="50" cy="50" r="39.5" fill="none" stroke="#d6fcff" strokeWidth=".8" />
      {[45, 135, 225, 315].map((a) => (
        <rect key={a} x="47.4" y="1.4" width="5.2" height="8.4" rx="1.2" fill="#2b2140" stroke="#5a4a78" strokeWidth=".6" transform={`rotate(${a + 90} 50 50)`} />
      ))}
    </>
  ),
  'frame:pixel': () => (
    <g shapeRendering="crispEdges">
      <path d={PIXEL.line} fill="#1a0b2e" />
      <path d={PIXEL.base} fill="#ff4fb8" />
      <path d={PIXEL.lit} fill="#ffa8dc" />
      <path d={PIXEL.dark} fill="#a91d72" />
      <path d={PIXEL.stud} fill="#ffe14d" />
    </g>
  ),
  'frame:flame': (u, px) => {
    const n = px >= 36 ? 14 : 10
    return (
      <>
        <defs>
          <linearGradient id={`${u}f`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#fff4b0" />
            <stop offset=".35" stopColor="#ffb22e" />
            <stop offset=".75" stopColor="#ff4a1c" />
            <stop offset="1" stopColor="#ff2a1c" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${u}g`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff8a1f" />
            <stop offset=".6" stopColor="#e0241b" />
            <stop offset="1" stopColor="#a8101b" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${u}r`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe27a" />
            <stop offset=".5" stopColor="#ff8a1f" />
            <stop offset="1" stopColor="#d6301a" />
          </linearGradient>
        </defs>
        {Array.from({ length: n }, (_, i) => (
          <g key={`b${i}`} transform={`rotate(${((i + 0.5) / n) * 360} 50 50)`}>
            <path className={px >= 36 ? 'bjc-flick' : undefined} style={{ animationDelay: `${-i * 0.17}s`, animationDuration: `${0.8 + (i % 3) * 0.15}s` }} d={TONGUE_BACK} fill={`url(#${u}g)`} />
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <g key={`f${i}`} transform={`rotate(${(i / n) * 360} 50 50)`}>
            <path className={px >= 36 ? 'bjc-flick' : undefined} style={{ animationDelay: `${-i * 0.23}s` }} d={TONGUE_FRONT} fill={`url(#${u}f)`} />
          </g>
        ))}
        <circle cx="50" cy="50" r="41.4" fill="none" stroke={`url(#${u}r)`} strokeWidth="5.6" />
        <circle cx="50" cy="50" r="44.2" fill="none" stroke="#fff3b0" strokeOpacity=".7" strokeWidth=".8" />
        <circle cx="50" cy="50" r="38.9" fill="none" stroke="#5a0a05" strokeOpacity=".55" strokeWidth="1.2" />
      </>
    )
  },
  'frame:laurel': (u, px) => (
    <>
      <defs>
        <linearGradient id={`${u}l`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e2ffa8" />
          <stop offset=".5" stopColor="#74cf3e" />
          <stop offset="1" stopColor="#2c7a20" />
        </linearGradient>
        {grad(`${u}m`, GOLD)}
        <linearGradient id={`${u}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b7f" />
          <stop offset="1" stopColor="#a8102a" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="41" fill="none" stroke={`url(#${u}m)`} strokeWidth="4.4" />
      <circle cx="50" cy="50" r="38.9" fill="none" stroke="#000" strokeOpacity=".45" strokeWidth="1" />
      <circle cx="50" cy="50" r="43.2" fill="none" stroke="#5a3a05" strokeOpacity=".5" strokeWidth=".7" />
      {['', 'matrix(-1 0 0 1 100 0)'].map((t) => (
        <g key={t} transform={t || undefined}>
          <path d={`M${P(45.8, 108)}A45.8 45.8 0 0 1 ${P(45.8, 252)}`} fill="none" stroke="#2c6a1a" strokeWidth="1.3" />
          {LAUREL.map((l, k) => (
            <ellipse key={k} cx={l.x} cy={l.y} rx={2.5 * l.s} ry={6.2 * l.s} transform={`rotate(${l.rot} ${l.x} ${l.y})`} fill={`url(#${u}l)`} stroke="#1f5a14" strokeWidth=".55" />
          ))}
        </g>
      ))}
      {px >= 36 && <path d={starPath(5, 4.2, 1.8, 50, 5.4)} fill="#ffe28f" stroke="#a86c0c" strokeWidth=".6" />}
      <path d="M45.6 89.4 40.4 99.2 44.6 97.8 46.8 100.6 50 91.6Z M54.4 89.4 59.6 99.2 55.4 97.8 53.2 100.6 50 91.6Z" fill={`url(#${u}b)`} />
      <circle cx="50" cy="90.6" r="3.4" fill={`url(#${u}m)`} stroke="#7a4a06" strokeWidth=".6" />
    </>
  ),
  'frame:crown': (u, px) => (
    <>
      {metalRing(u, GOLD, false)}
      {px >= 36 &&
        [22.5, 67.5, 112.5, 157.5, 202.5, 337.5].map((a, i) => {
          const [x, y] = at(44, a)
          return i % 2 ? gem(`c${a}`, x, y, 2.6, '#a8d8ff', '#1f5fd6') : gem(`c${a}`, x, y, 2.6, '#ffb3bf', '#c2132f')
        })}
      <defs>
        <linearGradient id={`${u}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#b47a10" />
        </linearGradient>
      </defs>
      <path d="M28.5 24.5 26.2 7.6 37.6 15 50 2 62.4 15 73.8 7.6 71.5 24.5Z" fill={`url(#${u}c)`} stroke="#7a4a06" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M37.6 15 39 21M62.4 15 61 21M50 2v19" stroke="#8a5a08" strokeOpacity=".35" strokeWidth=".8" />
      <rect x="27.6" y="19.6" width="44.8" height="7" rx="1.8" fill={`url(#${u}m)`} stroke="#6b3f05" strokeWidth=".8" />
      {[
        [26.2, 7.2, 2.7],
        [50, 1.6, 3.1],
        [73.8, 7.2, 2.7],
      ].map(([x, y, r]) => (
        <g key={x}>
          <circle cx={x} cy={y} r={r} fill="#fff1b0" stroke="#8a5a08" strokeWidth=".6" />
          <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.35} fill="#fff" />
        </g>
      ))}
      {gem('cr', 50, 23.1, 2.8, '#ffb3bf', '#c2132f')}
      {gem('cl', 39.4, 23.1, 1.9, '#a8d8ff', '#1f5fd6')}
      {gem('cs', 60.6, 23.1, 1.9, '#a8d8ff', '#1f5fd6')}
    </>
  ),
  'frame:holo': (u, px) => (
    <>
      <defs>
        <linearGradient id={`${u}h`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".7" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity=".3" />
        </linearGradient>
        <clipPath id={`${u}k`}>
          <path d="M1 50a49 49 0 1 0 98 0a49 49 0 1 0-98 0ZM11 50a39 39 0 1 0 78 0a39 39 0 1 0-78 0Z" clipRule="evenodd" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}h)`} strokeWidth="10.4" />
      {px >= 36 && (
        <g clipPath={`url(#${u}k)`}>
          <g transform="rotate(28 50 50)">
            <rect className="bjc-sheen" x="20" y="-30" width="16" height="160" fill="#fff" opacity=".45" />
          </g>
        </g>
      )}
      {px >= 36 &&
        Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${P(39.4, i * 30)}L${P(48.6, i * 30)}`} stroke="#fff" strokeOpacity=".35" strokeWidth=".6" />)}
      <circle cx="50" cy="50" r="49" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth=".9" />
      <circle cx="50" cy="50" r="39" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".8" />
      <circle cx="50" cy="50" r="38.4" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth=".8" />
    </>
  ),
  'frame:explorer': (u, px) => (
    <>
      <defs>
        <linearGradient id={`${u}x`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor="#ffe7a3" />
          <stop offset=".5" stopColor="#c8962e" />
          <stop offset="1" stopColor="#7a5410" />
        </linearGradient>
        <linearGradient id={`${u}y`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#235a62" />
          <stop offset="1" stopColor="#0a1f24" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}y)`} strokeWidth="10.4" />
      <circle cx="50" cy="50" r="48.4" fill="none" stroke={`url(#${u}x)`} strokeWidth="2" />
      <circle cx="50" cy="50" r="39.7" fill="none" stroke={`url(#${u}x)`} strokeWidth="1.8" />
      {px >= 36 &&
        Array.from({ length: 36 }, (_, i) => {
          const major = i % 9 === 0
          if (major && px >= 72) return null
          return <path key={i} d={`M${P(i % 3 === 0 ? 42.6 : 45, i * 10)}L${P(47, i * 10)}`} stroke="#e8c26a" strokeOpacity={i % 3 === 0 ? 0.95 : 0.55} strokeWidth={i % 3 === 0 ? 1.1 : 0.7} />
        })}
      {px >= 72 &&
        (
          [
            ['N', 270],
            ['E', 0],
            ['S', 90],
            ['W', 180],
          ] as const
        ).map(([t, a]) => {
          const [x, y] = at(44, a)
          return (
            <text key={t} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="900" fill={t === 'N' ? '#ff5a5a' : '#f2d48a'} style={{ fontFamily: 'Manrope, sans-serif' }}>
              {t}
            </text>
          )
        })}
      {px < 72 && (
        <>
          <path d="M50 -2.6 53.6 4.6 50 9.4 46.4 4.6Z" fill="#ff4d61" stroke="#6b0d18" strokeWidth=".7" />
          <path d="M50 -2.6 53.6 4.6 50 4.6Z" fill="#ff9aa6" />
        </>
      )}
      {px >= 72 && <path d="M50 -3.4 53 1.4H47Z" fill="#ff4d61" stroke="#6b0d18" strokeWidth=".6" />}
    </>
  ),
  'frame:highroller': (u, px) => (
    <>
      <defs>
        <linearGradient id={`${u}k`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3a46" />
          <stop offset="1" stopColor="#09090d" />
        </linearGradient>
        {grad(`${u}m`, GOLD)}
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}k)`} strokeWidth="10.4" />
      {CHIP_INLAYS.map((d, i) => (
        <path key={i} d={d} fill={`url(#${u}m)`} />
      ))}
      {px >= 36 &&
        Array.from({ length: 8 }, (_, i) => {
          const a = i * 45
          return <path key={a} d={`M${P(40.4, a)}L${P(47.6, a)}`} stroke="#7a4a06" strokeOpacity=".55" strokeWidth="1" />
        })}
      {px >= 36 &&
        Array.from({ length: 8 }, (_, i) => {
          const [x, y] = at(44, i * 45 + 22.5)
          return <path key={i} d={`M${x} ${y - 1.8}L${x + 1.4} ${y}L${x} ${y + 1.8}L${x - 1.4} ${y}Z`} fill="#fff" fillOpacity=".85" />
        })}
      <circle cx="50" cy="50" r="49" fill="none" stroke={`url(#${u}m)`} strokeWidth="1.3" />
      <circle cx="50" cy="50" r="39.1" fill="none" stroke={`url(#${u}m)`} strokeWidth="1.2" />
      {px >= 36 && (
        <>
          <path className="bjc-tw" d={sparkle(84, 12, 4.4)} fill="#fff6c8" />
          <path className="bjc-tw" style={{ animationDelay: '1.4s' }} d={sparkle(13, 86, 3.4)} fill="#fff6c8" />
        </>
      )}
    </>
  ),
  // the twelve animated frames (src/art/fx-frames.tsx)
  ...FX_FRAMES,
}

const HOLO_MASK = 'radial-gradient(circle closest-side, transparent 77.2%, #000 78.2%, #000 97.6%, transparent 98.8%)'

/**
 * An avatar inside its frame, with an aura round it when `aura` names one (src/art/auras.tsx; drawn from 44 px up,
 * reaching a quarter of the size past the box, so leave it room). Some animated frames draw a layer under the avatar
 * too (FX_UNDER, FX_BACK); anything animated pauses while it is offscreen.
 */
export function FramedAvatar({ avatar, frame, size = 40, className = '', aura }: { avatar: number; frame: string; size?: number; className?: string; aura?: string }) {
  const u = useUid()
  const box = useRef<HTMLSpanElement>(null)
  const art = FRAME_ART[frame] as ((u: string, px: number) => ReactNode) | undefined
  const glow = size >= 44 && hasAura(aura) ? aura! : null
  useOffscreenPause(box, (size >= 36 && frame in FX_FRAMES) || !!glow)
  if (!art && !glow) return <Avatar index={avatar} size={size} className={className} />
  const inner = art ? Math.round(size * 0.78 * 10) / 10 : size
  const off = (size - inner) / 2
  const back = size >= 36 ? FX_BACK[frame] : undefined
  return (
    <span ref={box} className={`relative inline-block shrink-0 align-middle ${className}`} style={{ width: size, height: size }} data-frame={frame} data-aura={glow ?? undefined}>
      {glow && <AuraLayer id={glow} size={size} layer="back" />}
      {FX_UNDER[frame]?.(size)}
      {back && (
        <svg viewBox="0 0 100 100" width={size} height={size} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
          {back(`${u}b`, size)}
        </svg>
      )}
      {frame === 'frame:holo' && (
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full ${size >= 36 ? 'bjc-spin' : ''}`}
          style={{ background: 'conic-gradient(from 0deg,#ff6bd6,#ffd36b,#7dff9b,#5fe0ff,#9b7bff,#ff6bd6)', WebkitMaskImage: HOLO_MASK, maskImage: HOLO_MASK }}
        />
      )}
      <span className="absolute" style={{ left: off, top: off, width: inner, height: inner }}>
        <Avatar index={avatar} size={inner} className="block" />
      </span>
      {art && (
        <svg viewBox="0 0 100 100" width={size} height={size} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
          {art(u, size)}
        </svg>
      )}
      {glow && <AuraLayer id={glow} size={size} layer="front" />}
    </span>
  )
}

/* ---------------- banners ---------------- */

const W = 800
const H = 240

/** stars for the night scenes: x, y, radius, brightness */
function starField(seed: number, n: number, yMax = H) {
  const r = seq(seed)
  return Array.from({ length: n }, () => [r() * W, r() * yMax, 0.5 + r() * 1.3, 0.25 + r() * 0.7] as const)
}
const NIGHT_STARS = starField(11, 46, 200)
const GALAXY_STARS = starField(23, 90)
const AURORA_STARS = starField(37, 60, 170)
const NEON_STARS = starField(41, 22, 110)

/** a city skyline: buildings (x, width, height) and their lit windows */
function skyline(seed: number, base: number, from: number, to: number, minH: number, maxH: number) {
  const r = seq(seed)
  const blocks: { x: number; w: number; h: number }[] = []
  for (let x = from; x < to; ) {
    const w = 26 + Math.floor(r() * 42)
    blocks.push({ x, w, h: minH + Math.floor(r() * (maxH - minH)) })
    x += w + 2
  }
  const windows: { x: number; y: number; c: number }[] = []
  for (const b of blocks)
    for (let y = base - b.h + 10; y < base - 8; y += 9)
      for (let x = b.x + 5; x < b.x + b.w - 6; x += 8) if (r() < 0.32) windows.push({ x, y, c: Math.floor(r() * 3) })
  return { blocks, windows, base }
}
const SUNSET_CITY = skyline(5, 240, 150, 700, 30, 92)
const NEON_FAR = skyline(9, 214, -10, 820, 70, 150)
const NEON_NEAR = skyline(13, 214, -20, 830, 40, 112)

/** a pixel sprite from a bitmap (rows of '.' and 'X'), cell size c, as one path */
function sprite(rows: string[], x0: number, y0: number, c: number) {
  let d = ''
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && (d += `M${x0 + x * c} ${y0 + y * c}h${c}v${c}h-${c}z`)))
  return d
}
const INVADER = ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...']
const SQUID = ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X']
const COIN_PX = ['.XXXX.', 'XXXXXX', 'XX..XX', 'XX..XX', 'XXXXXX', '.XXXX.']
const HEART_PX = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']
const SHIP_PX = ['.....X.....', '....XXX....', '....XXX....', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX']

/** a gold bar at (x, y) (the front face's bottom-left corner) */
function goldBar(key: string, x: number, y: number, u: string) {
  return (
    <g key={key}>
      <path d={`M${x} ${y}h92l-10-28H${x + 10}z`} fill={`url(#${u}f)`} stroke="#6b4300" strokeOpacity=".5" strokeWidth="1" />
      <path d={`M${x + 10} ${y - 28}h72l-9-10H${x + 19}z`} fill={`url(#${u}t)`} />
      <rect x={x + 30} y={y - 20} width="32" height="10" rx="2" fill="none" stroke="#8a5a08" strokeOpacity=".55" strokeWidth="1.2" />
      <path d={`M${x + 4} ${y - 2}L${x + 12} ${y - 26}`} stroke="#fff6c8" strokeOpacity=".6" strokeWidth="1.5" />
    </g>
  )
}

/** a brilliant-cut diamond centred on (x, y), w wide */
function brilliant(key: string, x: number, y: number, w: number, rot = 0, cls?: string) {
  const s = w / 100
  const pts = (list: number[][]) => list.map(([a, b]) => `${(x + a * s).toFixed(1)},${(y + b * s).toFixed(1)}`).join(' ')
  const tones = ['#ffffff', '#e4d8ff', '#bfe9ff', '#9d7cff', '#7fd6ff', '#c9b2ff']
  const crown = [
    [[-50, -14], [-30, -36], [-22, -14]],
    [[-30, -36], [0, -36], [-22, -14]],
    [[-22, -14], [0, -36], [0, -14]],
    [[0, -14], [0, -36], [22, -14]],
    [[0, -36], [30, -36], [22, -14]],
    [[30, -36], [50, -14], [22, -14]],
  ]
  const pav = [
    [[-50, -14], [-22, -14], [0, 52]],
    [[-22, -14], [0, -14], [0, 52]],
    [[0, -14], [22, -14], [0, 52]],
    [[22, -14], [50, -14], [0, 52]],
  ]
  return (
    <g key={key} transform={rot ? `rotate(${rot} ${x} ${y})` : undefined} className={cls}>
      {crown.map((t, i) => (
        <polygon key={`c${i}`} points={pts(t)} fill={tones[i % 3]} />
      ))}
      {pav.map((t, i) => (
        <polygon key={`p${i}`} points={pts(t)} fill={tones[3 + (i % 3)]} />
      ))}
      <polygon points={pts([[-50, -14], [-30, -36], [30, -36], [50, -14], [0, 52]])} fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth={Math.max(0.8, 1.6 * s)} strokeLinejoin="round" />
    </g>
  )
}

/** a casino chip lying flat at (x, y), seen at an angle */
function chip(key: string, x: number, y: number, r: number, color: string, h = 7) {
  return (
    <g key={key}>
      <path d={`M${x - r} ${y}v${h}a${r} ${r * 0.38} 0 0 0 ${2 * r} 0v-${h}z`} fill={shade(color, -0.35)} />
      <ellipse cx={x} cy={y} rx={r} ry={r * 0.38} fill={color} />
      <ellipse cx={x} cy={y} rx={r * 0.82} ry={r * 0.3} fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth={r * 0.13} strokeDasharray={`${r * 0.32} ${r * 0.32}`} />
      <ellipse cx={x} cy={y} rx={r * 0.5} ry={r * 0.19} fill={shade(color, -0.15)} stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
    </g>
  )
}

/** a small fish facing left (flip to face right) */
function fish(key: string, x: number, y: number, s: number, color: string, flip = false) {
  return (
    <g key={key} transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <path d="M-14 0C-8 -8 6 -8 10 0 6 8 -8 8 -14 0Z" fill={color} />
      <path d="M8 0 18 -7 16 0 18 7Z" fill={shade(color, -0.2)} />
      <path d="M-2 -6.4C0 -2 0 2 -2 6.4" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" />
      <circle cx="-8" cy="-1.5" r="1.6" fill="#0b1a2a" />
    </g>
  )
}

const BANNER_ART: Record<string, (u: string, live: boolean) => ReactNode> = {
  'banner:default': (u, live) => (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14293d" />
          <stop offset="1" stopColor="#0a1520" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="640" cy="40" r="380">
          <stop offset="0" stopColor="#22d36f" stopOpacity=".32" />
          <stop offset="1" stopColor="#22d36f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}v`} gradientUnits="userSpaceOnUse" cx="110" cy="260" r="330">
          <stop offset="0" stopColor="#9b7bff" stopOpacity=".26" />
          <stop offset="1" stopColor="#9b7bff" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${u}p`} width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="44" height="44" fill="none" stroke="#fff" strokeOpacity=".04" />
        </pattern>
        <mask id={`${u}m`}>
          <rect width={W} height={H} fill="#fff" />
          <circle cx="690" cy="58" r="25" fill="#000" />
        </mask>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}p)`} />
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      <rect width={W} height={H} fill={`url(#${u}v)`} />
      {NIGHT_STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r * 0.8} fill="#fff" opacity={o * 0.8} />
      ))}
      <circle cx="676" cy="70" r="27" fill="#f4f0d2" mask={`url(#${u}m)`} />
      <circle cx="676" cy="70" r="44" fill="#f4f0d2" opacity=".06" />
      {live &&
        [
          [520, 46, 0],
          [742, 128, 1.1],
          [300, 34, 2],
        ].map(([x, y, d]) => <path key={x} className="bjc-tw" style={{ animationDelay: `${d}s` }} d={sparkle(x, y, 5)} fill="#fff" />)}
      <path d="M0 214 60 200 120 208 190 190 260 204 340 186 420 202 500 188 580 204 660 192 740 206 800 196V240H0Z" fill="#081119" opacity=".75" />
    </>
  ),
  'banner:felt': (u) => (
    <>
      <defs>
        <radialGradient id={`${u}a`} gradientUnits="userSpaceOnUse" cx="430" cy="100" r="560">
          <stop offset="0" stopColor="#26a560" />
          <stop offset=".55" stopColor="#146b3c" />
          <stop offset="1" stopColor="#08331d" />
        </radialGradient>
        <pattern id={`${u}p`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r=".8" fill="#000" fillOpacity=".12" />
          <circle cx="4.5" cy="4.5" r=".6" fill="#fff" fillOpacity=".05" />
        </pattern>
        <linearGradient id={`${u}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe6ee" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}p)`} />
      <ellipse cx="400" cy="470" rx="760" ry="330" fill="none" stroke="#e2bd62" strokeOpacity=".5" strokeWidth="3" />
      <ellipse cx="400" cy="470" rx="732" ry="306" fill="none" stroke="#e2bd62" strokeOpacity=".22" strokeWidth="1.4" strokeDasharray="12 9" />
      <g opacity=".1" fill="#fff">
        <SuitShape suit="♠" transform="translate(80 40) scale(2)" />
        <SuitShape suit="♥" transform="translate(190 96) scale(1.4)" />
        <SuitShape suit="♣" transform="translate(320 30) scale(1.6)" />
      </g>
      <g transform="translate(588 34)">
        <rect x="6" y="10" width="66" height="94" rx="8" fill="#000" opacity=".28" transform="rotate(-14 39 57)" />
        <g transform="rotate(-14 39 57)">
          <rect width="66" height="94" rx="8" fill={`url(#${u}c)`} stroke="#c3cdd8" />
          <text x="9" y="25" fontSize="20" fontWeight="900" fill="#d0213a" style={{ fontFamily: 'Manrope, sans-serif' }}>
            A
          </text>
          <SuitShape suit="♥" fill="#d0213a" transform="translate(21 36) scale(1.05)" />
        </g>
        <rect x="56" y="12" width="66" height="94" rx="8" fill="#000" opacity=".28" transform="rotate(9 89 57)" />
        <g transform="rotate(9 89 57) translate(50 4)">
          <rect width="66" height="94" rx="8" fill={`url(#${u}c)`} stroke="#c3cdd8" />
          <text x="9" y="25" fontSize="20" fontWeight="900" fill="#1b2a38" style={{ fontFamily: 'Manrope, sans-serif' }}>
            K
          </text>
          <SuitShape suit="♠" fill="#1b2a38" transform="translate(21 36) scale(1.05)" />
        </g>
      </g>
      {chip('c1', 520, 196, 28, '#1c1d24')}
      {chip('c2', 520, 184, 28, '#d8243a')}
      {chip('c3', 520, 172, 28, '#d8243a')}
      {chip('c4', 520, 160, 28, '#1c1d24')}
      {chip('c5', 470, 212, 22, '#2a6cf0')}
      {chip('c6', 736, 200, 24, '#f2b134')}
      <rect width={W} height={H} fill="none" stroke="#000" strokeOpacity=".2" strokeWidth="30" />
    </>
  ),
  'banner:sunset': (u) => (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24104f" />
          <stop offset=".42" stopColor="#8c1f7a" />
          <stop offset=".72" stopColor="#ff5e62" />
          <stop offset="1" stopColor="#ffb347" />
        </linearGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff07a" />
          <stop offset=".55" stopColor="#ff8a4c" />
          <stop offset="1" stopColor="#ff3d77" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="560" cy="170" r="260">
          <stop offset="0" stopColor="#ffd36e" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffd36e" stopOpacity="0" />
        </radialGradient>
        <mask id={`${u}m`}>
          <rect width={W} height={H} fill="#fff" />
          {[148, 162, 175, 187, 198].map((y, i) => (
            <rect key={y} x="440" y={y} width="240" height={2.5 + i * 1.3} fill="#000" />
          ))}
        </mask>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      {[46, 70, 92].map((y, i) => (
        <path key={y} d={`M${60 + i * 90} ${y}h${220 - i * 40}`} stroke="#ffc2e4" strokeOpacity=".22" strokeWidth={3 - i * 0.6} strokeLinecap="round" />
      ))}
      <circle cx="560" cy="172" r="96" fill={`url(#${u}s)`} mask={`url(#${u}m)`} />
      {SUNSET_CITY.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={240 - b.h} width={b.w} height={b.h} fill="#1c0a33" />
      ))}
      {SUNSET_CITY.windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="3.4" height="4" fill={['#ffd36e', '#ff7bd5', '#6ff3ff'][w.c]} opacity=".75" />
      ))}
      <g transform="translate(300 156)">
        <rect width="64" height="22" rx="5" fill="none" stroke="#ff4fd8" strokeOpacity=".35" strokeWidth="6" />
        <rect width="64" height="22" rx="5" fill="#1c0a33" stroke="#ff7be3" strokeWidth="2" />
        <text x="32" y="15.5" textAnchor="middle" fontSize="12" fontWeight="900" fill="#ffd6f6" letterSpacing="2" style={{ fontFamily: 'Manrope, sans-serif' }}>
          BOJE
        </text>
      </g>
      {[
        [70, 1],
        [748, -1],
      ].map(([x, f]) => (
        <g key={x} transform={`translate(${x} 240) scale(${f} 1)`} fill="#12061f">
          <path d="M-4 0C0 -40 4 -80 14 -118L19 -117C10 -80 7 -40 6 0Z" />
          <path d="M16 -118C-6 -128 -30 -118 -44 -100 -26 -112 -8 -114 16 -112ZM16 -118C34 -134 58 -132 72 -116 52 -124 36 -122 16 -112ZM16 -118C4 -140 -18 -148 -36 -144 -16 -138 0 -130 14 -114ZM16 -118C32 -112 46 -96 50 -78 36 -96 26 -104 14 -110ZM16 -118C6 -104 -6 -96 -20 -78 -12 -98 0 -110 14 -114Z" />
        </g>
      ))}
    </>
  ),
  'banner:ocean': (u, live) => (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0e93c7" />
          <stop offset=".5" stopColor="#075585" />
          <stop offset="1" stopColor="#032542" />
        </linearGradient>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      {[
        [180, 40],
        [330, 26],
        [470, 50],
        [640, 30],
      ].map(([x, w]) => (
        <path key={x} d={`M${x} 0h${w}L${x - 60 + w} 240H${x - 120}Z`} fill={`url(#${u}r)`} />
      ))}
      <path d="M0 196C90 180 160 204 250 192S420 176 520 194 700 182 800 190V240H0Z" fill="#0a3550" />
      <path d="M0 214C120 204 220 222 340 212S560 200 660 214 760 210 800 212V240H0Z" fill="#0b2c40" />
      <g strokeLinecap="round" fill="none">
        <path className={live ? 'bjc-sway' : undefined} d="M60 236C54 210 70 196 62 170S70 140 64 124" stroke="#2fd18f" strokeWidth="6" />
        <path className={live ? 'bjc-sway' : undefined} style={{ animationDelay: '-2s' }} d="M86 236C92 214 80 196 90 178" stroke="#1fa874" strokeWidth="5" />
        <path className={live ? 'bjc-sway' : undefined} style={{ animationDelay: '-1s' }} d="M740 236C734 210 750 190 742 164S750 136 744 118" stroke="#2fd18f" strokeWidth="6" />
        <path d="M612 236C612 210 600 192 584 176M612 214C626 196 644 190 662 180M600 200C590 188 590 172 594 160M640 192C640 178 648 168 658 160" stroke="#ff6f91" strokeWidth="8" />
        <path d="M206 236C206 214 196 200 182 190M206 218C218 206 232 202 246 196" stroke="#b17cff" strokeWidth="7" />
      </g>
      <ellipse cx="680" cy="226" rx="34" ry="20" fill="#ffa45c" />
      <path d="M654 222c8-6 16-6 24 0s16 6 24 0M656 232c8-6 16-6 24 0s16 6 24 0" fill="none" stroke="#c96a26" strokeWidth="2" />
      {fish('f1', 470, 92, 1.3, '#ffd23f')}
      {fish('f2', 520, 116, 1, '#ff8a3d')}
      {fish('f3', 600, 70, 0.9, '#5cf2ff', true)}
      {fish('f4', 330, 140, 0.8, '#ffd23f', true)}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <g key={i} transform={`translate(${380 + i * 13} ${54 + (i % 3) * 7}) scale(.35)`}>
          <path d="M-14 0C-8 -8 6 -8 10 0 6 8 -8 8 -14 0Z M8 0 18 -7 16 0 18 7Z" fill="#bff4ff" opacity=".8" />
        </g>
      ))}
      {[
        [560, 200, 4, 0],
        [574, 214, 2.6, 1.2],
        [150, 206, 3.4, 2.4],
        [420, 218, 2.2, 3.6],
        [700, 160, 3, 4.6],
      ].map(([x, y, r, d]) => (
        <circle key={x} className={live ? 'bjc-rise' : undefined} style={{ animationDelay: `${-d}s` }} cx={x} cy={y} r={r} fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.2" />
      ))}
    </>
  ),
  'banner:neon': (u, live) => (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a0620" />
          <stop offset="1" stopColor="#2c0e52" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="420" cy="230" r="360">
          <stop offset="0" stopColor="#ff3fd0" stopOpacity=".42" />
          <stop offset="1" stopColor="#ff3fd0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      {NEON_STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r * 0.7} fill="#fff" opacity={o * 0.7} />
      ))}
      {NEON_FAR.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={214 - b.h} width={b.w} height={b.h} fill="#1d1340" />
      ))}
      {NEON_NEAR.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={214 - b.h} width={b.w} height={b.h} fill="#120a28" />
      ))}
      {NEON_NEAR.windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="3.6" height="4.2" fill={['#36e6ff', '#ff4fd8', '#ffd84d'][w.c]} opacity=".7" />
      ))}
      {NEON_NEAR.blocks.slice(4, 16).map((b, i) =>
        i % 3 ? null : (
          <g key={i}>
            <path d={`M${b.x} ${214 - b.h}h${b.w}`} stroke={i % 2 ? '#36e6ff' : '#ff4fd8'} strokeOpacity=".35" strokeWidth="6" />
            <path d={`M${b.x} ${214 - b.h}h${b.w}`} stroke={i % 2 ? '#bff8ff' : '#ffc8f2'} strokeWidth="1.6" />
          </g>
        ),
      )}
      <g transform="translate(470 40)" className={live ? 'bjc-buzz' : undefined}>
        <rect width="150" height="54" rx="10" fill="#0d0820" fillOpacity=".75" stroke="#ff4fd8" strokeOpacity=".35" strokeWidth="8" />
        <rect width="150" height="54" rx="10" fill="none" stroke="#ff8ae9" strokeWidth="2.2" />
        {(['♠', '♥', '♦', '♣'] as const).map((s, i) => (
          <g key={s}>
            <SuitShape suit={s} fill="none" stroke={i % 2 ? '#36e6ff' : '#ff4fd8'} strokeOpacity=".45" strokeWidth="3.5" transform={`translate(${16 + i * 32} 13) scale(1.15)`} />
            <SuitShape suit={s} fill="none" stroke={i % 2 ? '#c8fbff' : '#ffd1f4'} strokeWidth="1.2" transform={`translate(${16 + i * 32} 13) scale(1.15)`} />
          </g>
        ))}
      </g>
      <rect y="214" width={W} height="26" fill="#0e0820" />
      <g stroke="#ff4fd8" strokeOpacity=".4" strokeWidth="1">
        {[218, 224, 232].map((y) => (
          <path key={y} d={`M0 ${y}H${W}`} />
        ))}
        {Array.from({ length: 15 }, (_, i) => (
          <path key={i} d={`M400 212L${400 + (i - 7) * 130} 240`} />
        ))}
      </g>
    </>
  ),
  'banner:arcade': (u, live) => (
    <>
      <defs>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="560" cy="80" r="420">
          <stop offset="0" stopColor="#3d1a86" />
          <stop offset="1" stopColor="#12062b" />
        </radialGradient>
        <pattern id={`${u}p`} width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="#fff" strokeOpacity=".05" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      <rect width={W} height={H} fill={`url(#${u}p)`} />
      <g shapeRendering="crispEdges">
        {[
          [90, 40, 0],
          [250, 120, 1.1],
          [380, 30, 0.5],
          [720, 150, 1.7],
          [180, 190, 2.3],
        ].map(([x, y, d]) => (
          <path key={x} className={live ? 'bjc-tw' : undefined} style={{ animationDelay: `${d}s` }} d={`M${x} ${y - 6}h3v6h6v3h-6v6h-3v-6h-6v-3h6z`} fill="#fff" />
        ))}
        <path d={sprite(INVADER, 500, 40, 5)} fill="#5cf2ff" />
        <path d={sprite(INVADER, 610, 76, 5)} fill="#ff4fb8" />
        <path d={sprite(SQUID, 706, 30, 5)} fill="#7dff6b" />
        <path d={sprite(SQUID, 420, 96, 4)} fill="#ffd84d" />
        <path d={sprite(SHIP_PX, 560, 176, 5)} fill="#7dff6b" />
        <path d="M586 148h3v16h-3z" fill="#fff" />
        {[
          [300, 70],
          [340, 150],
          [660, 140],
          [150, 100],
        ].map(([x, y]) => (
          <g key={x}>
            <path d={sprite(COIN_PX, x, y, 4)} fill="#ffd84d" />
            <path d={`M${x + 8} ${y + 4}h4v4h-4z`} fill="#fff6b0" />
          </g>
        ))}
        {[0, 1, 2].map((i) => (
          <path key={i} d={sprite(HEART_PX, 30 + i * 36, 18, 4)} fill="#ff4f6e" />
        ))}
        {Array.from({ length: 40 }, (_, i) => (
          <rect key={i} x={i * 20} y="224" width="19" height="7" fill={i % 2 ? '#5a2bb8' : '#4a2296'} />
        ))}
        {Array.from({ length: 40 }, (_, i) => (
          <rect key={i} x={i * 20 - 10} y="232" width="19" height="8" fill={i % 2 ? '#4a2296' : '#3a1a78'} />
        ))}
      </g>
    </>
  ),
  'banner:galaxy': (u, live) => (
    <>
      <defs>
        {(
          [
            ['n1', 250, 80, 260, '#7b2ff7', 0.6],
            ['n2', 520, 190, 230, '#ff3fa4', 0.42],
            ['n3', 690, 40, 260, '#1fb6ff', 0.45],
            ['n4', 80, 200, 200, '#2b4dff', 0.4],
          ] as const
        ).map(([k, x, y, r, c, o]) => (
          <radialGradient key={k} id={`${u}${k}`} gradientUnits="userSpaceOnUse" cx={x} cy={y} r={r}>
            <stop offset="0" stopColor={c} stopOpacity={o} />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </radialGradient>
        ))}
        <radialGradient id={`${u}p`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#ffd79a" />
          <stop offset=".5" stopColor="#ff7a8a" />
          <stop offset="1" stopColor="#4a1660" />
        </radialGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity=".9" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#070519" />
      {['n1', 'n2', 'n3', 'n4'].map((k) => (
        <rect key={k} width={W} height={H} fill={`url(#${u}${k})`} />
      ))}
      <ellipse cx="300" cy="120" rx="320" ry="38" transform="rotate(-12 300 120)" fill="#fff" opacity=".05" />
      {GALAXY_STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r * 0.75} fill="#fff" opacity={o} />
      ))}
      {[
        [140, 50, 6, 0],
        [430, 34, 5, 1],
        [560, 200, 4.4, 1.8],
        [760, 110, 5, 0.6],
        [260, 180, 4, 2.4],
      ].map(([x, y, s, d]) => (
        <path key={x} className={live ? 'bjc-tw' : undefined} style={{ animationDelay: `${d}s` }} d={sparkle(x, y, s)} fill="#fff" />
      ))}
      <path d="M90 30 210 76" stroke={`url(#${u}s)`} strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="650" cy="138" rx="86" ry="17" transform="rotate(-16 650 138)" fill="none" stroke="#ffe2b0" strokeOpacity=".55" strokeWidth="5" />
      <circle cx="650" cy="138" r="46" fill={`url(#${u}p)`} />
      <path d="M607 128C620 120 650 116 690 122" stroke="#fff" strokeOpacity=".18" strokeWidth="6" fill="none" />
      <path d="M567 162A86 17 -16 0 0 733 114" transform="rotate(0)" fill="none" stroke="#ffe2b0" strokeOpacity=".85" strokeWidth="5" strokeLinecap="round" />
      <circle cx="556" cy="66" r="9" fill="#cdbdf0" />
      <circle cx="553" cy="63" r="3" fill="#fff" opacity=".35" />
    </>
  ),
  'banner:vault': (u) => (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4d60" />
          <stop offset="1" stopColor="#151f2a" />
        </linearGradient>
        <pattern id={`${u}p`} width="800" height="4" patternUnits="userSpaceOnUse">
          <rect width="800" height="1" fill="#fff" fillOpacity=".035" />
        </pattern>
        <radialGradient id={`${u}d`} cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor="#a3b6c7" />
          <stop offset=".55" stopColor="#5a6e82" />
          <stop offset="1" stopColor="#2a3846" />
        </radialGradient>
        <linearGradient id={`${u}c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f8fb" />
          <stop offset=".5" stopColor="#9fb0c0" />
          <stop offset="1" stopColor="#4e6072" />
        </linearGradient>
        {grad(`${u}g`, GOLD)}
        <radialGradient id={`${u}l`} gradientUnits="userSpaceOnUse" cx="630" cy="120" r="200">
          <stop offset=".5" stopColor="#f7c548" stopOpacity=".28" />
          <stop offset="1" stopColor="#f7c548" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}p)`} />
      {[0, 200, 400].map((x) => (
        <rect key={x} x={x + 8} y="10" width="184" height="220" rx="6" fill="none" stroke="#0c141c" strokeOpacity=".45" strokeWidth="2" />
      ))}
      {[0, 200, 400].flatMap((x) =>
        [22, 218].flatMap((y) => [x + 22, x + 178].map((cx) => <circle key={`${x}${y}${cx}`} cx={cx} cy={y} r="3.2" fill={`url(#${u}c)`} stroke="#0c141c" strokeOpacity=".5" />)),
      )}
      <circle cx="630" cy="120" r="200" fill={`url(#${u}l)`} />
      <circle cx="630" cy="120" r="122" fill="#18222c" stroke="#4d6070" strokeWidth="6" />
      <circle cx="630" cy="120" r="104" fill={`url(#${u}d)`} stroke="#f7c548" strokeOpacity=".55" strokeWidth="2" />
      <circle cx="630" cy="120" r="92" fill="none" stroke="#1d2833" strokeOpacity=".5" strokeWidth="3" />
      <circle cx="630" cy="120" r="66" fill="none" stroke="#1d2833" strokeOpacity=".4" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => {
        const [x, y] = at(80, i * 30, 630, 120)
        return <circle key={i} cx={x} cy={y} r="6.5" fill={`url(#${u}c)`} stroke="#1d2833" strokeWidth="1.2" />
      })}
      {[0, 60, 120].map((a) => (
        <g key={a} transform={`rotate(${a + 15} 630 120)`}>
          <path d="M570 120H690" stroke="#1d2833" strokeWidth="12" strokeLinecap="round" />
          <path d="M570 120H690" stroke={`url(#${u}c)`} strokeWidth="9" strokeLinecap="round" />
          <circle cx="566" cy="120" r="8" fill={`url(#${u}c)`} stroke="#1d2833" strokeWidth="1.2" />
          <circle cx="694" cy="120" r="8" fill={`url(#${u}c)`} stroke="#1d2833" strokeWidth="1.2" />
        </g>
      ))}
      <circle cx="630" cy="120" r="20" fill={`url(#${u}g)`} stroke="#6b4300" strokeWidth="1.4" />
      <circle cx="630" cy="120" r="7" fill="#2a1a05" />
      <rect x="500" y="66" width="16" height="28" rx="3" fill={`url(#${u}c)`} stroke="#1d2833" />
      <rect x="500" y="146" width="16" height="28" rx="3" fill={`url(#${u}c)`} stroke="#1d2833" />
    </>
  ),
  'banner:gold': (u, live) => (
    <>
      <defs>
        <radialGradient id={`${u}a`} gradientUnits="userSpaceOnUse" cx="600" cy="130" r="520">
          <stop offset="0" stopColor="#7a5410" />
          <stop offset=".5" stopColor="#3a2507" />
          <stop offset="1" stopColor="#150d02" />
        </radialGradient>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd75e" />
          <stop offset=".6" stopColor="#e0a21a" />
          <stop offset="1" stopColor="#a86c0c" />
        </linearGradient>
        <linearGradient id={`${u}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff8d6" />
          <stop offset="1" stopColor="#ffd75e" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <g opacity=".08" fill="#ffe28f">
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d={`M600 150L${P(700, i * 22.5 - 3, 600, 150)}L${P(700, i * 22.5 + 3, 600, 150)}Z`} />
        ))}
      </g>
      {goldBar('b1', 420, 238, u)}
      {goldBar('b2', 514, 238, u)}
      {goldBar('b3', 608, 238, u)}
      {goldBar('b4', 702, 238, u)}
      {goldBar('b5', 467, 202, u)}
      {goldBar('b6', 561, 202, u)}
      {goldBar('b7', 655, 202, u)}
      {goldBar('b8', 514, 166, u)}
      {goldBar('b9', 608, 166, u)}
      {goldBar('b10', 561, 130, u)}
      {[
        [90, 210, 16],
        [140, 224, 13],
        [60, 228, 11],
        [230, 216, 12],
        [330, 228, 14],
      ].map(([x, y, r]) => (
        <g key={x}>
          <ellipse cx={x} cy={y + 2.5} rx={r} ry={r * 0.36} fill="#6b4300" />
          <ellipse cx={x} cy={y} rx={r} ry={r * 0.36} fill="#f7c548" stroke="#b97c12" strokeWidth="1" />
          <ellipse cx={x} cy={y} rx={r * 0.62} ry={r * 0.2} fill="none" stroke="#b97c12" strokeWidth="1" />
        </g>
      ))}
      {[
        [520, 110, 6, 0],
        [700, 140, 5, 1],
        [470, 186, 4, 1.8],
        [760, 200, 5, 0.5],
        [330, 60, 4, 2.2],
      ].map(([x, y, s, d]) => (
        <path key={x} className={live ? 'bjc-tw' : undefined} style={{ animationDelay: `${d}s` }} d={sparkle(x, y, s)} fill="#fff6c8" />
      ))}
    </>
  ),
  'banner:diamond': (u, live) => (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24124f" />
          <stop offset="1" stopColor="#0b1733" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="620" cy="110" r="300">
          <stop offset="0" stopColor="#b892ff" stopOpacity=".45" />
          <stop offset="1" stopColor="#b892ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}c`} gradientUnits="userSpaceOnUse" cx="260" cy="250" r="280">
          <stop offset="0" stopColor="#7fe3ff" stopOpacity=".25" />
          <stop offset="1" stopColor="#7fe3ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".14" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      <rect width={W} height={H} fill={`url(#${u}c)`} />
      <g fill="none" stroke="#e8d9ff" strokeOpacity=".1">
        {Array.from({ length: 13 }, (_, i) => (
          <path key={i} d={`M400 270L${P(420, 190 + i * 13.3, 400, 270)}`} />
        ))}
        {[110, 170, 230].map((r) => (
          <path key={r} d={`M${400 - r} 270A${r} ${r} 0 0 1 ${400 + r} 270`} strokeWidth="2" />
        ))}
      </g>
      {[
        [520, 60],
        [650, 50],
        [740, 70],
      ].map(([x, w]) => (
        <path key={x} d={`M${x} 0h${w}L${x - 90 + w} 240H${x - 150}Z`} fill={`url(#${u}r)`} />
      ))}
      {brilliant('d1', 630, 118, 150, 0, live ? 'bjc-float' : undefined)}
      {brilliant('d2', 486, 168, 74, -14)}
      {brilliant('d3', 748, 182, 56, 12)}
      {brilliant('d4', 410, 64, 32, 8)}
      {[
        [596, 66, 7, 0],
        [690, 96, 5, 1.2],
        [470, 130, 4.4, 2],
        [760, 140, 4.6, 0.6],
        [300, 54, 4, 1.6],
      ].map(([x, y, s, d]) => (
        <path key={x} className={live ? 'bjc-tw' : undefined} style={{ animationDelay: `${d}s` }} d={sparkle(x, y, s)} fill="#fff" />
      ))}
    </>
  ),
  'banner:jackpot': (u, live) => (
    <>
      <defs>
        <radialGradient id={`${u}a`} gradientUnits="userSpaceOnUse" cx="560" cy="120" r="460">
          <stop offset="0" stopColor="#ff5a3a" />
          <stop offset=".45" stopColor="#b3122a" />
          <stop offset="1" stopColor="#3e0010" />
        </radialGradient>
        {grad(`${u}g`, GOLD)}
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9ccd6" />
          <stop offset=".2" stopColor="#ffffff" />
          <stop offset=".8" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b9bcc6" />
        </linearGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b6b" />
          <stop offset="1" stopColor="#b30c22" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <g fill="#ffd75e" opacity=".13">
        {Array.from({ length: 18 }, (_, i) => (
          <path key={i} d={`M560 120L${P(800, i * 20 - 4, 560, 120)}L${P(800, i * 20 + 4, 560, 120)}Z`} />
        ))}
      </g>
      <rect x="420" y="56" width="280" height="122" rx="16" fill="#2a0008" stroke={`url(#${u}g)`} strokeWidth="7" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${436 + i * 86} 70)`}>
          <rect width="76" height="94" rx="6" fill={`url(#${u}r)`} />
          <path d="M14 18h48v10L44 80H31l17-44H27v6H14z" fill={`url(#${u}s)`} stroke="#5a0010" strokeWidth="2" strokeLinejoin="round" />
          <path d="M18 22h40" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
        </g>
      ))}
      <path d="M426 117h268" stroke="#ffd75e" strokeOpacity=".5" strokeWidth="2" strokeDasharray="6 5" />
      <text x="560" y="44" textAnchor="middle" fontSize="30" fontWeight="900" letterSpacing="5" fill={`url(#${u}g)`} stroke="#5a0010" strokeWidth="1.5" style={{ fontFamily: 'Manrope, sans-serif' }}>
        JACKPOT
      </text>
      {[
        [370, 80, 14, -20],
        [740, 60, 12, 30],
        [300, 170, 11, 10],
        [760, 200, 15, -12],
        [200, 70, 9, 40],
      ].map(([x, y, r, rot]) => (
        <g key={x} transform={`rotate(${rot} ${x} ${y})`}>
          <ellipse cx={x} cy={y + 2.4} rx={r} ry={r * 0.45} fill="#8a5a08" />
          <ellipse cx={x} cy={y} rx={r} ry={r * 0.45} fill="#f7c548" stroke="#b97c12" />
          <path d={starPath(5, r * 0.38, r * 0.16, x, y)} transform={`translate(0 0) scale(1 1)`} fill="#b97c12" opacity=".7" />
        </g>
      ))}
      {[8, 232].map((y) =>
        Array.from({ length: 34 }, (_, i) => (
          <circle key={`${y}${i}`} className={live ? 'bjc-blink' : undefined} style={{ animationDelay: `${(i % 2) * 0.55}s` }} cx={12 + i * 24} cy={y} r="4.2" fill={i % 2 ? '#fff6c8' : '#ffd75e'} />
        )),
      )}
    </>
  ),
  'banner:aurora': (u, live) => (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#020c18" />
          <stop offset="1" stopColor="#07293b" />
        </linearGradient>
        {(
          [
            ['g', '#3dffa8'],
            ['c', '#3de0ff'],
            ['v', '#b17cff'],
          ] as const
        ).map(([k, c]) => (
          <linearGradient key={k} id={`${u}${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c} stopOpacity="0" />
            <stop offset=".35" stopColor={c} stopOpacity=".55" />
            <stop offset=".7" stopColor={c} stopOpacity=".25" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      {AURORA_STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r * 0.7} fill="#fff" opacity={o * 0.8} />
      ))}
      <path className={live ? 'bjc-wave' : undefined} d="M-40 70C80 30 180 100 300 60S520 20 640 60 800 40 860 50V170C760 150 660 190 540 160S320 130 200 170 40 150 -40 170Z" fill={`url(#${u}v)`} />
      <path className={live ? 'bjc-wave' : undefined} style={{ animationDuration: '12s', animationDelay: '-4s' }} d="M-40 40C100 70 200 10 330 40S560 90 680 40 820 30 860 40V150C740 170 640 130 520 150S300 180 180 140 20 160 -40 150Z" fill={`url(#${u}g)`} />
      <path className={live ? 'bjc-wave' : undefined} style={{ animationDuration: '10s', animationDelay: '-7s' }} d="M-40 90C80 60 200 110 320 70S520 10 640 40 800 70 860 40V130C760 150 660 110 540 140S320 170 200 130 40 140 -40 150Z" fill={`url(#${u}c)`} />
      <path d="M0 240V180L70 140 130 170 210 110 290 168 350 138 430 186 520 130 600 172 680 120 760 160 800 146V240Z" fill="#0b2a3c" />
      <path d="M210 110 232 126 220 124 204 132 196 122ZM520 130 540 146 530 144 516 150 506 140ZM680 120 700 136 690 134 676 140 668 130Z" fill="#dff6ff" opacity=".75" />
      <path d="M0 240V206L90 176 170 200 260 168 360 204 460 172 560 206 660 180 740 200 800 186V240Z" fill="#051722" />
    </>
  ),
  // the ten animated scenes (src/art/fx-banners.tsx)
  ...FX_BANNER_ART,
}

/** a solid colour behind each scene while it draws, and for anything that can't */
const BANNER_BG: Record<string, string> = {
  ...FX_BANNER_BG,
  'banner:default': '#0e1d2b',
  'banner:felt': '#146b3c',
  'banner:sunset': '#8c1f7a',
  'banner:ocean': '#075585',
  'banner:neon': '#1a0a38',
  'banner:arcade': '#1d0a45',
  'banner:galaxy': '#0b0824',
  'banner:vault': '#26333f',
  'banner:gold': '#3a2507',
  'banner:diamond': '#1a1240',
  'banner:jackpot': '#8a0e22',
  'banner:aurora': '#04192a',
}

/** a profile banner, filling its box (absolute inset-0); children sit on top. `still` holds its animation (small copies). */
export function ProfileBanner({ id, className = '', children, still = false }: { id: string; className?: string; children?: ReactNode; still?: boolean }) {
  const u = useUid()
  const box = useRef<HTMLDivElement>(null)
  const b = BANNER_ART[id] ? id : 'banner:default'
  // the animated scenes hold still while scrolled out of view
  useOffscreenPause(box, !still && b in FX_BANNER_ART)
  return (
    <div ref={box} className={`relative isolate overflow-hidden ${className}`} data-banner={b} style={{ background: BANNER_BG[b] }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 -z-10 h-full w-full" aria-hidden>
        {BANNER_ART[b](u, !still)}
      </svg>
      {children}
    </div>
  )
}

/* ---------------- names and titles ---------------- */

const SHADOW = 'drop-shadow(0 1px 1.5px rgba(0,0,0,.85)) drop-shadow(0 0 6px rgba(0,0,0,.35))'
const clip = (backgroundImage: string, extra: CSSProperties = {}): CSSProperties => ({ backgroundImage, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent', filter: SHADOW, ...extra })
const solid = (color: string): CSSProperties => ({ color, textShadow: '0 1px 2px rgba(0,0,0,.8), 0 0 8px rgba(0,0,0,.35)' })

const NAME_STYLE: Record<string, { style: CSSProperties; cls?: string }> = {
  'name:default': { style: solid('#f4f8fb') },
  'name:green': { style: solid('#3fe28a') },
  'name:ice': { style: clip('linear-gradient(180deg,#ffffff 0%,#c8f5ff 45%,#6fd3ff 100%)') },
  'name:rose': { style: clip('linear-gradient(180deg,#ffd1e2 0%,#ff8fb8 55%,#ff5f97 100%)') },
  'name:violet': { style: clip('linear-gradient(180deg,#e7dbff 0%,#b892ff 55%,#8a5cff 100%)') },
  'name:gold': { style: clip('linear-gradient(180deg,#fff7d0 0%,#ffd75e 36%,#c98a14 52%,#ffe08a 70%,#b8780c 100%)') },
  'name:fire': { style: clip('linear-gradient(90deg,#ffe36b,#ff8a1f,#ff3b2f,#ff8a1f,#ffe36b)', { filter: `${SHADOW} drop-shadow(0 0 7px rgba(255,110,30,.5))` }), cls: 'bjc-pan' },
  'name:rainbow': { style: clip('linear-gradient(90deg,#ff5f6d,#ffc371,#7cff6b,#4fd8ff,#a66bff,#ff5fa2,#ff5f6d)'), cls: 'bjc-pan' },
  'name:diamond': { style: clip('linear-gradient(180deg,#ffffff 0%,#efe6ff 30%,#a8eaff 48%,#ffffff 60%,#c4a6ff 100%)', { filter: `${SHADOW} drop-shadow(0 0 6px rgba(184,146,255,.45))` }) },
  // the nine animated styles (src/art/fx-names.ts)
  ...NAME_FX,
}

/** a player's name in their name colour (data-text feeds the styles that copy the name, like the glitch's slices) */
export function NameTag({ name, color, className = '' }: { name: string; color: string; className?: string }) {
  const s = NAME_STYLE[color] ?? NAME_STYLE['name:default']
  return (
    <span className={`font-extrabold ${s.cls ?? ''} ${className}`} style={s.style} data-color={color} data-text={name}>
      {name}
    </span>
  )
}

const TITLE_STYLE: Record<Rarity, CSSProperties> = {
  common: { background: 'linear-gradient(180deg,#2c3f51,#223242)', color: '#c9d5e0', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' },
  rare: { background: 'linear-gradient(180deg,#2361b0,#173f78)', color: '#dcecff', boxShadow: 'inset 0 0 0 1px rgba(140,195,255,.35), 0 0 12px -4px rgba(76,157,255,.7)' },
  epic: { background: 'linear-gradient(180deg,#6a32b8,#43207a)', color: '#f0e4ff', boxShadow: 'inset 0 0 0 1px rgba(214,180,255,.4), 0 0 14px -4px rgba(176,107,255,.8)' },
  legendary: { background: 'linear-gradient(180deg,#ffeaa0,#f7c548 50%,#d39417)', color: '#3a2400', boxShadow: 'inset 0 0 0 1px rgba(255,250,220,.6), 0 0 16px -4px rgba(247,197,72,.9)' },
  // the Mythic plate: a deep rainbow that drifts along (bjx-prism-bg), white letters, sparkles (TitleChip)
  mythic: {
    backgroundImage: 'linear-gradient(100deg,#c2187a,#7a1fd1 14%,#3a2be0 28%,#1279d6 42%,#0e9f7a 56%,#cf870c 70%,#d4402c 84%,#c2187a)',
    backgroundSize: '200% 100%',
    color: '#ffffff',
    textShadow: '0 1px 1.5px rgba(0,0,0,.6)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35), inset 0 0 0 1px rgba(255,255,255,.5), 0 0 14px -3px rgba(255,79,216,.85), 0 0 18px -6px rgba(63,216,255,.8)',
  },
}

/** the little mark before a title: a dot, a diamond, a four-point star, a crown, and for a Mythic a turning star */
function RarityMark({ r }: { r: Rarity }) {
  const d =
    r === 'common'
      ? 'M5 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z'
      : r === 'rare'
        ? 'M5 1.5 8.5 5 5 8.5 1.5 5Z'
        : r === 'epic'
          ? sparkle(5, 5, 4)
          : r === 'mythic'
            ? starPath(8, 4.9, 2, 5, 5)
            : 'M1 7.6 1.6 2.6 3.6 4.6 5 1.6 6.4 4.6 8.4 2.6 9 7.6Z'
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className={`shrink-0 ${r === 'mythic' ? 'bjx-t-turn' : ''}`} aria-hidden>
      <path d={d} fill="currentColor" opacity=".9" />
      {r === 'mythic' && <circle cx="5" cy="5" r="1.1" fill="#fff" />}
    </svg>
  )
}

/** a twinkle on a title plate */
const PlateSpark = ({ at, s, delay }: { at: CSSProperties; s: number; delay: number }) => (
  <span aria-hidden className="bjx-spark pointer-events-none absolute" style={{ ...at, width: s, height: s, animationDelay: `${-delay}s` }} />
)

/**
 * A title chip ("High Roller"); nothing for no title. A Legendary plate glints and glows; a Mythic one wears the
 * Mythic signature: its rainbow drifts, its star turns, a glint crosses it and sparkles come and go.
 */
export function TitleChip({ id, className = '' }: { id: string; className?: string }) {
  const c = cosmetic(id)
  if (!c || c.kind !== 'title' || id === 'title:none') return null
  const fx = c.rarity === 'mythic' ? 'bjx-prism-bg' : c.rarity === 'legendary' ? 'bjx-t-legend' : ''
  return (
    <span
      className={`relative inline-flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-md px-2 py-[4px] text-[10.5px] font-black uppercase leading-none tracking-[.08em] ${fx} ${className}`}
      style={TITLE_STYLE[c.rarity]}
      data-title={id}
    >
      <RarityMark r={c.rarity} />
      {c.name}
      {(c.rarity === 'legendary' || c.rarity === 'mythic') && (
        <span aria-hidden className={`bjc-glint pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent ${c.rarity === 'mythic' ? 'via-white/45' : 'via-white/60'} to-transparent`} />
      )}
      {c.rarity === 'legendary' && <PlateSpark at={{ right: 2, top: 1 }} s={6} delay={0.6} />}
      {c.rarity === 'mythic' && (
        <>
          <PlateSpark at={{ right: 2, top: 0 }} s={7} delay={0} />
          <PlateSpark at={{ left: '46%', bottom: 0 }} s={5} delay={0.8} />
          <PlateSpark at={{ left: 1, bottom: 1 }} s={5} delay={1.6} />
        </>
      )}
    </span>
  )
}

/* ---------------- badges ---------------- */

const SHAPES: Record<Rarity, string> = {
  common: 'M32 5a27 27 0 1 1 0 54 27 27 0 0 1 0-54Z',
  rare: Array.from({ length: 6 }, (_, i) => `${i ? 'L' : 'M'}${P(29, -90 + i * 60, 32, 32)}`).join('') + 'Z',
  epic: starPath(16, 29.5, 26.4, 32, 32),
  legendary: starPath(12, 31, 25, 32, 32),
  mythic: starPath(10, 31.5, 22, 32, 32),
}

/** what the middle of a medal is coloured: a tier's colour, a game's, or the milestone's own */
const EMBLEM_COLOR: Record<string, string> = { star: '#22d36f', rounds: '#4cb4ff', coins: '#f7c548', trophy: '#ff9a3d', calendar: '#ff5fa2', vault: '#9b7bff' }

function emblem(icon: string, dark: string): ReactNode {
  switch (icon) {
    case 'star':
      return <path d="M12 2.6l2.9 5.9 6.4.9-4.7 4.5 1.1 6.4L12 17.3l-5.7 3 1.1-6.4-4.7-4.5 6.4-.9z" />
    case 'rounds':
      return (
        <>
          <path d="M19.6 12.4a7.6 7.6 0 1 1-2.3-5.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M19.4 3.2v4.8h-4.8z" />
          <path d="M10 8.4v7.2l6-3.6z" />
        </>
      )
    case 'coins':
      return (
        <>
          {[16.4, 11.8, 7.2].map((y) => (
            <g key={y}>
              <path d={`M5 ${y}v2.6c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V${y}`} />
              <ellipse cx="12" cy={y} rx="7" ry="2.9" stroke={dark} strokeOpacity=".35" strokeWidth=".8" />
            </g>
          ))}
          <path d="M12 5.6l.6 1.2 1.3.2-.95.9.2 1.3L12 8.6l-1.15.6.2-1.3-.95-.9 1.3-.2z" fill={dark} fillOpacity=".55" />
        </>
      )
    case 'trophy':
      return (
        <>
          <path d="M6.6 3.2h10.8v5.6a5.4 5.4 0 0 1-10.8 0z" />
          <path d="M6.8 5.2H3.6v1.6a3.6 3.6 0 0 0 3.6 3.6M17.2 5.2h3.2v1.6a3.6 3.6 0 0 1-3.6 3.6" fill="none" stroke="#fff" strokeWidth="1.8" />
          <path d="M10.6 14h2.8v3.4h-2.8z" />
          <rect x="7.4" y="17.4" width="9.2" height="3.4" rx="1" />
          <path d="M9.4 5.2v3.4" stroke={dark} strokeOpacity=".3" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )
    case 'calendar':
      return (
        <>
          <rect x="3.4" y="4.6" width="17.2" height="16" rx="2.6" />
          <path d="M3.4 9.2h17.2" stroke={dark} strokeOpacity=".4" strokeWidth="1.4" />
          <path d="M8 2.8v3.6M16 2.8v3.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <text x="12" y="18.6" textAnchor="middle" fontSize="9.5" fontWeight="900" fill={dark} style={{ fontFamily: 'Manrope, sans-serif' }}>
            7
          </text>
        </>
      )
    case 'vault':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5.6" fill="none" stroke={dark} strokeOpacity=".45" strokeWidth="1.4" />
          <path d="M12 6.4v11.2M6.4 12h11.2M8 8l8 8M16 8l-8 8" stroke={dark} strokeOpacity=".45" strokeWidth="1.2" />
          <circle cx="12" cy="12" r="2" fill={dark} fillOpacity=".6" />
        </>
      )
  }
  if (icon.startsWith('tier-')) {
    const rank = Number(icon.slice(5))
    return (
      <>
        <path d="M12 2.4 20.2 5.6v6.2c0 5-3.4 8.6-8.2 10.4-4.8-1.8-8.2-5.4-8.2-10.4V5.6z" />
        <path d="M12 6.8l2.8 4.4-2.8 5.4-2.8-5.4z" fill={dark} fillOpacity=".6" />
        {Array.from({ length: rank }, (_, i) => (
          <circle key={i} cx={12 + (i - (rank - 1) / 2) * 2.6} cy="19" r=".9" fill={dark} fillOpacity=".55" />
        ))}
      </>
    )
  }
  return <path d="M12 2.6l2.9 5.9 6.4.9-4.7 4.5 1.1 6.4L12 17.3l-5.7 3 1.1-6.4-4.7-4.5 6.4-.9z" />
}

/** an achievement's badge; `locked` for one not earned yet */
export function BadgeIcon({ id, size = 32, className = '', locked = false }: { id: string; size?: number; className?: string; locked?: boolean }) {
  const u = useUid()
  const a = achievement(id)
  const rarity: Rarity = a?.rarity ?? 'common'
  const icon = a?.icon ?? 'star'
  const R = RARITY[rarity]
  const game = icon.startsWith('game:') ? (icon.slice(5) as GameId) : null
  const tier = icon.startsWith('tier-') ? TIERS[Number(icon.slice(5))] : null
  const base = game ? gameInfo(game).accent : tier ? tier.color : (EMBLEM_COLOR[icon] ?? R.color)
  const dark = shade(base, -0.55)
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`shrink-0 overflow-visible ${className}`} role="img" aria-label={a?.name ?? 'Badge'} data-badge={id}>
      <defs>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor={R.light} />
          <stop offset=".5" stopColor={R.color} />
          <stop offset="1" stopColor={R.dark} />
        </linearGradient>
        <linearGradient id={`${u}c`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor={shade(base, 0.35)} />
          <stop offset=".55" stopColor={base} />
          <stop offset="1" stopColor={shade(base, -0.4)} />
        </linearGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g style={locked ? { filter: 'grayscale(1) brightness(.7)', opacity: 0.5 } : undefined}>
        {rarity === 'legendary' && <path d="M21 44 14.6 62 20.4 58.6 24.6 63 30.4 47ZM43 44 49.4 62 43.6 58.6 39.4 63 33.6 47Z" fill="#d8243a" stroke="#6b0d18" strokeWidth=".8" />}
        <path d={SHAPES[rarity]} fill={`url(#${u}r)`} stroke={R.dark} strokeWidth="1.2" strokeLinejoin="round" />
        {rarity === 'common' && <circle cx="32" cy="32" r="25.4" fill="none" stroke={R.dark} strokeOpacity=".45" strokeWidth="2" strokeDasharray="1.4 1.6" />}
        <circle cx="32" cy="32" r="20" fill={dark} />
        <circle cx="32" cy="32" r="18.6" fill={`url(#${u}c)`} />
        <path d="M14.6 30a17.4 15 0 0 1 34.8 0c-6-3.4-28.8-3.4-34.8 0Z" fill={`url(#${u}s)`} />
        {game ? (
          <svg x="19.5" y="19.5" width="25" height="25" viewBox="0 0 25 25" style={{ color: '#fff' }} overflow="visible">
            <g style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.35))' }}>
              <GameIcon id={game} size={25} />
            </g>
          </svg>
        ) : (
          <g transform="translate(20 20)" fill="#fff" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.3))' }}>
            {emblem(icon, dark)}
          </g>
        )}
      </g>
      {locked && (
        <g>
          <circle cx="50" cy="50" r="10" fill="#0a1620" stroke="#2b475c" strokeWidth="1.5" />
          <rect x="45" y="49" width="10" height="7.4" rx="1.6" fill="#90a4b8" />
          <path d="M47 49v-2.4a3 3 0 0 1 6 0V49" fill="none" stroke="#90a4b8" strokeWidth="1.8" />
        </g>
      )}
    </svg>
  )
}

/* ---------------- previews ---------------- */

/** any cosmetic as a small square picture, for the shop and the wardrobe (a frame is shown round `avatar`, an aura round `avatar` in `frame`) */
export function CosmeticPreview({ id, size = 64, avatar, frame }: { id: string; size?: number; avatar?: number; frame?: string }) {
  const c = cosmetic(id)
  if (!c) return null
  const box: CSSProperties = { width: size, height: size }
  switch (c.kind) {
    case 'avatar':
      return (
        <span className="inline-flex shrink-0 items-center justify-center" style={box}>
          <Avatar index={Number(id.split(':')[1])} size={Math.round(size * 0.86)} />
        </span>
      )
    case 'frame':
      return (
        <span className="inline-flex shrink-0 items-center justify-center" style={box}>
          <FramedAvatar avatar={avatar ?? 7} frame={id} size={Math.round(size * 0.9)} />
        </span>
      )
    case 'aura': {
      // the avatar at two thirds of the box, so the aura (a quarter past it on each side) just fits; small ones stay still
      const s = Math.round(size * 0.64)
      return (
        <span className="inline-flex shrink-0 items-center justify-center" style={box} data-preview-aura={id}>
          <Aura id={id} size={s} still={size < 50}>
            <FramedAvatar avatar={avatar ?? 7} frame={frame ?? 'frame:bronze'} size={s} />
          </Aura>
        </span>
      )
    }
    case 'banner':
      return (
        <span className="relative block shrink-0 overflow-hidden rounded-[16%] bg-[#0b1823] shadow-[inset_0_0_0_1px_rgba(255,255,255,.07)]" style={box}>
          <ProfileBanner id={id} still={size < 120} className="absolute inset-x-0 top-0 h-[66%]" />
          <span className="absolute rounded-full bg-[#0b1823] p-[3%]" style={{ left: '9%', top: '46%', width: '34%', height: '34%' }}>
            <span className="block h-full w-full rounded-full bg-[linear-gradient(135deg,#8fa3b8,#4b5d70)]" />
          </span>
          <span className="absolute rounded-full bg-white/25" style={{ left: '48%', top: '72%', width: '40%', height: '7%' }} />
          <span className="absolute rounded-full bg-white/10" style={{ left: '48%', top: '84%', width: '26%', height: '6%' }} />
        </span>
      )
    case 'backdrop':
      // the scene behind a little profile page: a banner strip and a card standing on it (thumbnails stay still)
      return (
        <span className="relative block shrink-0 overflow-hidden rounded-[16%] shadow-[inset_0_0_0_1px_rgba(255,255,255,.07)]" style={box} data-preview-backdrop={id}>
          <Backdrop id={id} mini still={size < 48} className="absolute inset-0" />
          {size >= 40 && (
            <span className="absolute overflow-hidden rounded-[12%] bg-[#112230]/90 shadow-[0_6px_14px_-6px_rgba(0,0,0,.8)] ring-1 ring-white/10" style={{ left: '29%', right: '29%', top: '44%', bottom: '-8%' }}>
              <span className="absolute inset-x-0 top-0 h-[26%] bg-[linear-gradient(90deg,#1d3346,#26405a)]" />
              <span className="absolute rounded-full bg-[linear-gradient(135deg,#8fa3b8,#4b5d70)] ring-2 ring-[#112230]" style={{ left: '12%', top: '14%', width: '30%', aspectRatio: '1' }} />
              <span className="absolute rounded-full bg-white/30" style={{ left: '12%', top: '56%', width: '60%', height: '8%' }} />
              <span className="absolute rounded-full bg-white/12" style={{ left: '12%', top: '70%', width: '40%', height: '7%' }} />
            </span>
          )}
        </span>
      )
    case 'nameColor':
      return (
        <span className="inline-flex shrink-0 items-center justify-center rounded-[18%] bg-[radial-gradient(circle_at_50%_30%,#1d3346,#0a1620)]" style={{ ...box, fontSize: Math.round(size * 0.4) }}>
          <NameTag name="Aa" color={id} className="leading-none tracking-tight" />
        </span>
      )
    case 'title': {
      const R = RARITY[c.rarity]
      return (
        <span className="relative inline-flex shrink-0 flex-col items-center justify-center gap-[6%] overflow-hidden rounded-[18%] bg-[radial-gradient(circle_at_50%_30%,#1d3346,#0a1620)] px-[8%] text-center" style={box}>
          <svg width={size * 0.42} height={size * 0.24} viewBox="0 0 42 24" aria-hidden>
            <path d="M6 4h30l-3 8 3 8H6l3-8Z" fill={R.color} />
            <path d="M6 4 1 6l3 6-3 6 5 2" fill={R.dark} />
            <path d="M36 4l5 2-3 6 3 6-5 2" fill={R.dark} />
            <path d="M9 7h24" stroke="#fff" strokeOpacity=".45" strokeWidth="1.4" />
          </svg>
          <span className="inline-block" style={{ transform: `scale(${Math.min(1, (size * 0.9) / (40 + c.name.length * 7.5))})` }}>
            <TitleChip id={id} />
          </span>
        </span>
      )
    }
  }
}
