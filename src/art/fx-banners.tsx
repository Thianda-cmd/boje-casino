import type { CSSProperties, ReactNode } from 'react'

/*
  The ten animated banners added with the crates (src/store/cosmetics.ts): Code Rain, Sakura, Hyperspace, Synthwave,
  Vegas Lights, Supercell, Kaiju City, Eruption, Abyss and Singularity. Each is a scene drawn in SVG on the same
  800 x 240 grid as the banners in src/art/cosmetics.tsx (which merges these into BANNER_ART and BANNER_BG), cropped to
  fill its box, with the main subject a little right of centre: the profile's avatar breaks over the lower left
  corner, a phone keeps roughly x 50 to 750 and the shop's square tile only the middle third.

  Everything moves through CSS keyframes in one sheet added to the page once (the fxb- classes below), on transform
  and opacity only, apart from the flowing lava (a dash offset); nothing uses an SVG filter, so a banner costs little
  to repaint. The scenes are built so their resting positions are a good still frame: with `live` false (small copies
  of a banner) no class is set and every piece sits where it was placed, and the reduced-motion rule stops them all
  the same way. Several animations take their distances from custom properties (--dx, --dy, --r) so one keyframe
  serves many pieces. Singularity, the Mythic one, also shifts its colours round the rainbow with SMIL, only drawn
  when it is live and the player hasn't asked for reduced motion. A live banner scrolled out of view pauses
  (ProfileBanner marks it with fx-kit's offscreen watcher, and the rule below holds every fxb- animation under it).

  This module imports nothing from cosmetics.tsx (which imports it), so it keeps its own small helpers.
*/

const W = 800
const H = 240

const CSS = `
@keyframes fxb-fall{from{transform:translateY(-300px)}to{transform:translateY(300px)}}
.fxb-fall{animation:fxb-fall 5s linear infinite}
@keyframes fxb-flick{0%,40%,100%{opacity:1}42%,60%{opacity:.25}62%,80%{opacity:.8}}
.fxb-flick{animation:fxb-flick 2.2s steps(1) infinite}
@keyframes fxb-scan{0%{transform:translateY(-92px);opacity:0}12%,85%{opacity:1}100%{transform:translateY(92px);opacity:0}}
.fxb-scan{animation:fxb-scan 3.2s ease-in-out infinite}
@keyframes fxb-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.fxb-pulse{animation:fxb-pulse 3.4s ease-in-out infinite}
@keyframes fxb-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.fxb-breathe{transform-box:fill-box;transform-origin:center;animation:fxb-breathe 5s ease-in-out infinite}
@keyframes fxb-petal{0%{transform:translate(0,0) rotate(0);opacity:0}10%{opacity:1}85%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}
.fxb-petal{animation:fxb-petal 9s linear infinite}
@keyframes fxb-flut{0%,100%{transform:rotate(0) scaleX(1)}50%{transform:rotate(50deg) scaleX(.25)}}
.fxb-flut{transform-box:fill-box;transform-origin:center;animation:fxb-flut 1.6s ease-in-out infinite}
@keyframes fxb-shimmer{0%,100%{transform:scaleX(1);opacity:.75}50%{transform:scaleX(.55);opacity:.3}}
.fxb-shimmer{transform-box:fill-box;transform-origin:center;animation:fxb-shimmer 2.6s ease-in-out infinite}
@keyframes fxb-lantern{0%{transform:translateY(0);opacity:0}15%,80%{opacity:1}100%{transform:translateY(-90px);opacity:0}}
.fxb-lantern{animation:fxb-lantern 16s linear infinite}
@keyframes fxb-warp{0%{transform:scale(.12);opacity:0}25%{opacity:1}100%{transform:scale(3.4);opacity:.2}}
.fxb-warp{animation:fxb-warp 1.6s cubic-bezier(.55,0,1,.55) infinite}
@keyframes fxb-ring{0%{transform:scale(.08);opacity:0}20%{opacity:.7}100%{transform:scale(3);opacity:0}}
.fxb-ring{animation:fxb-ring 3s cubic-bezier(.5,0,1,.6) infinite}
@keyframes fxb-spin{to{transform:rotate(360deg)}}
.fxb-spin{animation:fxb-spin 20s linear infinite}
.fxb-spinr{animation:fxb-spin 20s linear infinite reverse}
@keyframes fxb-grid{0%{transform:translateY(0);opacity:0}25%{opacity:1}100%{transform:translateY(92px);opacity:1}}
.fxb-grid{animation:fxb-grid 3.6s cubic-bezier(.6,0,1,.5) infinite}
@keyframes fxb-gap{0%{transform:translateY(0) scaleY(.1)}100%{transform:translateY(56px) scaleY(1.3)}}
.fxb-gap{transform-box:fill-box;transform-origin:center;animation:fxb-gap 4s linear infinite}
@keyframes fxb-tw{0%,100%{opacity:.15;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}
.fxb-tw{transform-box:fill-box;transform-origin:center;animation:fxb-tw 2.6s ease-in-out infinite}
@keyframes fxb-shoot{0%,70%{transform:translate(0,0);opacity:0}72%{opacity:1}84%,100%{transform:translate(300px,90px);opacity:0}}
.fxb-shoot{animation:fxb-shoot 7s ease-out infinite}
@keyframes fxb-chase{0%,24%{opacity:1}25%,100%{opacity:.22}}
.fxb-chase{animation:fxb-chase 1s steps(1) infinite}
@keyframes fxb-sweep{0%,100%{transform:rotate(-22deg)}50%{transform:rotate(22deg)}}
.fxb-sweep{animation:fxb-sweep 7s ease-in-out infinite}
@keyframes fxb-rain{from{transform:translateY(0)}to{transform:translateY(120px)}}
.fxb-rain{animation:fxb-rain .45s linear infinite}
@keyframes fxb-bolt{0%,64%,67%,70%,100%{opacity:0}65%,68%{opacity:1}69%{opacity:.35}}
.fxb-bolt{animation:fxb-bolt 7s linear infinite}
@keyframes fxb-drift{0%,100%{transform:translateX(0)}50%{transform:translateX(var(--dx))}}
.fxb-drift{animation:fxb-drift 18s ease-in-out infinite}
@keyframes fxb-sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(5deg)}}
.fxb-sway{transform-box:fill-box;transform-origin:50% 100%;animation:fxb-sway 2.4s ease-in-out infinite}
@keyframes fxb-blink{0%,49%{opacity:1}50%,100%{opacity:.1}}
.fxb-blink{animation:fxb-blink 1.2s steps(1) infinite}
@keyframes fxb-fly{from{transform:translateX(-160px)}to{transform:translateX(980px)}}
.fxb-fly{animation:fxb-fly 26s linear infinite}
@keyframes fxb-plate{0%,38%{opacity:.2}50%,74%{opacity:1}86%,100%{opacity:.2}}
.fxb-plate{animation:fxb-plate 8s ease-in-out infinite}
@keyframes fxb-beam{0%,60%{transform:scaleX(0);opacity:0}64%{transform:scaleX(1);opacity:1}74%{transform:scaleX(1);opacity:.9}80%,100%{transform:scaleX(1);opacity:0}}
.fxb-beam{animation:fxb-beam 8s ease-out infinite}
@keyframes fxb-flash{0%,61%,100%{opacity:0}64%{opacity:.26}72%{opacity:.07}}
.fxb-flash{animation:fxb-flash 8s linear infinite}
@keyframes fxb-heave{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-3px) rotate(-1.4deg)}}
.fxb-heave{transform-box:fill-box;transform-origin:50% 100%;animation:fxb-heave 4s ease-in-out infinite}
@keyframes fxb-flow{to{stroke-dashoffset:-60}}
.fxb-flow{animation:fxb-flow 2.4s linear infinite}
@keyframes fxb-arcx{0%{transform:translateX(0)}100%{transform:translateX(var(--dx))}}
.fxb-arcx{animation:fxb-arcx 2.2s linear infinite}
@keyframes fxb-arcy{0%{transform:translateY(0);opacity:1;animation-timing-function:cubic-bezier(.2,.65,.45,1)}45%{transform:translateY(var(--dy));animation-timing-function:cubic-bezier(.55,0,.8,.35)}90%{opacity:1}100%{transform:translateY(70px);opacity:0}}
.fxb-arcy{animation:fxb-arcy 2.2s infinite}
@keyframes fxb-puff{0%{transform:translate(0,0) scale(.5);opacity:0}15%{opacity:.85}100%{transform:translate(var(--dx),-150px) scale(2.6);opacity:0}}
.fxb-puff{transform-box:fill-box;transform-origin:center;animation:fxb-puff 9s ease-out infinite}
@keyframes fxb-rise{0%{transform:translate(0,0);opacity:0}12%{opacity:1}100%{transform:translate(var(--dx),-210px);opacity:0}}
.fxb-rise{animation:fxb-rise 6s linear infinite}
@keyframes fxb-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
.fxb-bob{animation:fxb-bob 6s ease-in-out infinite}
@keyframes fxb-bell{0%,100%{transform:scale(1,1)}45%{transform:scale(1.09,.84)}}
.fxb-bell{transform-box:fill-box;transform-origin:50% 0;animation:fxb-bell 2.2s ease-in-out infinite}
@keyframes fxb-tent{0%,100%{transform:skewX(-7deg)}50%{transform:skewX(7deg)}}
.fxb-tent{transform-box:fill-box;transform-origin:50% 0;animation:fxb-tent 3.4s ease-in-out infinite}
@keyframes fxb-whale{from{transform:translateX(0)}to{transform:translateX(-1250px)}}
.fxb-whale{animation:fxb-whale 70s linear infinite}
@keyframes fxb-snow{from{transform:translate(0,0)}to{transform:translate(var(--dx),260px)}}
.fxb-snow{animation:fxb-snow 22s linear infinite}
@keyframes fxb-infall{0%{transform:rotate(0) scale(1);opacity:0}15%{opacity:1}90%{opacity:.9}100%{transform:rotate(-560deg) scale(.1);opacity:0}}
.fxb-infall{animation:fxb-infall 9s cubic-bezier(.5,0,.9,.6) infinite}
@keyframes fxb-jet{0%,100%{transform:scaleY(.82);opacity:.55}50%{transform:scaleY(1.12);opacity:1}}
.fxb-jet{transform-box:fill-box;transform-origin:50% 100%;animation:fxb-jet 2.4s ease-in-out infinite}
@keyframes fxb-twist{0%,100%{transform:skewX(-7deg)}50%{transform:skewX(6deg)}}
.fxb-twist{transform-box:fill-box;transform-origin:50% 0;animation:fxb-twist 4.2s ease-in-out infinite}
.fxb-jetd{transform-box:fill-box;transform-origin:50% 0;animation:fxb-jet 2.4s ease-in-out infinite}
[data-bjx-off] [class*="fxb-"]{animation-play-state:paused!important}
@media (prefers-reduced-motion:reduce){[class*="fxb-"]{animation:none!important}}
`
if (typeof document !== 'undefined') {
  const el = document.getElementById('bjc-fxb-css') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'bjc-fxb-css' }))
  el.textContent = CSS
}

/* ---------------- helpers ---------------- */

/** a small deterministic random sequence (the same scene every time) */
function seq(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}
/** a four-pointed sparkle at (x, y) */
const sparkle = (x: number, y: number, s: number) => `M${x} ${y - s}Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y}Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s}Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y}Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}Z`
const f1 = (n: number) => n.toFixed(1)
/** the class only while the banner is live */
const on = (live: boolean, cls: string) => (live ? cls : undefined)
/** an animation's place in its loop (seconds already run) and, optionally, its length */
const at = (ago: number, dur?: number, extra: Record<string, string | number> = {}): CSSProperties => ({ animationDelay: `${-ago}s`, ...(dur ? { animationDuration: `${dur}s` } : {}), ...extra }) as CSSProperties
/** whether the player asked for reduced motion (for the SMIL colour cycles, which CSS can't stop) */
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function stars(seed: number, n: number, yMax: number, xMin = 0, xMax = W) {
  const r = seq(seed)
  return Array.from({ length: n }, () => [xMin + r() * (xMax - xMin), r() * yMax, 0.4 + r() * 1.1, 0.25 + r() * 0.7] as const)
}

/** a city skyline: buildings (x, width, height) and their lit windows */
function skyline(seed: number, base: number, from: number, to: number, minH: number, maxH: number, lit = 0.3) {
  const r = seq(seed)
  const blocks: { x: number; w: number; h: number }[] = []
  for (let x = from; x < to; ) {
    const w = 22 + Math.floor(r() * 40)
    blocks.push({ x, w, h: minH + Math.floor(r() * (maxH - minH)) })
    x += w + 2
  }
  const windows: { x: number; y: number; c: number }[] = []
  for (const b of blocks)
    for (let y = base - b.h + 8; y < base - 6; y += 8)
      for (let x = b.x + 4; x < b.x + b.w - 5; x += 7) if (r() < lit) windows.push({ x, y, c: Math.floor(r() * 3) })
  return { blocks, windows, base }
}

/** n points spread evenly round a closed polygon */
function alongPoly(pts: readonly (readonly [number, number])[], n: number) {
  const segs = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length]
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }
  })
  const total = segs.reduce((a, s) => a + s.len, 0)
  return Array.from({ length: n }, (_, k) => {
    let d = (k / n) * total
    for (const s of segs) {
      if (d <= s.len) return [s.p[0] + ((s.q[0] - s.p[0]) * d) / s.len, s.p[1] + ((s.q[1] - s.p[1]) * d) / s.len] as const
      d -= s.len
    }
    return pts[0]
  })
}

/** a jagged lightning bolt from (x, y) downward, with a branch or two */
function bolt(seed: number, x: number, y: number, len: number, lean: number) {
  const r = seq(seed)
  let d = `M${f1(x)} ${f1(y)}`
  let cx = x
  let cy = y
  const branches: string[] = []
  const steps = 9
  for (let i = 1; i <= steps; i++) {
    cx += lean * (len / steps) * 0.35 + (r() - 0.5) * 26
    cy += len / steps
    d += `L${f1(cx)} ${f1(cy)}`
    if (i === 3 || i === 6) {
      let bx = cx
      let by = cy
      let b = `M${f1(bx)} ${f1(by)}`
      for (let j = 0; j < 3; j++) {
        bx += (i === 3 ? -1 : 1) * (10 + r() * 14)
        by += 10 + r() * 10
        b += `L${f1(bx)} ${f1(by)}`
      }
      branches.push(b)
    }
  }
  return { main: d, branches }
}

/* ---------------- Code Rain ---------------- */

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789'
function rain(seed: number, n: number, len: [number, number]) {
  const r = seq(seed)
  return Array.from({ length: n }, (_, i) => {
    const k = len[0] + Math.floor(r() * (len[1] - len[0]))
    return { x: (i + 0.2 + r() * 0.6) * (W / n), chars: Array.from({ length: k }, () => GLYPHS[Math.floor(r() * GLYPHS.length)]), y0: -60 + r() * 150, dur: 3.2 + r() * 4.5, ago: r() * 8 }
  })
}
const RAIN_FAR = rain(3, 30, [8, 14])
const RAIN_MID = rain(7, 17, [9, 14])
const RAIN_NEAR = rain(13, 8, [7, 11])
const MONO = "ui-monospace, 'MS Gothic', 'Osaka-Mono', monospace"
const HEX = Array.from({ length: 6 }, (_, i) => [600 + 74 * Math.cos(((i * 60 - 90) * Math.PI) / 180), 118 + 74 * Math.sin(((i * 60 - 90) * Math.PI) / 180)] as const)

function RainColumn({ c, size, fill, head, live, still }: { c: (typeof RAIN_FAR)[number]; size: number; fill: string; head?: string; live: boolean; still?: boolean }) {
  // `head`: the soft light round the leading glyph (a gradient's url)
  const body = head ? c.chars.slice(0, -1) : c.chars
  return (
    <g transform={`translate(${f1(c.x)} ${f1(c.y0)})`}>
      <g className={still ? undefined : on(live, 'fxb-fall')} style={at(c.ago, c.dur)}>
        <text fontSize={size} fill={fill} fontFamily={MONO} textAnchor="middle">
          {body.map((ch, j) => (
            <tspan key={j} x="0" y={f1(j * size * 1.08)} className={j % 4 === 2 ? on(live, 'fxb-flick') : undefined} style={j % 4 === 2 ? at(j * 0.37) : undefined}>
              {ch}
            </tspan>
          ))}
        </text>
        {head && (
          <>
            <circle cx="0" cy={f1(body.length * size * 1.08 - size * 0.35)} r={size * 0.8} fill={head} />
            <text x="0" y={f1(body.length * size * 1.08)} fontSize={size} fill="#eafff1" fontFamily={MONO} textAnchor="middle">
              {c.chars[c.chars.length - 1]}
            </text>
          </>
        )}
      </g>
    </g>
  )
}

function codeRain(u: string, live: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#010805" />
          <stop offset="1" stopColor="#03180d" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="600" cy="118" r="300">
          <stop offset="0" stopColor="#1bff74" stopOpacity=".26" />
          <stop offset="1" stopColor="#1bff74" stopOpacity="0" />
        </radialGradient>
        {(
          [
            ['f', '#0c5a2c', 0.5],
            ['m', '#17b552', 0.85],
            ['n', '#3dff8a', 1],
          ] as const
        ).map(([k, c, o]) => (
          <linearGradient key={k} id={`${u}${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c} stopOpacity="0" />
            <stop offset=".55" stopColor={c} stopOpacity={o * 0.55} />
            <stop offset="1" stopColor={c} stopOpacity={o} />
          </linearGradient>
        ))}
        <radialGradient id={`${u}d`}>
          <stop offset="0" stopColor="#b6ffd2" stopOpacity=".55" />
          <stop offset="1" stopColor="#3dff8a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7dffb0" stopOpacity="0" />
          <stop offset=".5" stopColor="#c9ffdc" stopOpacity=".9" />
          <stop offset="1" stopColor="#7dffb0" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${u}h`}>
          <polygon points={HEX.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')} />
        </clipPath>
        <pattern id={`${u}l`} width="4" height="3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="#000" fillOpacity=".28" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      {RAIN_FAR.map((c, i) => (
        <RainColumn key={`f${i}`} c={c} size={9} fill={`url(#${u}f)`} live={live} still />
      ))}
      {RAIN_MID.map((c, i) => (
        <RainColumn key={`m${i}`} c={c} size={12.5} fill={`url(#${u}m)`} head={`url(#${u}d)`} live={live} />
      ))}
      {/* the emblem: the Boje gem as a wireframe, a scan line passing down it */}
      <g>
        <polygon points={HEX.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')} fill="#021409" fillOpacity=".82" stroke="#3dff8a" strokeOpacity=".25" strokeWidth="9" />
        <g className={on(live, 'fxb-pulse')}>
          <polygon points={HEX.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')} fill="none" stroke="#5dffa0" strokeWidth="2.2" />
          {HEX.map(([x, y], i) => (
            <path key={i} d={`M600 118L${f1(x)} ${f1(y)}`} stroke="#3dff8a" strokeOpacity=".35" strokeWidth="1" />
          ))}
          <polygon points={HEX.map(([x, y]) => `${f1(600 + (x - 600) * 0.6)},${f1(118 + (y - 118) * 0.6)}`).join(' ')} fill="none" stroke="#3dff8a" strokeOpacity=".5" strokeWidth="1.2" />
        </g>
        <text x="600" y="138" textAnchor="middle" fontSize="62" fontWeight="900" fill="#03200f" stroke="#7dffb0" strokeWidth="2" fontFamily="Manrope, sans-serif">
          B
        </text>
        <g clipPath={`url(#${u}h)`}>
          <rect className={on(live, 'fxb-scan')} x="520" y="108" width="160" height="22" fill={`url(#${u}s)`} opacity=".55" />
        </g>
        <circle cx="600" cy="118" r="92" fill="none" stroke="#3dff8a" strokeOpacity=".4" strokeWidth="1.4" strokeDasharray="3 7 18 7" className={on(live, 'fxb-spin')} style={{ transformOrigin: '600px 118px' }} />
        <circle cx="600" cy="118" r="101" fill="none" stroke="#3dff8a" strokeOpacity=".18" strokeWidth="1" strokeDasharray="1 5" className={on(live, 'fxb-spinr')} style={{ transformOrigin: '600px 118px', animationDuration: '34s' }} />
      </g>
      {RAIN_NEAR.map((c, i) => (
        <RainColumn key={`n${i}`} c={c} size={17} fill={`url(#${u}n)`} head={`url(#${u}d)`} live={live} />
      ))}
      <rect width={W} height={H} fill={`url(#${u}l)`} />
    </>
  )
}

/* ---------------- Sakura ---------------- */

const SAKURA_BLOOMS = (() => {
  const r = seq(29)
  // clusters along the branch, thicker towards its tips
  const anchors: [number, number, number][] = [
    [70, 26, 20], [120, 44, 18], [168, 30, 22], [214, 52, 20], [262, 40, 22], [300, 64, 18], [342, 50, 16], [150, 70, 14], [236, 84, 14], [36, 54, 16], [386, 70, 12],
  ]
  const out: { x: number; y: number; r: number; c: number }[] = []
  for (const [ax, ay, s] of anchors)
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * s
      out.push({ x: ax + Math.cos(a) * d, y: ay + Math.sin(a) * d * 0.8, r: 2.6 + r() * 3.6, c: Math.floor(r() * 4) })
    }
  return out
})()
const BLOOM = ['#ffd3e6', '#ffa9cf', '#ff86bb', '#fff0f6']
const PETALS = (() => {
  const r = seq(31)
  return Array.from({ length: 26 }, () => ({ x: 60 + r() * 820, y: -30 + r() * 230, s: 0.7 + r() * 0.8, dx: -(170 + r() * 150), dy: 110 + r() * 110, rot: 180 + r() * 360, dur: 8 + r() * 6, ago: r() * 14, c: Math.floor(r() * 3) }))
})()
const SAKURA_STARS = stars(37, 34, 120, 380, 800)

function sakura(u: string, live: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#130a2b" />
          <stop offset=".55" stopColor="#3c1650" />
          <stop offset="1" stopColor="#7a2a61" />
        </linearGradient>
        <radialGradient id={`${u}m`} cx=".42" cy=".38" r=".7">
          <stop offset="0" stopColor="#fffaf3" />
          <stop offset=".7" stopColor="#ffe6ee" />
          <stop offset="1" stopColor="#ffc4d9" />
        </radialGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="612" cy="86" r="150">
          <stop offset="0" stopColor="#ffd0e4" stopOpacity=".55" />
          <stop offset=".45" stopColor="#ff9cc8" stopOpacity=".16" />
          <stop offset="1" stopColor="#ff9cc8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a1450" />
          <stop offset="1" stopColor="#10061c" />
        </linearGradient>
        <radialGradient id={`${u}l`}>
          <stop offset="0" stopColor="#ffd28a" stopOpacity=".9" />
          <stop offset="1" stopColor="#ff8a4c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}p`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff2f8" />
          <stop offset="1" stopColor="#ff9cc8" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      {SAKURA_STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={f1(x)} cy={f1(y)} r={r * 0.7} fill="#fff" opacity={o * 0.7} />
      ))}
      <circle cx="612" cy="86" r="150" fill={`url(#${u}g)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '6s' }} />
      <circle cx="612" cy="86" r="50" fill={`url(#${u}m)`} />
      <g fill="#e9b9cc" opacity=".35">
        <circle cx="596" cy="74" r="9" />
        <circle cx="628" cy="98" r="6" />
        <circle cx="618" cy="66" r="4" />
        <circle cx="598" cy="104" r="4.5" />
      </g>
      {/* mountains, the far shore, the pagoda */}
      <path d="M0 178C60 160 100 140 160 150S260 128 320 146 420 122 500 140 600 126 680 146 760 132 800 140V240H0Z" fill="#3a1a52" opacity=".9" />
      <path d="M380 204C440 190 500 176 560 182S660 168 720 182 780 186 800 184V240H380Z" fill="#200c2c" />
      <g transform="translate(694 0)" fill="#170822">
        <rect x="-4" y="104" width="8" height="12" />
        <path d="M-1.5 96h3l1 10h-5Z" />
        {[0, 1, 2, 3].map((i) => {
          const y = 116 + i * 17
          const w = 22 + i * 7
          return (
            <g key={i}>
              <rect x={-w * 0.62} y={y} width={w * 1.24} height="13" />
              <path d={`M${-w - 6} ${y + 2}Q${-w * 0.4} ${y - 2} 0 ${y - 7}Q${w * 0.4} ${y - 2} ${w + 6} ${y + 2}L${w - 2} ${y + 5}H${-w + 2}Z`} />
              <rect x={-w * 0.36} y={y + 5} width="4" height="4" fill="#ffb86b" opacity=".85" />
              <rect x={w * 0.2} y={y + 5} width="4" height="4" fill="#ffb86b" opacity=".6" />
            </g>
          )
        })}
        <rect x={-45} y="184" width="90" height="6" />
      </g>
      {/* the bay, the moon's road on the water */}
      <rect y="205" width={W} height="35" fill={`url(#${u}w)`} />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} className={on(live, 'fxb-shimmer')} style={at(i * 0.45)} x={612 - (34 - i * 2.4)} y={209 + i * 3.8} width={(34 - i * 2.4) * 2} height="1.6" rx=".8" fill="#ffd6e8" opacity={0.75 - i * 0.06} />
      ))}
      {[
        [520, 214, 0],
        [700, 210, 5],
        [760, 222, 10],
      ].map(([x, y, ago], i) => (
        <g key={i} className={on(live, 'fxb-lantern')} style={at(ago)}>
          <circle cx={x} cy={y - 8} r="14" fill={`url(#${u}l)`} />
          <rect x={x - 3.5} y={y - 13} width="7" height="9" rx="2" fill="#ffcf7a" />
        </g>
      ))}
      {/* the branch over the top left, in bloom */}
      <g fill="none" stroke="#2a0d24" strokeLinecap="round">
        <path d="M-20 18C60 22 120 40 190 40S320 58 400 74" strokeWidth="9" />
        <path d="M120 38C140 56 150 66 156 76M240 46C232 62 238 76 240 88M320 58C332 48 344 44 352 46M60 22C52 34 44 46 36 56" strokeWidth="4.5" />
      </g>
      {SAKURA_BLOOMS.map((b, i) => (
        <circle key={i} cx={f1(b.x)} cy={f1(b.y)} r={f1(b.r)} fill={BLOOM[b.c]} opacity=".95" />
      ))}
      {SAKURA_BLOOMS.filter((_, i) => i % 7 === 0).map((b, i) => (
        <circle key={i} cx={f1(b.x - b.r * 0.3)} cy={f1(b.y - b.r * 0.3)} r={f1(b.r * 0.35)} fill="#fff" opacity=".8" />
      ))}
      {PETALS.map((p, i) => (
        <g key={i} transform={`translate(${f1(p.x)} ${f1(p.y)}) scale(${p.s.toFixed(2)})`}>
          <g className={on(live, 'fxb-petal')} style={at(p.ago, p.dur, { '--dx': `${f1(p.dx / p.s)}px`, '--dy': `${f1(p.dy / p.s)}px`, '--r': `${Math.round(p.rot)}deg` })}>
            <path className={on(live, 'fxb-flut')} style={at(i * 0.21, 1.2 + (i % 4) * 0.3)} d="M0 -5C3.6 -5 5 -1 0 5.4C-5 -1 -3.6 -5 0 -5Z" fill={p.c === 0 ? `url(#${u}p)` : BLOOM[p.c]} />
          </g>
        </g>
      ))}
    </>
  )
}

/* ---------------- Hyperspace ---------------- */

const WARP_TONES = ['#ffffff', '#cfe8ff', '#8fd0ff', '#b9a6ff', '#7ff3ff']
const WARP = (() => {
  const r = seq(43)
  return Array.from({ length: 64 }, (_, i) => ({ a: (i / 64) * 360 + r() * 5, r0: 14 + r() * 40, len: 40 + r() * 110, w: 0.8 + r() * 1.8, c: Math.floor(r() * WARP_TONES.length), dur: 1.1 + r() * 1.3, ago: r() * 2.4, still: 0.35 + r() * 1.5 }))
})()
const WARP_STARS = stars(47, 70, H)

function hyperspace(u: string, live: boolean) {
  return (
    <>
      <defs>
        <radialGradient id={`${u}a`} gradientUnits="userSpaceOnUse" cx="560" cy="120" r="520">
          <stop offset="0" stopColor="#21307a" />
          <stop offset=".35" stopColor="#0d1440" />
          <stop offset="1" stopColor="#03050f" />
        </radialGradient>
        <radialGradient id={`${u}v`} gradientUnits="userSpaceOnUse" cx="160" cy="200" r="300">
          <stop offset="0" stopColor="#8a3dff" stopOpacity=".3" />
          <stop offset="1" stopColor="#8a3dff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}c`} gradientUnits="userSpaceOnUse" cx="560" cy="120" r="70">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".2" stopColor="#dff1ff" stopOpacity=".9" />
          <stop offset=".55" stopColor="#5fb8ff" stopOpacity=".3" />
          <stop offset="1" stopColor="#5fb8ff" stopOpacity="0" />
        </radialGradient>
        {WARP_TONES.map((c, k) => (
          <linearGradient key={k} id={`${u}s${k}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={c} stopOpacity="0" />
            <stop offset="1" stopColor={c} stopOpacity="1" />
          </linearGradient>
        ))}
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7fd6ff" stopOpacity="0" />
          <stop offset=".5" stopColor="#e6f6ff" stopOpacity=".9" />
          <stop offset="1" stopColor="#7fd6ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}v)`} />
      {WARP_STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={f1(x)} cy={f1(y)} r={r * 0.6} fill="#dfefff" opacity={o * 0.6} />
      ))}
      {[0, 0.75, 1.5, 2.25].map((ago, i) => (
        <ellipse key={i} cx="560" cy="120" rx="60" ry="40" fill="none" stroke="#7fe3ff" strokeOpacity=".5" strokeWidth="1.2" className={on(live, 'fxb-ring')} style={{ ...at(ago), transformOrigin: '560px 120px' }} transform={live ? undefined : `translate(560 120) scale(${1 + i * 0.7}) translate(-560 -120)`} opacity={live ? undefined : 0.5 - i * 0.1} />
      ))}
      <g transform="translate(560 120)">
        {WARP.map((s, i) => (
          <g key={i} transform={`rotate(${s.a.toFixed(1)})`}>
            <g className={on(live, 'fxb-warp')} style={at(s.ago, s.dur)} transform={live ? undefined : `scale(${s.still.toFixed(2)})`}>
              <rect x={f1(s.r0)} y={f1(-s.w / 2)} width={f1(s.len)} height={f1(s.w)} rx={f1(s.w / 2)} fill={`url(#${u}s${s.c})`} opacity=".95" />
              <rect x={f1(s.r0 + s.len - 3)} y={f1(-s.w / 2)} width="3" height={f1(s.w)} rx={f1(s.w / 2)} fill={WARP_TONES[s.c]} />
            </g>
          </g>
        ))}
      </g>
      <circle cx="560" cy="120" r="70" fill={`url(#${u}c)`} className={on(live, 'fxb-breathe')} style={{ animationDuration: '1.4s' }} />
      <ellipse cx="560" cy="120" rx="250" ry="2.2" fill={`url(#${u}f)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '1.1s' }} />
      <ellipse cx="560" cy="120" rx="70" ry="1.6" fill={`url(#${u}f)`} opacity=".3" transform="rotate(90 560 120)" />
      {/* the cockpit's frame, dark against the light */}
      <path d="M0 0H170L120 22C70 30 30 50 0 78Z" fill="#02030a" opacity=".85" />
      <path d="M0 240V196C40 206 90 214 150 218L200 240Z" fill="#02030a" opacity=".85" />
      <path d="M800 0H660L700 18C740 26 776 44 800 62Z" fill="#02030a" opacity=".85" />
      <path d="M170 0 120 22C70 30 30 50 0 78" fill="none" stroke="#5fb8ff" strokeOpacity=".35" strokeWidth="1.5" />
      <path d="M660 0 700 18C740 26 776 44 800 62" fill="none" stroke="#5fb8ff" strokeOpacity=".35" strokeWidth="1.5" />
    </>
  )
}

/* ---------------- Synthwave ---------------- */

const SYNTH_STARS = stars(53, 46, 110)
const MOUNT_L: [number, number][] = [[-10, 150], [30, 112], [70, 132], [130, 80], [190, 128], [240, 100], [300, 150]]
const MOUNT_R: [number, number][] = [[620, 150], [670, 108], [710, 126], [756, 86], [800, 120], [820, 150]]

function palm(x: number, s: number, flip: boolean, live: boolean, ago: number) {
  return (
    <g transform={`translate(${x} 150) scale(${flip ? -s : s} ${s})`} fill="#0a0216">
      <path d="M-3 0C0 -30 4 -60 12 -92L16 -91C9 -60 6 -30 4 0Z" />
      <g className={on(live, 'fxb-sway')} style={{ ...at(ago, 4.5), transformOrigin: '14px -92px', transformBox: 'view-box' }}>
        <path d="M14 -92C-4 -104 -26 -98 -40 -82-22 -92-6 -94 14 -88ZM14 -92C30 -108 54 -106 66 -92 48 -100 32 -98 14 -88ZM14 -92C4 -112-16 -118-32 -114-14 -108 0 -102 12 -90ZM14 -92C28 -86 40 -72 44 -56 32 -72 22 -80 12 -86ZM14 -92C4 -80-6 -72-18 -56-10 -74 0 -86 12 -90Z" />
      </g>
    </g>
  )
}

function synthwave(u: string, live: boolean) {
  const vp = 560
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c0220" />
          <stop offset=".38" stopColor="#2a0a4c" />
          <stop offset=".54" stopColor="#6b1872" />
          <stop offset=".625" stopColor="#ff3d8f" />
          <stop offset=".626" stopColor="#14002c" />
          <stop offset="1" stopColor="#2d0048" />
        </linearGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff27a" />
          <stop offset=".45" stopColor="#ff9a3d" />
          <stop offset=".8" stopColor="#ff3d8f" />
          <stop offset="1" stopColor="#d4147a" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx={vp} cy="130" r="220">
          <stop offset="0" stopColor="#ff5fa2" stopOpacity=".55" />
          <stop offset="1" stopColor="#ff5fa2" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}r`} gradientUnits="userSpaceOnUse" cx={vp} cy="150" r="170" gradientTransform={`translate(0 150) scale(1 .5) translate(0 -150)`}>
          <stop offset="0" stopColor="#ff8fc0" stopOpacity=".6" />
          <stop offset="1" stopColor="#ff5fa2" stopOpacity="0" />
        </radialGradient>
        <mask id={`${u}m`}>
          <rect width={W} height={H} fill="#fff" />
          {[0, 0.8, 1.6, 2.4, 3.2].map((ago, i) => (
            <rect key={i} className={on(live, 'fxb-gap')} style={at(ago)} x={vp - 90} y="94" width="180" height="5" fill="#000" transform={live ? undefined : `translate(0 ${i * 11}) translate(0 ${94 + 2.5}) scale(1 ${0.3 + i * 0.25}) translate(0 ${-94 - 2.5})`} />
          ))}
        </mask>
        <clipPath id={`${u}c`}>
          <rect width={W} height="150" />
        </clipPath>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      {SYNTH_STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={f1(x)} cy={f1(y)} r={r * 0.7} fill="#fff" opacity={o * 0.75} />
      ))}
      {[
        [120, 30, 0],
        [380, 52, 1.2],
        [700, 24, 2],
      ].map(([x, y, ago]) => (
        <path key={x} className={on(live, 'fxb-tw')} style={at(ago)} d={sparkle(x, y, 4.5)} fill="#fff" />
      ))}
      <path className={on(live, 'fxb-shoot')} d="M210 18l-46 -14" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity={live ? undefined : 0} />
      <circle cx={vp} cy="130" r="220" fill={`url(#${u}g)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '4s' }} />
      <g clipPath={`url(#${u}c)`}>
        <circle cx={vp} cy="132" r="82" fill={`url(#${u}s)`} mask={`url(#${u}m)`} />
      </g>
      {[MOUNT_L, MOUNT_R].map((m, k) => (
        <g key={k}>
          <polygon points={m.map(([x, y]) => `${x},${y}`).join(' ')} fill="#13042a" />
          <polyline points={m.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#2de2e6" strokeOpacity=".3" strokeWidth="5" strokeLinejoin="round" />
          <polyline points={m.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#9ff8fa" strokeWidth="1.4" strokeLinejoin="round" />
          {m.slice(1, -1).map(([x, y], i) => (
            <path key={i} d={`M${x} ${y}L${x + (i % 2 ? 18 : -18)} 150M${x} ${y}L${x + 4} 150`} stroke="#2de2e6" strokeOpacity=".28" strokeWidth="1" />
          ))}
        </g>
      ))}
      {/* the floor: lines to the vanishing point, and the cross lines coming at you */}
      <rect y="150" width={W} height="90" fill="#14002c" />
      <rect y="150" width={W} height="90" fill={`url(#${u}r)`} />
      <g stroke="#ff3d8f" strokeWidth="1.3">
        {Array.from({ length: 31 }, (_, i) => {
          const k = i - 15
          return <path key={i} d={`M${vp + k * 9} 150L${vp + k * 70} 240`} strokeOpacity={0.75 - Math.abs(k) * 0.02} />
        })}
      </g>
      <g transform="translate(0 150)">
        {Array.from({ length: 9 }, (_, i) => (
          <g key={i} className={on(live, 'fxb-grid')} style={at((i / 9) * 3.6)} transform={live ? undefined : `translate(0 ${f1(Math.pow(i / 9, 2) * 92)})`}>
            <path d="M0 0H800" stroke="#ff5fa2" strokeOpacity=".35" strokeWidth="4" />
            <path d="M0 0H800" stroke="#ffb0d3" strokeWidth="1.2" />
          </g>
        ))}
      </g>
      <path d="M0 150H800" stroke="#ff8fc0" strokeWidth="2" />
      <path d="M0 150H800" stroke="#ff3d8f" strokeOpacity=".4" strokeWidth="7" />
      {palm(52, 0.95, false, live, 0)}
      {palm(770, 1.15, true, live, 1.6)}
    </>
  )
}

/* ---------------- Vegas Lights ---------------- */

const SIGN: [number, number][] = [[436, 106], [468, 62], [514, 54], [560, 51], [606, 54], [652, 62], [684, 106], [652, 150], [606, 158], [560, 161], [514, 158], [468, 150]]
const SIGN_INNER = SIGN.map(([x, y]) => [560 + (x - 560) * 0.93, 106 + (y - 106) * 0.84] as const)
const SIGN_BULBS = alongPoly(SIGN_INNER, 44)
const ARROW: [number, number][] = [[214, 92], [328, 92], [328, 74], [374, 106], [328, 138], [328, 120], [214, 120]]
const ARROW_BULBS = alongPoly(ARROW, 26)
const VEGAS_FAR = skyline(59, 240, -10, 820, 40, 110, 0.22)
const VEGAS_NEAR = skyline(61, 240, -20, 830, 18, 62, 0.35)

function vegas(u: string, live: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#090420" />
          <stop offset=".7" stopColor="#24093e" />
          <stop offset="1" stopColor="#3e0c44" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="560" cy="110" r="260">
          <stop offset="0" stopColor="#ffb648" stopOpacity=".3" />
          <stop offset="1" stopColor="#ff3fa0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}b`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b3c6e" />
          <stop offset="1" stopColor="#0d1f3f" />
        </linearGradient>
        <linearGradient id={`${u}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset=".5" stopColor="#ffc93d" />
          <stop offset="1" stopColor="#ff8a1f" />
        </linearGradient>
        <radialGradient id={`${u}k`}>
          <stop offset="0" stopColor="#fff3c4" stopOpacity=".9" />
          <stop offset="1" stopColor="#ffb648" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      {[
        [120, 9, 0],
        [300, 11, 2.3],
        [790, 8, 4.4],
      ].map(([x, dur, ago]) => (
        <g key={x} className={on(live, 'fxb-sweep')} style={{ ...at(ago, dur), transformOrigin: `${x}px 240px` }} transform={live ? undefined : `rotate(${x < 400 ? 14 : -18} ${x} 240)`}>
          <path d={`M${x - 4} 240L${x - 70} -40H${x + 70}L${x + 4} 240Z`} fill={`url(#${u}b)`} opacity=".22" />
        </g>
      ))}
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      {VEGAS_FAR.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={240 - b.h} width={b.w} height={b.h} fill="#1a0b33" />
      ))}
      {VEGAS_FAR.windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="2.6" height="3" fill={['#ffd36e', '#ff7bd5', '#6ff3ff'][w.c]} opacity=".55" />
      ))}
      {/* the arrow pointing at the sign, its bulbs chasing in */}
      <g transform="translate(0 16)">
        <polygon points={ARROW.map(([x, y]) => `${x},${y}`).join(' ')} fill="#2a0b36" stroke="#ff3fa0" strokeOpacity=".5" strokeWidth="3" strokeLinejoin="round" />
        {ARROW_BULBS.map(([x, y], i) => (
          <circle key={i} className={on(live, 'fxb-chase')} style={at(1 - (i % 8) / 8, 0.8)} cx={f1(x)} cy={f1(y)} r="2.6" fill="#ffe9a8" />
        ))}
      </g>
      {/* the sign: posts, the face, the bulbs, the star */}
      <rect x="533" y="168" width="8" height="72" fill="#3a2156" />
      <rect x="579" y="168" width="8" height="72" fill="#3a2156" />
      <g transform="translate(560 128) scale(.84) translate(-560 -106)">
      <g className={on(live, 'fxb-spin')} style={{ transformOrigin: '560px 30px', animationDuration: '14s' }}>
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M560 30L556 -6H564Z" fill="#ffe28f" opacity=".45" transform={`rotate(${i * 30} 560 30)`} />
        ))}
      </g>
      <circle cx="560" cy="30" r="22" fill={`url(#${u}k)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '1.6s' }} />
      <path d="M560 12 565 25 578 30 565 35 560 48 555 35 542 30 555 25Z" fill="#ffd34f" stroke="#a8560c" strokeWidth="1" />
      <rect x="556" y="44" width="8" height="10" fill="#c41f5a" />
      <polygon points={SIGN.map(([x, y]) => `${x},${y}`).join(' ')} fill="#ff3fa0" opacity=".25" transform="translate(560 106) scale(1.06) translate(-560 -106)" />
      <polygon points={SIGN.map(([x, y]) => `${x},${y}`).join(' ')} fill={`url(#${u}f)`} stroke="#fff4dc" strokeWidth="3" strokeLinejoin="round" />
      {SIGN_BULBS.map(([x, y], i) => (
        <g key={i} className={on(live, 'fxb-chase')} style={at(1 - (i % 4) / 4, 0.6)}>
          <circle cx={f1(x)} cy={f1(y)} r="5" fill="#ffe28f" opacity=".3" />
          <circle cx={f1(x)} cy={f1(y)} r="2.4" fill="#fffbe6" />
        </g>
      ))}
      {['B', 'O', 'J', 'E'].map((ch, i) => (
        <g key={ch} transform={`translate(${515 + i * 30} 84)`}>
          <circle r="12" fill="#fff8ea" stroke="#c41f5a" strokeWidth="1.5" />
          <text y="5.4" textAnchor="middle" fontSize="15" fontWeight="900" fill="#d0213a" fontFamily="Manrope, sans-serif">
            {ch}
          </text>
        </g>
      ))}
      <text x="560" y="130" textAnchor="middle" fontSize="27" fontWeight="900" letterSpacing="2" fill={`url(#${u}t)`} stroke="#7a0c2a" strokeWidth="1.2" fontFamily="Manrope, sans-serif">
        CASINO
      </text>
      <text x="560" y="145" textAnchor="middle" fontSize="8.5" fontWeight="800" letterSpacing="2.4" fill="#ff8fd2" fontFamily="Manrope, sans-serif" className={on(live, 'fxb-pulse')} style={{ animationDuration: '1.2s' }}>
        ★ LUCKY NIGHTS ★
      </text>
      </g>
      {VEGAS_NEAR.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={240 - b.h} width={b.w} height={b.h} fill="#0d0520" />
      ))}
      {VEGAS_NEAR.windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="2.6" height="3" fill={['#ffd36e', '#ff7bd5', '#6ff3ff'][w.c]} opacity=".7" />
      ))}
    </>
  )
}

/* ---------------- Supercell ---------------- */

const BOLT_A = bolt(67, 470, 70, 150, 0.4)
const BOLT_B = bolt(71, 700, 60, 160, -0.5)
/** the storm's turning cloud: puffs set round three rings (drawn in a flattened group, so they turn like a tilted disk) */
const MESO = (() => {
  const r = seq(73)
  const out: { x: number; y: number; r: number; k: number }[] = []
  for (const [rad, n, size] of [
    [250, 22, 46],
    [178, 18, 40],
    [108, 13, 34],
  ] as const)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3
      const d = rad + (r() - 0.5) * 30
      out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: size * (0.75 + r() * 0.5), k: Math.floor(r() * 3) })
    }
  return out
})()
const SCUD = (() => {
  const r = seq(79)
  return Array.from({ length: 7 }, (_, i) => ({ x: -40 + i * 130 + r() * 50, y: 100 + r() * 40, rx: 50 + r() * 40, ry: 9 + r() * 6, dx: 30 + r() * 50, ago: r() * 18 }))
})()

function supercell(u: string, live: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05080d" />
          <stop offset=".5" stopColor="#17222c" />
          <stop offset=".8" stopColor="#3d5458" />
          <stop offset="1" stopColor="#24343a" />
        </linearGradient>
        <radialGradient id={`${u}h`} gradientUnits="userSpaceOnUse" cx="560" cy="196" r="420">
          <stop offset="0" stopColor="#9fc2b8" stopOpacity=".45" />
          <stop offset="1" stopColor="#9fc2b8" stopOpacity="0" />
        </radialGradient>
        {(
          [
            ['p0', '#5a6b78', '#2c3946'],
            ['p1', '#46566a', '#222e3b'],
            ['p2', '#6b7c88', '#34424f'],
          ] as const
        ).map(([k, a, b]) => (
          <radialGradient key={k} id={`${u}${k}`} cx=".45" cy=".35" r=".6">
            <stop offset="0" stopColor={a} />
            <stop offset=".6" stopColor={b} stopOpacity=".85" />
            <stop offset="1" stopColor={b} stopOpacity="0" />
          </radialGradient>
        ))}
        <linearGradient id={`${u}u`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e2934" />
          <stop offset="1" stopColor="#0d141b" />
        </linearGradient>
        <linearGradient id={`${u}t`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1a222a" stopOpacity=".2" />
          <stop offset=".5" stopColor="#2a353f" stopOpacity=".9" />
          <stop offset="1" stopColor="#1a222a" stopOpacity=".2" />
        </linearGradient>
        <radialGradient id={`${u}f`} gradientUnits="userSpaceOnUse" cx="560" cy="80" r="420">
          <stop offset="0" stopColor="#d6ecff" stopOpacity=".85" />
          <stop offset="1" stopColor="#8fb8ff" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${u}r`} width="60" height="120" patternUnits="userSpaceOnUse">
          {[
            [6, 4, 22],
            [22, 60, 16],
            [38, 30, 24],
            [52, 88, 18],
            [14, 100, 14],
            [44, 2, 12],
          ].map(([x, y, l], i) => (
            <path key={i} d={`M${x} ${y}v${l}`} stroke="#b8d4ec" strokeOpacity=".4" strokeWidth="1" />
          ))}
        </pattern>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}h)`} />
      <rect width={W} height={H} fill={`url(#${u}f)`} className={on(live, 'fxb-bolt')} style={at(0, 4.6)} opacity={live ? undefined : 0.12} />
      <rect width={W} height={H} fill={`url(#${u}f)`} className={on(live, 'fxb-bolt')} style={at(2.1, 6.7)} opacity={live ? undefined : 0} />
      {/* the supercell: a dark underside, its turning bank of cloud, the shelf's striations */}
      <ellipse cx="560" cy="70" rx="330" ry="58" fill={`url(#${u}u)`} />
      <g transform="translate(560 62) scale(1 .3)">
        <g className={on(live, 'fxb-spin')} style={{ animationDuration: '46s' }}>
          {MESO.map((p, i) => (
            <circle key={i} cx={f1(p.x)} cy={f1(p.y)} r={f1(p.r)} fill={`url(#${u}p${p.k})`} />
          ))}
        </g>
      </g>
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${300 + i * 26} ${84 + i * 9}A${260 - i * 26} ${40 - i * 5} 0 0 0 ${820 - i * 26} ${84 + i * 9}`} fill="none" stroke="#8ea2ad" strokeOpacity={0.3 - i * 0.06} strokeWidth={3 - i * 0.6} />
      ))}
      {/* the wall cloud lowering under it, and a funnel reaching down from it */}
      <path d="M492 96C500 112 512 122 530 128H594C612 122 622 112 630 96Z" fill="#141c25" />
      <g className={on(live, 'fxb-twist')}>
        <path d="M534 126C546 150 552 176 552 214H560C562 176 570 150 588 126Z" fill={`url(#${u}t)`} />
        <path d="M548 130C554 160 556 186 556 214" fill="none" stroke="#3a4752" strokeOpacity=".7" strokeWidth="2" />
      </g>
      <ellipse cx="556" cy="212" rx="26" ry="7" fill="#2a353f" opacity=".7" className={on(live, 'fxb-breathe')} style={{ animationDuration: '1.6s' }} />
      {SCUD.map((c, i) => (
        <g key={i} className={on(live, 'fxb-drift')} style={at(c.ago, 14 + i * 2, { '--dx': `${f1(c.dx)}px` })}>
          <ellipse cx={f1(c.x)} cy={f1(c.y)} rx={f1(c.rx)} ry={f1(c.ry)} fill={`url(#${u}p1)`} opacity=".7" />
        </g>
      ))}
      {[BOLT_A, BOLT_B].map((b, i) => (
        <g key={i} className={on(live, 'fxb-bolt')} style={i ? at(2.1, 6.7) : at(0, 4.6)} opacity={live ? undefined : i ? 0 : 1}>
          <path d={b.main} fill="none" stroke="#8fc8ff" strokeOpacity=".35" strokeWidth="8" strokeLinejoin="round" />
          {b.branches.map((d, j) => (
            <path key={j} d={d} fill="none" stroke="#cfe6ff" strokeWidth="1.4" strokeLinejoin="round" />
          ))}
          <path d={b.main} fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinejoin="round" />
        </g>
      ))}
      {/* rain, slanting: a tile of streaks sliding down its own height */}
      <g transform="rotate(14 400 120)">
        <rect className={on(live, 'fxb-rain')} x="-80" y="-180" width="960" height="480" fill={`url(#${u}r)`} />
      </g>
      {/* the field: a farm, a windmill turning in the wind, trees bending */}
      <path d="M0 214C120 206 240 216 360 210S600 204 800 212V240H0Z" fill="#0b1116" />
      <g fill="#060a0e">
        <path d="M150 222 158 150H166L174 222Z" />
        <g className={on(live, 'fxb-spin')} style={{ transformOrigin: '162px 150px', animationDuration: '3s' }}>
          {[0, 90, 180, 270].map((a) => (
            <path key={a} d="M162 150 160 112H164Z M158 116h8v22h-8Z" transform={`rotate(${a} 162 150)`} />
          ))}
        </g>
        <circle cx="162" cy="150" r="4" />
        <path d="M228 222V196L250 180 272 196V222Z" />
        <rect x="240" y="204" width="8" height="8" fill="#ffcf7a" opacity=".85" />
        <path d="M280 222V202H316V222Z" />
        <path d="M330 222V214M360 222V214M390 222V214M330 216H400" stroke="#060a0e" strokeWidth="2" />
        {[690, 722, 756, 782].map((x, i) => (
          <g key={x} className={on(live, 'fxb-sway')} style={at(i * 0.3, 1.6 + i * 0.2)}>
            <path d={`M${x - 2} 222V196H${x + 2}V222Z`} />
            <ellipse cx={x} cy={186} rx={11 + (i % 2) * 3} ry={16 + (i % 2) * 4} />
          </g>
        ))}
      </g>
    </>
  )
}

/* ---------------- Kaiju City ---------------- */

const KJ_BACK = skyline(79, 206, -10, 820, 54, 130, 0.25)
const KJ_FRONT = skyline(83, 206, -20, 830, 24, 74, 0.32)
/** Rexor's spine from the back of the head down to the tail: its dorsal plates stand on it, square to it */
const SPINE: [number, number][] = [[642, 60], [660, 72], [679, 88], [697, 106], [713, 124], [727, 142], [740, 160], [752, 178], [764, 196]]
const PLATES = SPINE.map(([x, y], i) => {
  const [nx, ny] = SPINE[Math.min(i + 1, SPINE.length - 1)]
  const [px, py] = SPINE[Math.max(i - 1, 0)]
  return { x, y, a: (Math.atan2(ny - py, nx - px) * 180) / Math.PI, s: [13, 17, 20, 21, 20, 17, 14, 11, 9][i] }
})
const plate = (s: number) => `M${f1(-s * 0.42)} 3Q${f1(-s * 0.34)} ${f1(-s * 0.55)} 0 ${-s}Q${f1(s * 0.34)} ${f1(-s * 0.55)} ${f1(s * 0.42)} 3Z`
const REXOR =
  'M624 206C618 186 614 166 616 148 618 132 622 118 618 106 614 100 604 98 596 98L572 96C563 95 556 92 556 88L586 86 602 82 566 79C558 78 552 75 552 70 552 64 562 58 578 56 596 52 618 52 634 55 646 57 654 63 660 70 674 84 690 98 704 112 724 132 740 156 752 178 760 192 774 202 800 204V206Z'

function kaijuCity(u: string, live: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#050a1a" />
          <stop offset=".7" stopColor="#14223f" />
          <stop offset="1" stopColor="#24305a" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="680" cy="110" r="230">
          <stop offset="0" stopColor="#5fe0ff" stopOpacity=".26" />
          <stop offset="1" stopColor="#5fe0ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}k`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#2f6b4f" />
          <stop offset=".45" stopColor="#1b4433" />
          <stop offset="1" stopColor="#0a1d15" />
        </linearGradient>
        <linearGradient id={`${u}b`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".25" stopColor="#bff6ff" />
          <stop offset="1" stopColor="#5fe0ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}l`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f1a33" />
          <stop offset="1" stopColor="#060b18" />
        </linearGradient>
        <radialGradient id={`${u}e`}>
          <stop offset="0" stopColor="#e6fbff" />
          <stop offset=".4" stopColor="#5fe0ff" stopOpacity=".6" />
          <stop offset="1" stopColor="#5fe0ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill="#bff6ff" className={on(live, 'fxb-flash')} opacity={live ? undefined : 0} />
      {/* searchlights finding the monster */}
      {[
        [300, 8, 0, 30],
        [470, 10, 3, 12],
      ].map(([x, dur, ago, tilt]) => (
        <g key={x} className={on(live, 'fxb-sweep')} style={{ ...at(ago, dur), transformOrigin: `${x}px 206px` }}>
          <path d={`M${x - 3} 206L${x + tilt * 4 - 50} -40H${x + tilt * 4 + 50}L${x + 3} 206Z`} fill={`url(#${u}l)`} opacity=".2" />
        </g>
      ))}
      {KJ_BACK.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={206 - b.h} width={b.w} height={b.h} fill="#111b33" />
      ))}
      <rect width={W} height={H} fill={`url(#${u}g)`} />
      {/* Rexor rising over Neon Bay: the plates charge tail to head, then the atomic breath */}
      <g className={on(live, 'fxb-heave')}>
        {PLATES.map((p, i) => (
          <path key={`h${i}`} d={plate(p.s * 1.5)} transform={`translate(${p.x} ${p.y}) rotate(${f1(p.a)})`} fill="#5fe0ff" opacity=".22" className={on(live, 'fxb-plate')} style={at(i * 0.1)} />
        ))}
        {PLATES.map((p, i) => (
          <path key={`p${i}`} d={plate(p.s)} transform={`translate(${p.x} ${p.y}) rotate(${f1(p.a)})`} fill="#17342e" stroke="#2f6b5c" strokeWidth="1" />
        ))}
        {PLATES.map((p, i) => (
          <path key={`g${i}`} d={plate(p.s * 0.78)} transform={`translate(${p.x} ${p.y}) rotate(${f1(p.a)})`} fill="#bff6ff" className={on(live, 'fxb-plate')} style={at(i * 0.1)} opacity={live ? undefined : 0.55} />
        ))}
        <path d={REXOR} fill={`url(#${u}k)`} />
        <path d="M634 55C646 57 654 63 660 70 674 84 690 98 704 112 724 132 740 156 752 178" fill="none" stroke="#5fe0ff" strokeOpacity=".3" strokeWidth="2.4" strokeLinecap="round" />
        <path d={Array.from({ length: 8 }, (_, i) => `M${607 - (i < 2 ? 2 - i : 0)} ${112 + i * 8}q7 2.4 13 0`).join('')} fill="none" stroke="#a9c99a" strokeOpacity=".2" strokeWidth="2" strokeLinecap="round" />
        <path d="M558 79 561 83 564 79 567 83 570 79 573 83 576 79 579 82 582 79" fill="none" stroke="#eef6e6" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M584 60C592 57 602 57 610 60" fill="none" stroke="#0c2219" strokeWidth="3" strokeLinecap="round" />
        <circle cx="598" cy="65" r="9" fill={`url(#${u}e)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '2.2s' }} />
        <ellipse cx="598" cy="65" rx="4.2" ry="2" fill="#e6fbff" />
        <path d="M622 126C614 132 606 138 600 140M600 140 594 136M600 140 596 145" fill="none" stroke="#1b4433" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        <g transform="translate(556 80) rotate(19)">
          <rect className={on(live, 'fxb-beam')} style={{ transformOrigin: '0 0' }} x="-470" y="-7" width="470" height="14" rx="7" fill={`url(#${u}b)`} opacity={live ? undefined : 0} />
          <circle className={on(live, 'fxb-beam')} r="15" fill={`url(#${u}e)`} opacity={live ? undefined : 0} />
        </g>
      </g>
      {/* a news helicopter crossing with its light on the monster */}
      <g className={on(live, 'fxb-fly')} transform={live ? undefined : 'translate(380 0)'}>
        <path d="M0 40 40 150H70Z" fill="#fff" opacity=".07" />
        <path d="M-12 36h22l6 4h-24Z M-14 31h30" fill="#04070f" stroke="#04070f" strokeWidth="1.2" />
        <circle className={on(live, 'fxb-blink')} cx="-12" cy="35" r="1.8" fill="#ff3b4f" />
      </g>
      {KJ_FRONT.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={206 - b.h} width={b.w} height={b.h} fill="#080e1f" />
      ))}
      {KJ_FRONT.windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="2.8" height="3.2" fill={['#ffd36e', '#5fe0ff', '#ff5fa2'][w.c]} opacity=".72" />
      ))}
      <g transform="translate(410 150)">
        <rect width="54" height="18" rx="4" fill="#0b0716" stroke="#ff4fd8" strokeOpacity=".4" strokeWidth="5" />
        <rect width="54" height="18" rx="4" fill="none" stroke="#ff8ae9" strokeWidth="1.4" />
        <text x="27" y="13" textAnchor="middle" fontSize="10.5" fontWeight="900" letterSpacing="2" fill="#ffe6fa" fontFamily="Manrope, sans-serif" className={on(live, 'fxb-flick')} style={{ animationDuration: '5s' }}>
          BOJE
        </text>
      </g>
      <rect y="206" width={W} height="34" fill={`url(#${u}w)`} />
      {Array.from({ length: 18 }, (_, i) => (
        <rect key={i} className={on(live, 'fxb-shimmer')} style={at(i * 0.33)} x={20 + i * 44 + (i % 3) * 7} y={212 + (i % 4) * 6} width={14 + (i % 3) * 8} height="1.6" rx=".8" fill={['#ffd36e', '#5fe0ff', '#ff5fa2'][i % 3]} opacity=".5" />
      ))}
    </>
  )
}

/* ---------------- Eruption ---------------- */

const BLOBS = (() => {
  const r = seq(89)
  return Array.from({ length: 26 }, () => ({ dx: (r() - 0.5) * 220, dy: -(34 + r() * 46), s: 1.8 + r() * 3.2, ago: r() * 2.2, dur: 1.6 + r() * 1.1, c: Math.floor(r() * 3) }))
})()
const ASH = (() => {
  const r = seq(97)
  return Array.from({ length: 9 }, (_, i) => ({ dx: 50 + r() * 110, r: 22 + r() * 16, ago: (i / 9) * 9 }))
})()
const EMBERS = (() => {
  const r = seq(101)
  return Array.from({ length: 26 }, () => ({ x: r() * W, y: 120 + r() * 120, dx: (r() - 0.3) * 60, s: 0.8 + r() * 1.6, dur: 4 + r() * 4, ago: r() * 8 }))
})()
const LAVA_TONE = ['#fff2a0', '#ffb22e', '#ff5a1f']

function eruption(u: string, live: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d0207" />
          <stop offset=".55" stopColor="#3a0912" />
          <stop offset="1" stopColor="#7a1c10" />
        </linearGradient>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="560" cy="96" r="260">
          <stop offset="0" stopColor="#ff7a1f" stopOpacity=".55" />
          <stop offset=".5" stopColor="#ff3d1f" stopOpacity=".18" />
          <stop offset="1" stopColor="#ff3d1f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}v`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a0f0e" />
          <stop offset="1" stopColor="#0c0405" />
        </linearGradient>
        <linearGradient id={`${u}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3a8" />
          <stop offset=".4" stopColor="#ffb22e" />
          <stop offset="1" stopColor="#e2321a" />
        </linearGradient>
        <radialGradient id={`${u}c`} gradientUnits="userSpaceOnUse" cx="560" cy="96" r="44">
          <stop offset="0" stopColor="#fff6c4" />
          <stop offset=".4" stopColor="#ffb22e" stopOpacity=".9" />
          <stop offset="1" stopColor="#ff3d1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}k`} gradientUnits="userSpaceOnUse" cx="560" cy="100" r="150">
          <stop offset="0" stopColor="#ff8a3d" stopOpacity=".55" />
          <stop offset=".5" stopColor="#c2321a" stopOpacity=".18" />
          <stop offset="1" stopColor="#c2321a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}p`} cx=".5" cy=".62" r=".55">
          <stop offset="0" stopColor="#8a4a30" />
          <stop offset=".45" stopColor="#4a2a28" stopOpacity=".9" />
          <stop offset="1" stopColor="#2a1a1c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      <rect width={W} height={H} fill={`url(#${u}g)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '2.6s' }} />
      {/* the ash column, with lightning in it */}
      {ASH.map((a, i) => (
        <circle key={i} className={on(live, 'fxb-puff')} style={at(a.ago, 9, { '--dx': `${f1(a.dx)}px` })} cx="560" cy={live ? 86 : 86 - i * 16} r={f1(a.r * (live ? 1 : 1 + i * 0.22))} fill={`url(#${u}p)`} transform={live ? undefined : `translate(${f1((i * a.dx) / 7)} 0)`} />
      ))}
      <g className={on(live, 'fxb-bolt')} style={at(1, 5)} opacity={live ? undefined : 0}>
        <path d="M600 30l-8 12 7 2-10 16" fill="none" stroke="#e6d4ff" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M600 30l-8 12 7 2-10 16" fill="none" stroke="#b48cff" strokeOpacity=".4" strokeWidth="5" strokeLinejoin="round" />
      </g>
      <g className={on(live, 'fxb-bolt')} style={at(3.2, 6.5)} opacity={live ? undefined : 0}>
        <path d="M630 52l6 9-6 3 9 13" fill="none" stroke="#e6d4ff" strokeWidth="1.4" strokeLinejoin="round" />
      </g>
      {/* the mountain and its lava */}
      <path d="M330 240C400 200 460 150 520 104 532 96 542 92 548 92H572C580 92 590 96 600 104 660 150 720 196 800 230V240Z" fill={`url(#${u}v)`} />
      <path d="M330 240C400 200 460 150 520 104 532 96 542 92 548 92H572C580 92 590 96 600 104 660 150 720 196 800 230V240Z" fill={`url(#${u}k)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '2.6s' }} />
      <path d="M520 104C500 130 470 160 430 200M600 104C626 128 650 150 690 188" fill="none" stroke="#5a2418" strokeOpacity=".5" strokeWidth="3" />
      {[
        'M556 96C552 120 540 140 520 164S486 206 470 240',
        'M566 96C572 124 590 150 610 172S650 214 664 240',
        'M560 96C560 130 556 170 566 240',
      ].map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="#ff5a1f" strokeOpacity=".35" strokeWidth={i === 2 ? 8 : 10} strokeLinecap="round" />
          <path d={d} fill="none" stroke={`url(#${u}l)`} strokeWidth={i === 2 ? 3 : 4} strokeLinecap="round" />
          <path className={on(live, 'fxb-flow')} style={at(i * 0.7, 2 + i * 0.5)} d={d} fill="none" stroke="#fff3a8" strokeWidth={i === 2 ? 1.4 : 1.8} strokeLinecap="round" strokeDasharray="6 24" />
        </g>
      ))}
      <ellipse cx="560" cy="94" rx="22" ry="5" fill="#fff0a0" />
      <circle cx="560" cy="96" r="44" fill={`url(#${u}c)`} className={on(live, 'fxb-breathe')} style={{ animationDuration: '1.3s' }} />
      {/* the fountain: blobs thrown up and falling back on arcs */}
      <g transform="translate(560 92)">
        {BLOBS.map((b, i) => (
          <g key={i} className={on(live, 'fxb-arcx')} style={at(b.ago, b.dur, { '--dx': `${f1(b.dx)}px` })} transform={live ? undefined : `translate(${f1(b.dx * 0.4)} 0)`}>
            <g className={on(live, 'fxb-arcy')} style={at(b.ago, b.dur, { '--dy': `${f1(b.dy)}px` })} transform={live ? undefined : `translate(0 ${f1(b.dy * 0.85)})`}>
              <circle r={f1(b.s * 2.6)} fill="#ff7a1f" opacity=".22" />
              <circle r={f1(b.s)} fill={LAVA_TONE[b.c]} />
            </g>
          </g>
        ))}
      </g>
      {EMBERS.map((e, i) => (
        <circle key={i} className={on(live, 'fxb-rise')} style={at(e.ago, e.dur, { '--dx': `${f1(e.dx)}px` })} cx={f1(e.x)} cy={f1(e.y)} r={f1(e.s)} fill={i % 3 ? '#ffb22e' : '#fff0a0'} />
      ))}
      {/* the lava field in front */}
      <path d="M0 222C80 214 150 226 240 220S380 212 440 228 520 236 560 240H0Z" fill="#120506" />
      <path d="M30 230C70 224 110 232 150 226M200 234C240 228 280 234 320 230" fill="none" stroke="#ff7a1f" strokeWidth="1.6" strokeLinecap="round" className={on(live, 'fxb-pulse')} style={{ animationDuration: '1.8s' }} />
    </>
  )
}

/* ---------------- Abyss ---------------- */

const JELLIES = [
  { x: 560, y: 100, s: 1.2, c: ['#7ff3ff', '#2fb8ff'], ago: 0 },
  { x: 690, y: 120, s: 0.85, c: ['#ff9ad8', '#d14bff'], ago: 2.2 },
  { x: 440, y: 140, s: 0.7, c: ['#c6a8ff', '#7b5cff'], ago: 4.1 },
  { x: 760, y: 54, s: 0.55, c: ['#9dffcf', '#22d39a'], ago: 1.3 },
  { x: 320, y: 70, s: 0.45, c: ['#7ff3ff', '#2fb8ff'], ago: 3.3 },
] as const
const SNOW = (() => {
  const r = seq(107)
  return Array.from({ length: 40 }, () => ({ x: r() * W, y: -20 + r() * 240, r: 0.5 + r() * 1.1, dx: (r() - 0.5) * 50, ago: r() * 22 }))
})()
const PLANKTON = (() => {
  const r = seq(109)
  return Array.from({ length: 24 }, () => ({ x: 380 + r() * 420, y: 30 + r() * 190, r: 0.8 + r() * 1.3, ago: r() * 3 }))
})()

function jelly(j: (typeof JELLIES)[number], k: number, u: string, live: boolean) {
  return (
    <g key={k} transform={`translate(${j.x} ${j.y}) scale(${j.s})`}>
      <g className={on(live, 'fxb-bob')} style={at(j.ago, 5 + k)}>
        <circle r="46" fill={`url(#${u}j${k})`} className={on(live, 'fxb-pulse')} style={at(j.ago, 2.2)} />
        <g fill="none" stroke={j.c[0]} strokeLinecap="round">
          {[-14, -7, 0, 7, 14].map((x, i) => (
            <path key={x} className={on(live, 'fxb-tent')} style={at(i * 0.4 + j.ago)} d={`M${x} 8C${x + 6} 24 ${x - 6} 40 ${x + 3} 58S${x - 4} 80 ${x + 2} ${90 - Math.abs(x)}`} strokeOpacity={0.35 + (i % 2) * 0.2} strokeWidth={i === 2 ? 2.2 : 1.2} />
          ))}
          <path className={on(live, 'fxb-tent')} style={at(j.ago + 1)} d="M-4 8C-10 22 0 30 -6 44M4 8C10 22 0 30 6 44" stroke={j.c[1]} strokeWidth="4" strokeOpacity=".5" />
        </g>
        <g className={on(live, 'fxb-bell')} style={at(j.ago, 2.2)}>
          <path d="M-24 8C-26 -12 -14 -26 0 -26S26 -12 24 8C18 5 14 10 8 7S-2 10 -8 7-18 5 -24 8Z" fill={`url(#${u}b${k})`} />
          <path d="M-16 -4C-14 -14 -8 -20 0 -21" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" />
          <path d="M-10 4C-8 -6 -4 -10 0 -10S8 -6 10 4" fill="none" stroke={j.c[1]} strokeOpacity=".6" strokeWidth="1.4" />
        </g>
      </g>
    </g>
  )
}

function abyss(u: string, live: boolean) {
  return (
    <>
      <defs>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#06304d" />
          <stop offset=".45" stopColor="#031628" />
          <stop offset="1" stopColor="#01050c" />
        </linearGradient>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfefff" stopOpacity=".28" />
          <stop offset="1" stopColor="#bfefff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${u}q`}>
          <stop offset="0" stopColor="#c9fffb" />
          <stop offset=".35" stopColor="#4dfff0" stopOpacity=".7" />
          <stop offset="1" stopColor="#4dfff0" stopOpacity="0" />
        </radialGradient>
        {JELLIES.map((j, k) => (
          <g key={k}>
            <radialGradient id={`${u}j${k}`}>
              <stop offset="0" stopColor={j.c[0]} stopOpacity=".38" />
              <stop offset="1" stopColor={j.c[1]} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${u}b${k}`} cx=".5" cy=".25" r=".85">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
              <stop offset=".35" stopColor={j.c[0]} stopOpacity=".85" />
              <stop offset="1" stopColor={j.c[1]} stopOpacity=".45" />
            </radialGradient>
          </g>
        ))}
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      {[
        [330, 40, 0],
        [470, 60, 2],
        [610, 34, 4],
        [730, 50, 1],
      ].map(([x, w, ago], i) => (
        <g key={i} className={on(live, 'fxb-pulse')} style={at(ago, 7 + i)}>
          <path d={`M${x - w * 0.3} 0h${w * 1.6}L${x + w * 1.3 - 40} 240H${x - w * 1.3 - 70}Z`} fill={`url(#${u}r)`} opacity=".45" />
          <path d={`M${x} 0h${w}L${x + w * 0.6 - 50} 240H${x - w * 0.6 - 60}Z`} fill={`url(#${u}r)`} opacity=".7" />
        </g>
      ))}
      {/* a whale passing far away, very slowly */}
      <g className={on(live, 'fxb-whale')} transform={live ? undefined : 'translate(-380 0)'}>
        <path d="M1000 150C1030 132 1090 128 1140 138 1160 130 1176 120 1190 124 1182 134 1176 142 1180 152 1160 152 1150 150 1140 154 1100 168 1040 168 1000 150Z" fill="#0a2a40" opacity=".55" />
      </g>
      {SNOW.map((s, i) => (
        <circle key={i} className={on(live, 'fxb-snow')} style={at(s.ago, 22, { '--dx': `${f1(s.dx)}px` })} cx={f1(s.x)} cy={f1(s.y)} r={f1(s.r)} fill="#d6f4ff" opacity=".45" />
      ))}
      {JELLIES.slice().reverse().map((j) => jelly(j, JELLIES.indexOf(j), u, live))}
      {PLANKTON.map((p, i) => (
        <circle key={i} className={on(live, 'fxb-tw')} style={at(p.ago, 2.4 + (i % 3) * 0.6)} cx={f1(p.x)} cy={f1(p.y)} r={f1(p.r)} fill="#7dfff4" />
      ))}
      {/* the angler on the bottom, its lure the only light down there */}
      <path d="M0 226C100 214 200 222 300 214S520 212 640 222 760 214 800 220V240H0Z" fill="#010409" />
      <g transform="translate(250 214)">
        <path d="M-30 6C-26 -10 -6 -18 14 -14 26 -12 34 -4 36 6 26 4 14 8 4 12-10 16-24 14-30 6Z" fill="#03111c" />
        <path d="M30 2 34 -2 36 4M24 6l3-3 2 4" fill="none" stroke="#9fd8ee" strokeOpacity=".55" strokeWidth="1" />
        <path d="M6 -14C10 -30 24 -38 34 -34" fill="none" stroke="#063049" strokeWidth="1.6" />
        <circle cx="34" cy="-34" r="12" fill={`url(#${u}q)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '1.8s' }} />
        <circle cx="34" cy="-34" r="2.6" fill="#e9fffd" />
        <circle cx="18" cy="-6" r="1.6" fill="#7dfff4" opacity=".7" />
      </g>
    </>
  )
}

/* ---------------- Singularity (Mythic) ---------------- */

const SG_X = 580
const SG_Y = 122
const SG_STARS = stars(113, 110, H)
const RAINBOW = '#ff4fd8;#ffd34f;#5dff9a;#3fd8ff;#9b7bff;#ff4fd8'
/** the accretion disk, ring by ring from the hot inside out: radius, width, tone (gradient), opacity, streaks */
const DISK = [
  { r: 56, w: 7, c: 0, o: 1 },
  { r: 64, w: 9, c: 0, o: 0.95 },
  { r: 74, w: 11, c: 1, o: 0.9 },
  { r: 86, w: 12, c: 1, o: 0.8 },
  { r: 99, w: 13, c: 2, o: 0.7 },
  { r: 113, w: 14, c: 2, o: 0.55 },
  { r: 128, w: 14, c: 3, o: 0.42 },
  { r: 144, w: 14, c: 4, o: 0.3 },
  { r: 160, w: 12, c: 4, o: 0.18 },
].map((d, i) => ({ ...d, dash: `${f1(d.r * 2.2)} ${f1(d.r * 0.07 + (i % 3))} ${f1(d.r * 0.9)} ${f1(d.r * 0.05 + 1)}` }))
/** the disk's tones: white-hot, gold, orange, and two outer ones that run round the rainbow */
const DISK_TONE: [string, string][] = [
  ['#ffffff', '#fff1d0'],
  ['#fff1c2', '#ffc46b'],
  ['#ffb347', '#ff6a2f'],
  ['#ff5f7a', '#c03cff'],
  ['#b25cff', '#4a7bff'],
]
const INFALL = (() => {
  const r = seq(127)
  return Array.from({ length: 16 }, (_, i) => ({ a: r() * 360, r: 130 + r() * 130, ago: (i / 16) * 9, s: 0.7 + r() * 0.9 }))
})()
const SG_SPARKS = (() => {
  const r = seq(131)
  return Array.from({ length: 10 }, () => ({ x: 340 + r() * 460, y: 14 + r() * 212, s: 3 + r() * 4, ago: r() * 3 }))
})()

/** the disk's rings, turning (a flattened circle, so turning reads as a tilted disk going round) */
function diskRings(u: string, live: boolean) {
  return (
    <g className={on(live, 'fxb-spin')} style={{ animationDuration: '18s' }}>
      {DISK.map((d, i) => (
        <circle key={i} r={d.r} fill="none" stroke={`url(#${u}d${d.c})`} strokeOpacity={d.o} strokeWidth={d.w} strokeDasharray={d.dash} />
      ))}
    </g>
  )
}

function singularity(u: string, live: boolean) {
  const prism = live && !calm()
  return (
    <>
      <defs>
        <radialGradient id={`${u}a`} gradientUnits="userSpaceOnUse" cx={SG_X} cy={SG_Y} r="520">
          <stop offset="0" stopColor="#1c0c30" />
          <stop offset=".4" stopColor="#090414" />
          <stop offset="1" stopColor="#020106" />
        </radialGradient>
        {/* each ring's gradient runs across it, so the side coming towards us is brighter */}
        {DISK_TONE.map(([a, b], i) => (
          <linearGradient key={i} id={`${u}d${i}`} gradientUnits="userSpaceOnUse" x1="-170" y1="0" x2="170" y2="0">
            <stop offset="0" stopColor={a}>{prism && i >= 3 && <animate attributeName="stop-color" values={RAINBOW} dur={`${7 + i * 2}s`} repeatCount="indefinite" />}</stop>
            <stop offset="1" stopColor={b} stopOpacity=".55">{prism && i >= 3 && <animate attributeName="stop-color" values="#3fd8ff;#9b7bff;#ff4fd8;#ffd34f;#5dff9a;#3fd8ff" dur={`${7 + i * 2}s`} repeatCount="indefinite" />}</stop>
          </linearGradient>
        ))}
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx={SG_X} cy={SG_Y} r="200">
          <stop offset="0" stopColor="#ffb84f" stopOpacity=".42" />
          <stop offset=".45" stopColor="#ff4fd8" stopOpacity=".12" />
          <stop offset="1" stopColor="#7b5cff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}o`}>
          <stop offset=".25" stopColor="#ffcf8a" stopOpacity=".55" />
          <stop offset="1" stopColor="#ff6a2f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}p`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4fd8">{prism && <animate attributeName="stop-color" values={RAINBOW} dur="6s" repeatCount="indefinite" />}</stop>
          <stop offset=".5" stopColor="#ffffff" />
          <stop offset="1" stopColor="#3fd8ff">{prism && <animate attributeName="stop-color" values="#3fd8ff;#9b7bff;#ff4fd8;#ffd34f;#5dff9a;#3fd8ff" dur="6s" repeatCount="indefinite" />}</stop>
        </linearGradient>
        {(
          [
            ['j', 1, 0],
            ['k', 0, 1],
          ] as const
        ).map(([k, y1, y2]) => (
          <linearGradient key={k} id={`${u}${k}`} x1="0" y1={y1} x2="0" y2={y2}>
            <stop offset="0" stopColor="#ffffff" stopOpacity=".75" />
            <stop offset=".35" stopColor="#9b7bff" stopOpacity=".35">{prism && <animate attributeName="stop-color" values="#9b7bff;#3fd8ff;#5dff9a;#ffd34f;#ff4fd8;#9b7bff" dur="7s" repeatCount="indefinite" />}</stop>
            <stop offset="1" stopColor="#3fd8ff" stopOpacity="0" />
          </linearGradient>
        ))}
        <clipPath id={`${u}b`}>
          <rect x="-400" y="-400" width="800" height="400" />
        </clipPath>
        <clipPath id={`${u}f`}>
          <rect x="-400" y="0" width="800" height="400" />
        </clipPath>
      </defs>
      <rect width={W} height={H} fill={`url(#${u}a)`} />
      {SG_STARS.map(([x, y, r, o], i) => {
        // stars near the hole are drawn out round it by the lensing
        const dx = x - SG_X
        const dy = y - SG_Y
        const d = Math.hypot(dx, dy)
        const pull = d < 180 ? (180 - d) / 180 : 0
        if (d < 60) return null
        return pull > 0.15 ? (
          <ellipse key={i} cx={f1(x)} cy={f1(y)} rx={f1(r * (1 + pull * 5))} ry={f1(r * 0.45)} transform={`rotate(${f1((Math.atan2(dy, dx) * 180) / Math.PI + 90)} ${f1(x)} ${f1(y)})`} fill="#fff" opacity={o * 0.8} />
        ) : (
          <circle key={i} cx={f1(x)} cy={f1(y)} r={f1(r * 0.6)} fill="#fff" opacity={o * 0.7} />
        )
      })}
      <circle cx={SG_X} cy={SG_Y} r="200" fill={`url(#${u}g)`} className={on(live, 'fxb-pulse')} style={{ animationDuration: '5s' }} />
      {/* jets from the poles */}
      <path className={on(live, 'fxb-jet')} d={`M${SG_X - 7} ${SG_Y - 40}L${SG_X - 1} 0H${SG_X + 1}L${SG_X + 7} ${SG_Y - 40}Z`} fill={`url(#${u}j)`} />
      <path className={on(live, 'fxb-jetd')} style={at(1.2)} d={`M${SG_X - 7} ${SG_Y + 40}L${SG_X - 1} ${H}H${SG_X + 1}L${SG_X + 7} ${SG_Y + 40}Z`} fill={`url(#${u}k)`} opacity=".7" />
      {/* stars falling in on spirals */}
      <g transform={`translate(${SG_X} ${SG_Y}) scale(1 .34)`}>
        {INFALL.map((s, i) => (
          <g key={i} transform={`rotate(${f1(s.a)})`}>
            <g className={on(live, 'fxb-infall')} style={at(s.ago)} transform={live ? undefined : `scale(${f1(0.45 + (i / 16) * 0.5)})`}>
              <ellipse cx={f1(s.r)} cy="0" rx={f1(s.s * 2.4)} ry={f1(s.s * 1.5)} fill="#fff1d6" />
            </g>
          </g>
        ))}
      </g>
      {/* the disk's glow, its far side behind the hole, and that far side's light bent up over the top */}
      <ellipse cx={SG_X} cy={SG_Y} rx="190" ry="54" fill={`url(#${u}o)`} />
      <g transform={`translate(${SG_X} ${SG_Y}) scale(1 .28)`} clipPath={`url(#${u}b)`}>
        {diskRings(u, live)}
      </g>
      <path d={`M${SG_X - 62} ${SG_Y + 2}C${SG_X - 64} ${SG_Y - 78} ${SG_X + 64} ${SG_Y - 78} ${SG_X + 62} ${SG_Y + 2}`} fill="none" stroke={`url(#${u}d1)`} strokeOpacity=".8" strokeWidth="10" strokeLinecap="round" />
      <path d={`M${SG_X - 54} ${SG_Y}C${SG_X - 55} ${SG_Y - 64} ${SG_X + 55} ${SG_Y - 64} ${SG_X + 54} ${SG_Y}`} fill="none" stroke="#fffaf0" strokeOpacity=".85" strokeWidth="2.4" />
      {/* the shadow and its ring of light */}
      <circle cx={SG_X} cy={SG_Y} r="50" fill="none" stroke={`url(#${u}p)`} strokeOpacity=".35" strokeWidth="7" />
      <circle cx={SG_X} cy={SG_Y} r="46.5" fill="none" stroke={`url(#${u}p)`} strokeWidth="3.4" />
      <circle cx={SG_X} cy={SG_Y} r="44" fill="#000" />
      {/* the near side of the disk, across the front of the hole */}
      <g transform={`translate(${SG_X} ${SG_Y}) scale(1 .28)`} clipPath={`url(#${u}f)`}>
        {diskRings(u, live)}
      </g>
      <path d={`M${SG_X - 64} ${SG_Y + 4}C${SG_X - 62} ${SG_Y + 30} ${SG_X + 62} ${SG_Y + 30} ${SG_X + 64} ${SG_Y + 4}`} fill="none" stroke="#fff6e6" strokeOpacity=".75" strokeWidth="2" />
      {SG_SPARKS.map((s, i) => (
        <path key={i} className={on(live, 'fxb-tw')} style={at(s.ago, 2.2 + (i % 3) * 0.5)} d={sparkle(Math.round(s.x), Math.round(s.y), Math.round(s.s * 10) / 10)} fill={`url(#${u}p)`} />
      ))}
    </>
  )
}

/* ---------------- the catalog ---------------- */

export const FX_BANNER_ART: Record<string, (u: string, live: boolean) => ReactNode> = {
  'banner:matrix': codeRain,
  'banner:sakura': sakura,
  'banner:warp': hyperspace,
  'banner:synthwave': synthwave,
  'banner:vegas': vegas,
  'banner:storm': supercell,
  'banner:kaiju': kaijuCity,
  'banner:volcano': eruption,
  'banner:abyss': abyss,
  'banner:singularity': singularity,
}

/** the colour behind each scene while it draws */
export const FX_BANNER_BG: Record<string, string> = {
  'banner:matrix': '#02110a',
  'banner:sakura': '#3c1650',
  'banner:warp': '#0d1440',
  'banner:synthwave': '#2a0a4c',
  'banner:vegas': '#1a0832',
  'banner:storm': '#18242f',
  'banner:kaiju': '#101a33',
  'banner:volcano': '#3a0912',
  'banner:abyss': '#031628',
  'banner:singularity': '#090414',
}
