import type { CSSProperties, ReactNode } from 'react'
import { P, arc, arcBolt, at, bolt, injectCss, n2, orbit, orbitHalf, orbitPlace, sector, seq, sparkle, tm, tongue, type Orbit } from './fx-kit'

/*
  The twelve animated frames (Frostbite, Glitch, Plasma, Orbit, Arcane, Kaiju, Inferno, Thunderhead, Liquid Gold,
  Ouroboros, Event Horizon and Prism), merged into FRAME_ART in src/art/cosmetics.tsx. Like the frames there, each is
  drawn on the 100-unit grid round an avatar that fills the middle 78% (radius 39), with its band between radius 38.8
  and 49.2, and some of it reaching a little past the box (flame tips, cloud puffs, a dragon's horns).

  What makes these different from the older frames is that they live: ice shards grow out of the ring and burst,
  the glitch tears and splits its colour channels, plasma arcs crackle round a glass tube, three moons orbit on tilted
  rings and pass behind the avatar, two rings of runes turn against each other over a sigil, a kaiju's dorsal plates
  charge up one by one and flash, flames roar up from a ring of cracked basalt, lightning forks out of churning
  clouds, molten gold drips off the bottom, a dragon slowly circles chasing its tail, an accretion disk swirls through
  an event horizon, and a crystal ring splits white light into a spectrum.

  Three frames need a layer under the avatar as well as over it (the moons and the accretion disk pass behind it, the
  rune sigil sits behind it): FX_BACK has those, drawn in a second SVG under the avatar. Two have a spinning rainbow
  under their glass (FX_UNDER): a conic gradient on a plain element, so the browser can turn it without repainting.
  The two Mythic frames carry the Mythic signature, a shifting rainbow and sparkles.

  Cost: everything is built once at load; per frame only CSS animations run (transforms, opacity, and a dash offset or
  two). An animated SVG repaints while it moves, so a frame only moves from FX_LIVE (56 px) up: the profile card,
  header, shop and wardrobe sizes. Between 36 and 56 px (leaderboard rows, chips) it is drawn in full but holds still,
  apart from the conic rainbows, which the browser turns without repainting; below 36 px it is simplified too. A page of
  fifty 40 px rows costs nothing (tools/cosmetics-sheet.mjs measures it), and FramedAvatar pauses a frame while it is
  offscreen. Every animated element starts part-way through its cycle, so with reduced motion (where fx-kit pauses
  everything) each frame stands still in a natural pose.
*/

type Art = (u: string, px: number) => ReactNode
const vars = (o: Record<string, string | number>) => o as CSSProperties
/** the size (px) a frame starts moving at: smaller ones (list rows, chips) are drawn in full but hold still */
export const FX_LIVE = 56

/* ---------------- frame keyframes ---------------- */

/** the kaiju's dorsal plates light one after another (left to right), hold, then drop together after the flash */
const PLATE_KEYS = Array.from({ length: 7 }, (_, i) => {
  const a = 8 + i * 5
  return `@keyframes bjx-kp${i}{0%,${a}%{opacity:.32}${a + 7}%,58%{opacity:1}68%,100%{opacity:.32}}.bjx-kp${i}{animation:bjx-kp${i} 4s ease-in-out infinite}`
}).join('\n')

injectCss(
  'bjx-frames',
  `@keyframes bjx-ice{0%{transform:scale(.25,.06);opacity:0}6%{opacity:1}60%{transform:scale(1,1)}82%{transform:scale(1.03,1.06);opacity:1}87%{transform:scale(1.3,1.18);opacity:0}100%{transform:scale(.25,.06);opacity:0}}
.bjx-ice{transform-box:fill-box;transform-origin:50% 100%;animation:bjx-ice 7s cubic-bezier(.2,.7,.3,1) infinite}
@keyframes bjx-fern{0%,6%{opacity:0;transform:scale(.25)}40%,78%{opacity:.95;transform:scale(1)}90%,100%{opacity:0;transform:scale(1.04)}}
.bjx-fern{transform-box:fill-box;transform-origin:50% 0;animation:bjx-fern 7s ease-out infinite}
@keyframes bjx-glr{0%{transform:translate(-1.3px,0)}6%{transform:translate(-3.4px,.5px)}7.2%{transform:translate(-1.3px,0)}29%{transform:translate(-1.8px,-.7px)}30%{transform:translate(2.4px,0)}31.5%{transform:translate(-1.3px,0)}63%{transform:translate(-4.6px,0)}64.5%{transform:translate(-1.3px,0)}82%{transform:translate(-1.3px,1.3px)}83%,100%{transform:translate(-1.3px,0)}}
@keyframes bjx-glc{0%{transform:translate(1.3px,0)}6%{transform:translate(3px,-.4px)}7.2%{transform:translate(1.3px,0)}29%{transform:translate(1.9px,.6px)}30%{transform:translate(-2.2px,0)}31.5%{transform:translate(1.3px,0)}63%{transform:translate(4.2px,.3px)}64.5%{transform:translate(1.3px,0)}82%{transform:translate(1.3px,-1.2px)}83%,100%{transform:translate(1.3px,0)}}
.bjx-glr{animation:bjx-glr 3.1s steps(1,end) infinite}
.bjx-glc{animation:bjx-glc 3.1s steps(1,end) infinite}
@keyframes bjx-jolt{0%,100%{transform:none}63%{transform:translate(1.4px,0) skewX(-5deg)}64.2%{transform:none}82%{transform:translate(-1.6px,0)}83%{transform:none}}
.bjx-jolt{transform-origin:50px 50px;animation:bjx-jolt 3.1s steps(1,end) infinite}
@keyframes bjx-tear0{0%,5.9%{opacity:0;transform:none}6%{opacity:1;transform:translateX(5px)}7.2%,62.9%{opacity:0;transform:none}63%{opacity:1;transform:translateX(-6px)}64.5%,100%{opacity:0;transform:none}}
@keyframes bjx-tear1{0%,28.9%{opacity:0;transform:none}29%{opacity:1;transform:translateX(-4px)}30%{transform:translateX(3px)}31.5%,81.9%{opacity:0;transform:none}82%{opacity:1;transform:translateX(7px)}83%,100%{opacity:0;transform:none}}
@keyframes bjx-tear2{0%,62.9%{opacity:0;transform:none}63%{opacity:1;transform:translateX(8px)}64.5%,81.9%{opacity:0;transform:none}82%{opacity:1;transform:translateX(-5px)}83%,100%{opacity:0;transform:none}}
.bjx-tear0{animation:bjx-tear0 3.1s steps(1,end) infinite}
.bjx-tear1{animation:bjx-tear1 3.1s steps(1,end) infinite}
.bjx-tear2{animation:bjx-tear2 3.1s steps(1,end) infinite}
@keyframes bjx-blk{0%,100%{opacity:0}12%{opacity:1}14%{opacity:0}47%{opacity:1}48%{opacity:.35}51%{opacity:0}}
.bjx-blk{animation:bjx-blk 2.3s steps(1,end) infinite}
@keyframes bjx-load{0%{stroke-dashoffset:0}30%,42%{stroke-dashoffset:-96}43%{stroke-dashoffset:-48}72%,84%{stroke-dashoffset:-190}100%{stroke-dashoffset:-276.46}}
.bjx-load{animation:bjx-load 3.6s steps(5,end) infinite}
@keyframes bjx-kflash{0%,56%{opacity:0}60%{opacity:.95}76%,100%{opacity:0}}
.bjx-kflash{animation:bjx-kflash 4s ease-out infinite}
@keyframes bjx-quake{0%,58%,72%,100%{transform:translate(0,0)}60%{transform:translate(-.9px,.5px)}62%{transform:translate(.8px,-.6px)}64%{transform:translate(-.6px,-.4px)}66%{transform:translate(.5px,.5px)}68%{transform:translate(-.3px,0)}}
.bjx-quake{animation:bjx-quake 4s linear infinite}
@keyframes bjx-hop{0%,58%,70%,100%{transform:translateY(0)}61%{transform:translateY(-2.6px) rotate(-12deg)}64%{transform:translateY(0)}67%{transform:translateY(-1px)}}
.bjx-hop{transform-box:fill-box;transform-origin:center;animation:bjx-hop 4s ease-out infinite}
@keyframes bjx-billow{0%,100%{transform:scale(1)}50%{transform:scale(1.13)}}
.bjx-billow{transform-box:fill-box;transform-origin:center;animation:bjx-billow 5s ease-in-out infinite}
@keyframes bjx-sflash{0%,12%{opacity:0}12.6%{opacity:.75}13.4%{opacity:.1}14%{opacity:.6}15.5%,61%{opacity:0}61.5%{opacity:.65}63.5%,100%{opacity:0}}
.bjx-sflash{animation:bjx-sflash 7.3s linear infinite}
@keyframes bjx-rain{0%{transform:translate(0,-2px);opacity:0}20%{opacity:.85}100%{transform:translate(-2.6px,9px);opacity:0}}
.bjx-rain{animation:bjx-rain .9s linear infinite}
@keyframes bjx-roll{0%,100%{transform:rotate(-26deg)}50%{transform:rotate(24deg)}}
.bjx-roll{transform-origin:50px 50px;animation:bjx-roll 6s ease-in-out infinite}
@keyframes bjx-drip{0%{transform:scale(.7,.2)}68%{transform:scale(1,1.12)}76%{transform:scale(.86,.5)}100%{transform:scale(.7,.2)}}
.bjx-drip{transform-box:fill-box;transform-origin:50% 0;animation:bjx-drip 3.6s cubic-bezier(.5,0,.7,1) infinite}
@keyframes bjx-drop{0%,69%{transform:translate(0,0) scale(.3);opacity:0}71%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(0,17px) scale(.75,1.15);opacity:0}}
.bjx-drop{transform-box:fill-box;transform-origin:50% 0;animation:bjx-drop 3.6s cubic-bezier(.55,0,.9,.55) infinite}
@keyframes bjx-run{0%{transform:rotate(0);opacity:0}12%,82%{opacity:1}100%{transform:rotate(var(--sweep));opacity:0}}
.bjx-run{transform-origin:50px 50px;animation:bjx-run 5.2s cubic-bezier(.45,0,.8,.8) infinite}
@keyframes bjx-jaw{0%,78%,100%{transform:rotate(0)}84%{transform:rotate(10deg)}90%{transform:rotate(0)}}
.bjx-jaw{animation:bjx-jaw 5s ease-in-out infinite}
@keyframes bjx-fall{0%{transform:translate(var(--r0),0) scale(1);opacity:0}15%{opacity:1}100%{transform:translate(40px,0) scale(.15);opacity:0}}
.bjx-fall{animation:bjx-fall 3s cubic-bezier(.5,0,.85,.6) infinite}
@keyframes bjx-fan{0%,100%{opacity:.5;transform:rotate(-2.5deg)}50%{opacity:.9;transform:rotate(2.5deg)}}
.bjx-fan{animation:bjx-fan 4.4s ease-in-out infinite}
.bjx-hspin{animation:bjx-rot 6s linear infinite}
${PLATE_KEYS}`,
)

/* ---------------- Frostbite ---------------- */

/** a crystal shard standing on the ring at the top (its base at y = b), pointing up; lit from the top left */
function shard(w: number, len: number, b = 2.6) {
  const t = b - len
  const p = (x: number, y: number) => `${n2(50 + x * w)} ${n2(y)}`
  return {
    body: `M${p(-1, b)}L${p(-0.55, b - len * 0.48)}L${p(-0.18, t + len * 0.14)}L${p(0, t)}L${p(0.3, t + len * 0.22)}L${p(0.62, b - len * 0.5)}L${p(1, b)}Z`,
    shade: `M${p(0, t)}L${p(0.3, t + len * 0.22)}L${p(0.62, b - len * 0.5)}L${p(1, b)}L${p(0.12, b)}Z`,
    edge: `M${p(-0.55, b - len * 0.48)}L${p(-0.18, t + len * 0.14)}L${p(0, t)}`,
    side: `M${p(-0.7, b)}L${p(-1.9, b - len * 0.42)}L${p(-0.15, b - len * 0.16)}Z`,
  }
}
const FROST_SHARDS = Array.from({ length: 18 }, (_, i) => {
  const a = ((i + 0.5) / 18) * 360
  const c = Math.cos((a * Math.PI) / 180)
  // a crown of taller crystals at the top; the bottom ones hang longer, as icicles
  const k = c < -0.55 ? 1.22 : 1 + 0.2 * Math.max(0, c)
  return { a, len: [12.5, 7.4, 9.8][i % 3] * k, w: [3.6, 2.6, 3.1][i % 3], side: i % 3 === 0 }
})
const FROST_FACETS = Array.from({ length: 18 }, (_, i) => sector(39.2, 48.8, i * 20, i * 20 + 20))
const FROST_CRACKS = (() => {
  const r = seq(5)
  return Array.from({ length: 10 }, (_, i) => {
    const a = i * 36 + r() * 20
    return `M${P(39.6, a)}L${P(43.6 + r() * 2, a + 2 + r() * 3)}L${P(48.4, a + r() * 4 - 2)}`
  })
})()
const FROST_DUST = (() => {
  const r = seq(9)
  return Array.from({ length: 22 }, () => [...at(40 + r() * 8.4, r() * 360), 0.22 + r() * 0.36] as const)
})()
/** frost creeping in over the avatar's edge from the inner rim, drawn at the top */
const FERN = 'M50 10.8V16.4M50 12.2l-1.6 1.3M50 12.2l1.6 1.3M50 13.8l-1.2 1M50 13.8l1.2 1M50 15.2l-.7.8M50 15.2l.7.8'
const snowflake = (x: number, y: number, s: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = i * 60 - 90
    const [ex, ey] = at(s, a, x, y)
    const [bx, by] = at(s * 0.55, a, x, y)
    return `M${n2(x)} ${n2(y)}L${n2(ex)} ${n2(ey)}M${n2(bx)} ${n2(by)}L${P(s * 0.86, a - 26, x, y)}M${n2(bx)} ${n2(by)}L${P(s * 0.86, a + 26, x, y)}`
  }).join('')

const frost: Art = (u, px) => {
  const live = px >= FX_LIVE
  const small = px < 36
  const fine = px >= 64
  return (
    <>
      <defs>
        <linearGradient id={`${u}i`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#f6ffff" />
          <stop offset=".3" stopColor="#bdeeff" />
          <stop offset=".62" stopColor="#62bdf0" />
          <stop offset=".86" stopColor="#2a78c2" />
          <stop offset="1" stopColor="#a8e6ff" />
        </linearGradient>
        <linearGradient id={`${u}s`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#7fd0f7" />
          <stop offset=".5" stopColor="#d9f7ff" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="none" stroke="#8fe3ff" strokeOpacity=".15" strokeWidth="14" />
      {FROST_SHARDS.filter((_, i) => !small || i % 2 === 0).map((s, i) => {
        const g = shard(s.w, !small ? s.len : s.len * 0.72)
        return (
          <g key={i} transform={`rotate(${n2(s.a)} 50 50)`}>
            <g className={live ? 'bjx-ice' : undefined} style={live ? tm(7, i * 0.37 + 0.2) : undefined}>
              {s.side && fine && <path d={g.side} fill={`url(#${u}s)`} stroke="#2a6ea8" strokeOpacity=".6" strokeWidth=".35" strokeLinejoin="round" />}
              <path d={g.body} fill={`url(#${u}s)`} stroke="#2a6ea8" strokeOpacity=".75" strokeWidth=".45" strokeLinejoin="round" />
              <path d={g.shade} fill="#1d5f9c" fillOpacity=".38" />
              {fine && <path d={g.edge} fill="none" stroke="#fff" strokeWidth=".5" strokeLinecap="round" />}
            </g>
          </g>
        )
      })}
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}i)`} strokeWidth="9.8" />
      {FROST_FACETS.map((d, i) => (
        <path key={i} d={d} fill={i % 2 ? '#0d4a80' : '#fff'} fillOpacity={i % 2 ? 0.14 : 0.22} />
      ))}
      {fine && FROST_CRACKS.map((d, i) => <path key={i} d={d} fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth=".42" strokeLinejoin="round" />)}
      {fine && FROST_DUST.map(([x, y, r], i) => <circle key={i} cx={n2(x)} cy={n2(y)} r={n2(r)} fill="#fff" fillOpacity=".75" />)}
      <circle cx="50" cy="50" r="48.9" fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth=".9" />
      <circle cx="50" cy="50" r="39.3" fill="none" stroke="#e8fcff" strokeWidth="1.1" />
      <circle cx="50" cy="50" r="38.6" fill="none" stroke="#0b3a5e" strokeOpacity=".55" strokeWidth=".8" />
      {live &&
        [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((a, i) => (
          <g key={a} transform={`rotate(${a} 50 50)`}>
            <path className="bjx-fern" style={tm(7, i * 0.29 + 0.15)} d={FERN} fill="none" stroke="#f2fdff" strokeOpacity=".9" strokeWidth=".5" strokeLinecap="round" />
          </g>
        ))}
      <circle cx="50" cy="5.6" r="5" fill="#c8f6ff" fillOpacity=".35" />
      <path d={snowflake(50, 5.6, 4.3)} fill="none" stroke="#fff" strokeWidth={fine ? 0.75 : 1.2} strokeLinecap="round" />
      <circle cx="50" cy="5.6" r=".95" fill="#fff" />
      {!small &&
        [
          [84, 15, 3.4, 0],
          [11, 72, 2.6, 0.4],
          [75, 93, 2.3, 0.75],
        ].map(([x, y, s, f]) => <path key={x} className={live ? 'bjx-tw' : undefined} style={live ? tm(3, f) : undefined} d={sparkle(x, y, s)} fill="#fff" />)}
    </>
  )
}

/* ---------------- Glitch ---------------- */

const GL_DASH = '24 2.5 10 1.5 31 4 7 2 18 1.2 44 3 12 2.6 27 1.4 9 2 33 2.3 19 1.6'
/** corrupted blocks round the ring: x, y, w, h, colour, seconds, phase */
const GL_BLOCKS: [number, number, number, number, string, number, number][] = [
  [84, 21, 6.4, 2.2, '#ff2a6d', 2.3, 0.1],
  [7, 60, 4.8, 1.8, '#18e0ff', 2.9, 0.5],
  [69, 89, 7.4, 1.6, '#ffffff', 3.4, 0.3],
  [11, 17, 3, 3, '#fff35c', 2.6, 0.75],
  [91, 63, 3.6, 1.4, '#3dff8a', 3.1, 0.2],
  [28, 94.5, 5.2, 1.5, '#ff2a6d', 2.1, 0.62],
  [-2.5, 40, 4.4, 1.2, '#ffffff', 3.7, 0.9],
  [58, -1.8, 6.2, 1.8, '#18e0ff', 2.7, 0.4],
]
/** the bands that tear sideways: y, height */
const GL_TEARS = [
  [17, 6.4],
  [55, 3.6],
  [76, 5],
]

/** one colour channel of the glitch ring: rims, the broken signal ring, and the stuttering loader */
const glRing = (c: string, live: boolean) => (
  <>
    <circle cx="50" cy="50" r="48.3" fill="none" stroke={c} strokeWidth="1.1" />
    <circle cx="50" cy="50" r="44" fill="none" stroke={c} strokeWidth="3.3" strokeDasharray={GL_DASH} />
    <circle cx="50" cy="50" r="39.6" fill="none" stroke={c} strokeWidth="1" />
    {live && <circle className="bjx-load" cx="50" cy="50" r="44" fill="none" stroke={c} strokeOpacity=".85" strokeWidth="6.4" strokeDasharray="22 254.46" />}
  </>
)

const glitch: Art = (u, px) => {
  const live = px >= FX_LIVE
  return (
    <>
      <defs>
        <pattern id={`${u}l`} width="4" height="1.6" patternUnits="userSpaceOnUse">
          <rect width="4" height=".55" fill="#fff" fillOpacity=".1" />
        </pattern>
        {GL_TEARS.map(([y, h], i) => (
          <clipPath key={i} id={`${u}t${i}`}>
            <rect x="-10" y={y} width="120" height={h} />
          </clipPath>
        ))}
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#0a0f1d" strokeWidth="10.8" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}l)`} strokeWidth="10.8" />
      <g className={live ? 'bjx-jolt' : undefined}>
        <g style={{ mixBlendMode: 'screen' }}>
          <g transform="translate(-1.3 0)" className={live ? 'bjx-glr' : undefined}>
            {glRing('#ff2a6d', live)}
          </g>
          <g transform="translate(1.3 0)" className={live ? 'bjx-glc' : undefined}>
            {glRing('#18e0ff', live)}
          </g>
        </g>
        {glRing('#eafcff', live)}
        {live &&
          GL_TEARS.map((_, i) => (
            <g key={i} clipPath={`url(#${u}t${i})`}>
              <g className={`bjx-tear${i}`}>
                <circle cx="50" cy="50" r="44" fill="none" stroke="#0a0f1d" strokeWidth="10.8" />
                {glRing(['#ffffff', '#18e0ff', '#ff2a6d'][i], false)}
              </g>
            </g>
          ))}
      </g>
      {GL_BLOCKS.filter((_, i) => live || i < 3).map(([x, y, w, h, c, d, f], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} className={live ? 'bjx-blk' : undefined} style={live ? tm(d, f) : undefined} />
      ))}
    </>
  )
}

/* ---------------- Plasma ---------------- */

/** six sets of arcs: a crawl along the tube, and filaments reaching out past the glass from the core, one forked */
const PLASMA = (() => {
  const r = seq(77)
  return Array.from({ length: 6 }, (_, s) => {
    const base = s * 60 + r() * 24
    const d = [arcBolt(r, 44 + (r() - 0.5) * 1.2, base, base + 28 + r() * 22, 3.2, 8)]
    for (let k = 0; k < 2; k++) {
      const a = base + 8 + k * 22 + r() * 12
      const [x0, y0] = at(44, a)
      const end = a + (r() - 0.5) * 22
      const [x1, y1] = at(54 + r() * 4, end)
      const main = bolt(r, x0, y0, x1, y1, 1.8, 5)
      d.push(main.d)
      if (k === 0) {
        const [fx, fy] = main.pts[2]
        const [gx, gy] = at(52 + r() * 3, end + (r() < 0.5 ? -1 : 1) * (8 + r() * 6))
        d.push(bolt(r, fx, fy, gx, gy, 1, 3).d)
      }
    }
    return { d, dur: 1.1 + r() * 1.2 }
  })
})()

const plasma: Art = (u, px) => {
  const live = px >= FX_LIVE
  return (
    <>
      <defs>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stopColor="#3d1675" />
          <stop offset=".5" stopColor="#170635" />
          <stop offset="1" stopColor="#2c0f5c" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#b06bff" strokeOpacity=".2" strokeWidth="16" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}g)`} strokeWidth="10.4" />
      <circle className={live ? 'bjx-pulse' : undefined} style={live ? tm(1.3) : undefined} cx="50" cy="50" r="44" fill="none" stroke="#ff5ce6" strokeOpacity=".55" strokeWidth="4.4" />
      <circle cx="50" cy="50" r="44" fill="none" stroke="#ffd8fb" strokeWidth="1.3" />
      <g className={live ? 'bjx-rot' : undefined} style={live ? tm(16) : undefined}>
        {PLASMA.map((s, i) =>
          !live && i > 1 ? null : (
            <g key={i} className={live ? 'bjx-zap' : undefined} style={live ? tm(s.dur, i / 6) : undefined}>
              {s.d.map((d, k) => (
                <path key={k} d={d} fill="none" stroke="#d68bff" strokeOpacity=".55" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {s.d.map((d, k) => (
                <path key={`c${k}`} d={d} fill="none" stroke="#fff6ff" strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" />
              ))}
            </g>
          ),
        )}
      </g>
      <path d={arc(47.4, 195, 285)} fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="1.1" strokeLinecap="round" />
      <path d={arc(40.6, 15, 75)} fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth=".8" strokeLinecap="round" />
      <circle cx="50" cy="50" r="49.1" fill="none" stroke="#d9b8ff" strokeOpacity=".65" strokeWidth=".8" />
      <circle cx="50" cy="50" r="39" fill="none" stroke="#0a0218" strokeOpacity=".75" strokeWidth="1.1" />
      <circle cx="50" cy="50" r="39.7" fill="none" stroke="#c99bff" strokeOpacity=".5" strokeWidth=".6" />
      {[45, 135, 225, 315].map((a) => (
        <rect key={a} x="47.5" y="-.6" width="5" height="4.6" rx="1.1" fill="#2a1a40" stroke="#8a6ab8" strokeWidth=".5" transform={`rotate(${a + 90} 50 50)`} />
      ))}
    </>
  )
}

/* ---------------- Orbit ---------------- */

const ORBITS: (Orbit & { m: number; c: [string, string, string]; glow: string; craters?: boolean })[] = [
  { cx: 50, cy: 50, R: 47.5, sq: 0.3, tilt: -24, dur: 7.5, frac: 0.1, m: 5, c: ['#ffffff', '#cbd6e8', '#5f6c88'], glow: '#bfe0ff', craters: true },
  { cx: 50, cy: 50, R: 46.5, sq: 0.34, tilt: 34, dur: 10.5, frac: 0.6, m: 4.2, c: ['#ffe2cf', '#ff8a5c', '#8f3420'], glow: '#ff9a6b' },
  { cx: 50, cy: 50, R: 48.5, sq: 0.22, tilt: 92, dur: 14, frac: 0.35, m: 3.5, c: ['#e2fff6', '#5eeec4', '#167058'], glow: '#7dffd8' },
]
const ORBIT_STARS = (() => {
  const r = seq(19)
  return Array.from({ length: 20 }, () => [...at(39.6 + r() * 4.2, r() * 360), 0.18 + r() * 0.32] as const)
})()
const orbitDefs = (u: string) =>
  ORBITS.map((o, k) => (
    <g key={k}>
      <radialGradient id={`${u}m${k}`} cx=".5" cy=".5" r=".5" fx=".32" fy=".28">
        <stop offset="0" stopColor={o.c[0]} />
        <stop offset=".55" stopColor={o.c[1]} />
        <stop offset="1" stopColor={o.c[2]} />
      </radialGradient>
      <radialGradient id={`${u}h${k}`}>
        <stop offset="0" stopColor={o.glow} stopOpacity=".6" />
        <stop offset="1" stopColor={o.glow} stopOpacity="0" />
      </radialGradient>
    </g>
  ))
const moon = (u: string, k: number) => {
  const o = ORBITS[k]
  return (
    <>
      <circle r={o.m * 2.3} fill={`url(#${u}h${k})`} />
      <circle r={o.m} fill={`url(#${u}m${k})`} stroke="#000" strokeOpacity=".25" strokeWidth=".3" />
      {o.craters && (
        <>
          <circle cx={-o.m * 0.32} cy={o.m * 0.22} r={o.m * 0.24} fill="#5f6c88" fillOpacity=".35" />
          <circle cx={o.m * 0.36} cy={-o.m * 0.12} r={o.m * 0.15} fill="#5f6c88" fillOpacity=".3" />
          <circle cx={o.m * 0.1} cy={o.m * 0.55} r={o.m * 0.12} fill="#5f6c88" fillOpacity=".3" />
        </>
      )}
    </>
  )
}

const orbitFront: Art = (u, px) => {
  const live = px >= FX_LIVE
  return (
    <>
      <defs>
        {orbitDefs(u)}
        <linearGradient id={`${u}r`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#9fb3d6" />
          <stop offset="1" stopColor="#e2ecff" />
        </linearGradient>
        <linearGradient id={`${u}n`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#1d2c5c" />
          <stop offset=".55" stopColor="#0b1430" />
          <stop offset="1" stopColor="#18264f" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="43" fill="none" stroke="#6fb8ff" strokeOpacity=".14" strokeWidth="12" />
      <circle cx="50" cy="50" r="41.7" fill="none" stroke={`url(#${u}n)`} strokeWidth="5.8" />
      {px >= 64 && ORBIT_STARS.map(([x, y, r], i) => <circle key={i} cx={n2(x)} cy={n2(y)} r={n2(r)} fill="#fff" fillOpacity=".8" />)}
      <circle cx="50" cy="50" r="44.6" fill="none" stroke={`url(#${u}r)`} strokeWidth="1.2" />
      <circle cx="50" cy="50" r="38.9" fill="none" stroke={`url(#${u}r)`} strokeWidth="1" />
      {ORBITS.map((o, k) => (
        <path key={k} d={orbitHalf(o, 'front')} transform={orbitPlace(o)} fill="none" stroke={o.glow} strokeOpacity=".75" strokeWidth=".75" />
      ))}
      {ORBITS.map((o, k) => orbit(o, 'front', live, moon(u, k), k, o.glow))}
      {live &&
        [
          [86, 14, 2.6, 0.2],
          [10, 84, 2.2, 0.7],
        ].map(([x, y, s, f]) => <path key={x} className={live ? 'bjx-tw' : undefined} style={live ? tm(3.4, f) : undefined} d={sparkle(x, y, s)} fill="#e6f0ff" />)}
    </>
  )
}
const orbitBack: Art = (u, px) => (
  <>
    <defs>{orbitDefs(u)}</defs>
    {ORBITS.map((o, k) => (
      <path key={k} d={orbitHalf(o, 'back')} transform={orbitPlace(o)} fill="none" stroke={o.glow} strokeOpacity=".4" strokeWidth=".75" />
    ))}
    {ORBITS.map((o, k) => orbit(o, 'back', px >= FX_LIVE, moon(u, k), k, o.glow))}
  </>
)

/* ---------------- Arcane ---------------- */

/** rune glyphs (after the elder futhark) in a box 3.2 wide and 6 tall round 0, 0, as M/L/V paths */
const GLYPHS = [
  'M-1 3V-3M-1 -1.4L1.4 -3M-1 .6L1.4 -1',
  'M-1.4 3V-3L1.4 -.8V3',
  'M-1 -3V3M-1 -1.6L1.2 0L-1 1.6',
  'M-1 3V-3M-1 -3L1.4 -1.2M-1 -.8L1.4 1',
  'M-1.3 3V-3L1.3 -1.5L-1.3 0L1.3 3',
  'M1.2 -3L-1.2 0L1.2 3',
  'M-1.5 -3L1.5 3M1.5 -3L-1.5 3',
  'M-1 3V-3L1.3 -1.5L-1 0',
  'M-1.4 -3V3M1.4 -3V3M-1.4 -1.2L1.4 1.2',
  'M0 -3V3M-1.3 -1L1.3 1',
  'M-.3 -3L-1.5 -1.2L-.3 .4M.3 -.4L1.5 1.2L.3 3',
  'M0 3V-3M-1.5 -1.4L0 0L1.5 -1.4',
  'M1.2 -3L-1.2 -.6L1.2 .6L-1.2 3',
  'M0 3V-3M-1.5 -1.3L0 -3L1.5 -1.3',
  'M-1 -3V3M-1 -3L1.2 -1.5L-1 0L1.2 1.5L-1 3',
  'M-1.4 3V-3L0 -1.2L1.4 -3V3',
  'M-1.4 3V-3L1.4 3V-3M-1.4 -1L1.4 -1',
  'M-1.5 3L1.2 -.2L0 -2.2L-1.2 -.2L1.5 3',
]
/** a glyph moved to (x, y), turned and scaled, as absolute path data (so a whole ring of runes is one path) */
function placeGlyph(d: string, x: number, y: number, rot: number, s: number) {
  const c = Math.cos((rot * Math.PI) / 180)
  const sn = Math.sin((rot * Math.PI) / 180)
  const tx = (px: number, py: number) => `${n2(x + (px * c - py * sn) * s)} ${n2(y + (px * sn + py * c) * s)}`
  const tokens = d.match(/[MLV]|-?\d*\.?\d+/g) ?? []
  let out = ''
  let cmd = ''
  let cx = 0
  let cy = 0
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]
    if (t === 'M' || t === 'L' || t === 'V') {
      cmd = t
      i++
    } else if (cmd === 'V') {
      cy = Number(t)
      out += `L${tx(cx, cy)}`
      i++
    } else {
      cx = Number(t)
      cy = Number(tokens[i + 1])
      out += `${cmd === 'M' ? 'M' : 'L'}${tx(cx, cy)}`
      if (cmd === 'M') cmd = 'L'
      i += 2
    }
  }
  return out
}
const runeRing = (n: number, r: number, s: number, step: number, from: number, off = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 360 + off
    const [x, y] = at(r, a)
    return placeGlyph(GLYPHS[(i * step + from) % GLYPHS.length], x, y, a + 90, s)
  }).join('')
const RUNES_OUT = runeRing(18, 46.3, 0.56, 7, 0)
const RUNES_IN = runeRing(13, 41.65, 0.48, 11, 3, 7)
const SIGIL = [0, 45].map((o) => `M${[0, 90, 180, 270].map((a) => P(55, a + o)).join('L')}Z`).join('')

const runes: Art = (u, px) => {
  const live = px >= FX_LIVE
  const small = px < 36
  const fine = px >= 60
  return (
    <>
      <defs>
        <linearGradient id={`${u}b`} x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stopColor="#2c2070" />
          <stop offset=".5" stopColor="#140c38" />
          <stop offset="1" stopColor="#2a1b66" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}b)`} strokeWidth="10.4" />
      <circle cx="50" cy="50" r="44" fill="none" stroke="#8a7dff" strokeOpacity=".5" strokeWidth=".5" />
      <circle cx="50" cy="50" r="48.7" fill="none" stroke="#9fe9ff" strokeOpacity=".9" strokeWidth=".7" />
      <circle cx="50" cy="50" r="39.3" fill="none" stroke="#9fe9ff" strokeOpacity=".8" strokeWidth=".6" />
      {fine && <circle cx="50" cy="50" r="47.7" fill="none" stroke="#9fe9ff" strokeOpacity=".4" strokeWidth=".4" strokeDasharray=".6 1.4" />}
      {!small ? (
        <>
          <g className={live ? 'bjx-rot' : undefined} style={live ? tm(46) : undefined}>
            <path d={RUNES_OUT} fill="none" stroke="#5fd8ff" strokeOpacity=".42" strokeWidth={fine ? 1.5 : 2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={RUNES_OUT} fill="none" stroke="#e8fdff" strokeWidth={fine ? 0.55 : 0.8} strokeLinecap="round" strokeLinejoin="round" />
          </g>
          {fine && (
            <g className={live ? 'bjx-rot bjx-rev' : undefined} style={live ? tm(34) : undefined}>
              <path d={RUNES_IN} fill="none" stroke="#b48cff" strokeOpacity=".45" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d={RUNES_IN} fill="none" stroke="#f1e8ff" strokeWidth=".5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )}
          {live && <circle className="bjx-rot bjx-rev" style={tm(5)} cx="50" cy="50" r="46.3" fill="none" stroke="#dffcff" strokeOpacity=".45" strokeWidth="4.6" strokeDasharray="14 276.9" />}
        </>
      ) : (
        <circle cx="50" cy="50" r="46.3" fill="none" stroke="#bff6ff" strokeOpacity=".7" strokeWidth="2" strokeDasharray="1.2 3" />
      )}
      {[0, 90, 180, 270].map((a, i) => {
        const [x, y] = at(49.2, a)
        return (
          <g key={a} className={live ? 'bjx-pulse' : undefined} style={live ? tm(2.6, i * 0.25) : undefined}>
            <path d={`M${n2(x)} ${n2(y - 2.6)}L${n2(x + 1.7)} ${n2(y)}L${n2(x)} ${n2(y + 2.6)}L${n2(x - 1.7)} ${n2(y)}Z`} fill="#7df9ff" stroke="#e8fdff" strokeWidth=".4" />
          </g>
        )
      })}
    </>
  )
}
const runesBack: Art = (_u, px) => (
  <g className={px >= FX_LIVE ? 'bjx-rot bjx-rev' : undefined} style={px >= FX_LIVE ? tm(60) : undefined}>
    <circle cx="50" cy="50" r="52" fill="none" stroke="#7b5cff" strokeOpacity=".22" strokeWidth="6" />
    <path d={SIGIL} fill="none" stroke="#a48cff" strokeOpacity=".8" strokeWidth=".9" strokeLinejoin="round" />
    {Array.from({ length: 8 }, (_, i) => {
      const [x, y] = at(55, i * 45)
      return <circle key={i} cx={n2(x)} cy={n2(y)} r=".95" fill="#dffcff" />
    })}
  </g>
)

/* ---------------- Kaiju ---------------- */

const PLATES = [-62, -41, -20.5, 0, 20.5, 41, 62].map((a, i) => ({ a, h: [8.4, 11, 13.4, 15.2, 13.4, 11, 8.4][i] }))
/** a dorsal plate standing on y = b at the top: a jagged leaf, k scales it about its base */
function plate(h: number, k = 1, b = 3.2) {
  const w = h * 0.44 * k
  const H = h * k
  const p = (x: number, y: number) => `${n2(50 + x * w)} ${n2(b - y * H)}`
  return `M${p(-1, 0)}L${p(-0.92, 0.42)}L${p(-0.5, 0.5)}L${p(-0.38, 0.84)}L${p(0, 1)}L${p(0.4, 0.8)}L${p(0.55, 0.48)}L${p(0.95, 0.4)}L${p(1, 0)}Z`
}
/** every kaiju animation shares one 4 s cycle, started half-way so a still (reduced motion) has the plates charged */
const KAIJU_T = { animationDelay: '-2s' }
const CLAWS = [126, 136, 146].map((a) => `M${P(48.4, a - 5)}L${P(39.8, a + 6)}`)
const RUBBLE = [
  'M38 98.2l1.6-1.8 2.2.4.6 1.8-1.8 1.2z',
  'M56.4 99l1.2-2 2.4.2.4 1.6-1.6 1.4z',
  'M47.2 100.2l1-1.2 1.6.2.2 1.2-1.2.8z',
]

const kaiju: Art = (u, px) => {
  const live = px >= FX_LIVE
  const fine = px >= 64
  return (
    <g className={live ? 'bjx-quake' : undefined} style={live ? KAIJU_T : undefined}>
      <defs>
        <linearGradient id={`${u}k`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#4f8f6a" />
          <stop offset=".45" stopColor="#2f6b4f" />
          <stop offset=".8" stopColor="#1c4231" />
          <stop offset="1" stopColor="#0f2a1f" />
        </linearGradient>
        <linearGradient id={`${u}p`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#5d7f55" />
          <stop offset=".5" stopColor="#a9c99a" />
          <stop offset="1" stopColor="#e2f2d6" />
        </linearGradient>
        <pattern id={`${u}s`} width="3.4" height="2.6" patternUnits="userSpaceOnUse">
          <path d="M0 2.6A1.7 1.7 0 0 1 3.4 2.6M-1.7 1.3A1.7 1.7 0 0 1 1.7 1.3M1.7 1.3A1.7 1.7 0 0 1 5.1 1.3" fill="none" stroke="#06170f" strokeOpacity=".55" strokeWidth=".35" />
        </pattern>
      </defs>
      {PLATES.map((p, i) => (
        <g key={i} transform={`rotate(${p.a} 50 50)`}>
          <path d={plate(p.h, 1.22)} fill="#5fe0ff" fillOpacity={live ? 0.3 : 0.16} />
          <path d={plate(p.h)} fill={`url(#${u}p)`} stroke="#0f2a1f" strokeWidth=".6" strokeLinejoin="round" />
          <path className={live ? `bjx-kp${i}` : undefined} style={live ? KAIJU_T : undefined} d={plate(p.h, 0.6)} fill="#5fe0ff" fillOpacity={live ? 1 : 0.75} />
          {fine && <path d={plate(p.h, 0.3)} fill="#eaffff" className={live ? `bjx-kp${i}` : undefined} style={live ? KAIJU_T : undefined} fillOpacity={live ? 1 : 0.75} />}
        </g>
      ))}
      <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}k)`} strokeWidth="10.4" />
      {fine && <circle cx="50" cy="50" r="44" fill="none" stroke={`url(#${u}s)`} strokeWidth="10.4" />}
      <circle cx="50" cy="50" r="48.8" fill="none" stroke="#a9c99a" strokeOpacity=".7" strokeWidth=".8" />
      <circle cx="50" cy="50" r="39.2" fill="none" stroke="#a9c99a" strokeOpacity=".55" strokeWidth=".8" />
      <circle cx="50" cy="50" r="38.6" fill="none" stroke="#06170f" strokeOpacity=".6" strokeWidth=".9" />
      {CLAWS.map((d, i) => (
        <g key={i}>
          <path d={d} stroke="#06120c" strokeWidth="2" strokeLinecap="round" />
          <path d={d} stroke="#ff4f72" strokeWidth=".7" strokeLinecap="round" className={live ? 'bjx-pulse' : undefined} style={live ? tm(2, i * 0.2) : undefined} />
        </g>
      ))}
      {live && (
        <>
          <path className="bjx-kflash" style={KAIJU_T} d={arc(47.5, -150, -30)} fill="none" stroke="#5fe0ff" strokeOpacity=".45" strokeWidth="12" strokeLinecap="round" />
          <circle className="bjx-kflash" style={KAIJU_T} cx="50" cy="50" r="40" fill="none" stroke="#bff6ff" strokeOpacity=".75" strokeWidth="1.4" />
        </>
      )}
      {RUBBLE.map((d, i) => (
        <path key={i} d={d} fill="#4a5a50" stroke="#0f2a1f" strokeWidth=".4" className={live ? 'bjx-hop' : undefined} style={live ? { animationDelay: `${-2 - i * 0.04}s` } : undefined} />
      ))}
    </g>
  )
}

/* ---------------- Inferno ---------------- */

/** flames stand tallest at the top of the ring and lowest at the bottom */
const tall = (a: number) => 0.52 + 0.48 * ((1 + Math.cos((a * Math.PI) / 180)) / 2)
const INFERNO = [
  { n: 16, w: 4.4, h: 18, off: 0.5, g: 'b', dur: 1.15, b: 8.6 },
  { n: 16, w: 3.6, h: 14, off: 0, g: 'm', dur: 0.9, b: 8.6 },
  { n: 16, w: 2.3, h: 8.6, off: 0.5, g: 'f', dur: 0.7, b: 4.6 },
]
const INF_CRACKS = (() => {
  const r = seq(13)
  return Array.from({ length: 9 }, (_, i) => {
    const a = i * 40 + r() * 16
    return arcBolt(r, 42.2, a, a + 16 + r() * 14, 1.7, 5)
  })
})()
const INF_EMBERS = (() => {
  const r = seq(31)
  return Array.from({ length: 11 }, (_, i) => {
    const a = -152 + (i / 10) * 124 + (r() - 0.5) * 10
    const [x, y] = at(47 + r() * 3, a)
    return { x, y, rs: 0.55 + r() * 0.6, dy: -(10 + r() * 9), sx: (r() - 0.5) * 7, dur: 1.6 + r() * 1.4, f: r() }
  })
})()
const flameLayer = (u: string, L: (typeof INFERNO)[number], live: boolean, skip: number) =>
  Array.from({ length: L.n }, (_, i) => {
    if (i % skip) return null
    const a = ((i + L.off) / L.n) * 360
    const k = tall(a)
    return (
      <g key={i} transform={`rotate(${n2(a)} 50 50) translate(50 ${L.b}) scale(1 ${n2(k)}) translate(-50 ${-L.b})`}>
        <path className={live ? 'bjx-fl' : undefined} style={live ? tm(L.dur * (0.85 + (i % 3) * 0.12), i * 0.13) : undefined} d={tongue(L.w, L.h, L.b)} fill={`url(#${u}${L.g})`} />
      </g>
    )
  })

const inferno: Art = (u, px) => {
  const live = px >= FX_LIVE
  const skip = px < 36 ? 2 : 1
  return (
    <>
      <defs>
        {(
          [
            ['b', ['#ff6a1c', '#d61f10', '#8a0a0a']],
            ['m', ['#ffd34a', '#ff8a1f', '#ff3b1c']],
            ['f', ['#fffbe0', '#ffe27a', '#ffa22e']],
          ] as const
        ).map(([k, c]) => (
          <linearGradient key={k} id={`${u}${k}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={c[0]} />
            <stop offset=".42" stopColor={c[1]} />
            <stop offset=".8" stopColor={c[2]} stopOpacity=".55" />
            <stop offset="1" stopColor={c[2]} stopOpacity="0" />
          </linearGradient>
        ))}
        <linearGradient id={`${u}r`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor="#4a1a0a" />
          <stop offset=".6" stopColor="#240904" />
          <stop offset="1" stopColor="#3a1206" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke="#ff5a1f" strokeOpacity=".2" strokeWidth="18" />
      {flameLayer(u, INFERNO[0], live, skip)}
      {flameLayer(u, INFERNO[1], live, skip)}
      <circle cx="50" cy="50" r="42.2" fill="none" stroke={`url(#${u}r)`} strokeWidth="7.4" />
      <g className={live ? 'bjx-pulse' : undefined} style={live ? tm(2.2) : undefined}>
        {INF_CRACKS.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#ff6a1f" strokeOpacity=".55" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {INF_CRACKS.map((d, i) => (
          <path key={`c${i}`} d={d} fill="none" stroke="#ffd27a" strokeWidth=".55" strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </g>
      {flameLayer(u, INFERNO[2], live, skip)}
      <circle cx="50" cy="50" r="45.9" fill="none" stroke="#ffcf6b" strokeOpacity=".85" strokeWidth=".8" />
      <circle cx="50" cy="50" r="38.9" fill="none" stroke="#1a0500" strokeWidth="1.2" />
      <circle cx="50" cy="50" r="39.6" fill="none" stroke="#ff8a2a" strokeOpacity=".8" strokeWidth=".7" />
      {live &&
        INF_EMBERS.map((e, i) => (
          <g key={i} className="bjx-drift" style={{ ...tm(e.dur, e.f), ...vars({ '--dy': `${n2(e.dy)}px`, '--sx': `${n2(e.sx)}px`, '--dx': `${n2(-e.sx * 0.4)}px`, '--s1': 0.4 }) }}>
            <circle cx={n2(e.x)} cy={n2(e.y)} r={n2(e.rs * 2.4)} fill="#ff8a2a" fillOpacity=".3" />
            <circle cx={n2(e.x)} cy={n2(e.y)} r={n2(e.rs)} fill="#ffe08a" />
          </g>
        ))}
    </>
  )
}

/* ---------------- Thunderhead ---------------- */

/** the cloud bank: an outer and an inner ring of overlapping puffs, lit from above as one mass */
const PUFFS_OUT = Array.from({ length: 18 }, (_, i) => {
  const [x, y] = at(47.2 + (i % 2) * 1.4, (i / 18) * 360 + (i % 3) * 3)
  return { x, y, r: 5.4 + (i % 3) * 0.8 }
})
const PUFFS_IN = Array.from({ length: 14 }, (_, i) => {
  const [x, y] = at(43.6, ((i + 0.5) / 14) * 360)
  return { x, y, r: 4 + (i % 2) * 0.7 }
})
const PUFFS = [...PUFFS_OUT, ...PUFFS_IN]
const STORM_BOLTS = (() => {
  const r = seq(57)
  return [148, 212, 72, 288, 18].map((a, i) => {
    const main = bolt(r, 50, 3.5, 50 + (r() - 0.5) * 6, -13 - r() * 3, 2.6, 5)
    const [fx, fy] = main.pts[2]
    const fork = bolt(r, fx, fy, fx + (r() < 0.5 ? -1 : 1) * (4 + r() * 3), fy - 6 - r() * 3, 1.4, 3)
    return { a, d: main.d + fork.d, dur: [4.3, 5.9, 6.7, 7.9, 9.1][i], f: r() }
  })
})()
const RAIN = (() => {
  const r = seq(61)
  return Array.from({ length: 8 }, (_, i) => ({ x: 24 + i * 7.4 + r() * 3, y: 97 + r() * 3, f: r(), dur: 0.75 + r() * 0.35 }))
})()

const storm: Art = (u, px) => {
  const live = px >= FX_LIVE
  const small = px < 36
  const fine = px >= 64
  // one mass of cloud: a dark underside and a lit top edge peek out from under the puffs, which breathe one by one
  const list = !small ? PUFFS : PUFFS.filter((_, i) => i % 2 === 0)
  return (
    <>
      <defs>
        <radialGradient id={`${u}f`}>
          <stop offset="0" stopColor="#f2f8ff" stopOpacity=".95" />
          <stop offset=".4" stopColor="#9fc8ff" stopOpacity=".5" />
          <stop offset="1" stopColor="#9fc8ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}c`} gradientUnits="userSpaceOnUse" x1="0" y1="-6" x2="0" y2="106">
          <stop offset="0" stopColor="#66779c" />
          <stop offset=".42" stopColor="#394667" />
          <stop offset="1" stopColor="#1c233c" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#141c30" strokeWidth="9" />
      {list.map((p, i) => (
        <circle key={`s${i}`} cx={n2(p.x)} cy={n2(p.y + 1.6)} r={p.r} fill="#070b16" />
      ))}
      {list.map((p, i) => (
        <circle key={`l${i}`} cx={n2(p.x)} cy={n2(p.y - 1.1)} r={p.r} fill="#a3b3d8" />
      ))}
      {list.map((p, i) => (
        <circle key={i} className={live && fine ? 'bjx-billow' : undefined} style={live && fine ? tm(4 + (i % 4) * 0.9, i * 0.17) : undefined} cx={n2(p.x)} cy={n2(p.y)} r={p.r} fill={`url(#${u}c)`} />
      ))}
      {live && (
        <g className="bjx-sflash">
          {PUFFS.map((p, i) => (
            <circle key={i} cx={n2(p.x)} cy={n2(p.y)} r={p.r} fill="#c4dcff" fillOpacity=".45" />
          ))}
        </g>
      )}
      {live
        ? STORM_BOLTS.map((b, i) => (
            <g key={i} transform={`rotate(${b.a} 50 50)`} className="bjx-bolt" style={tm(b.dur, b.f)}>
              <circle cx="50" cy="4" r="10" fill={`url(#${u}f)`} />
              <path d={b.d} fill="none" stroke="#9fd4ff" strokeOpacity=".55" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
              <path d={b.d} fill="none" stroke="#ffffff" strokeWidth=".9" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))
        : (
          <g transform="rotate(148 50 50)">
            <path d={STORM_BOLTS[0].d} fill="none" stroke="#e8f4ff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        )}
      {live &&
        RAIN.map((d, i) => (
          <path key={i} className="bjx-rain" style={tm(d.dur, d.f)} d={`M${n2(d.x)} ${n2(d.y)}l-1.2 3.4`} stroke="#a8c8ff" strokeOpacity=".8" strokeWidth=".55" strokeLinecap="round" />
        ))}
      <circle cx="50" cy="50" r="39.1" fill="none" stroke="#a8bde6" strokeOpacity=".8" strokeWidth=".8" />
      <circle cx="50" cy="50" r="38.6" fill="none" stroke="#05080f" strokeOpacity=".6" strokeWidth=".8" />
    </>
  )
}

/* ---------------- Liquid Gold ---------------- */

/** the molten ring: a lumpy outer edge round a clean inner circle; shaded by a radial gradient, so it can turn */
const GOLD_WAVE = (() => {
  const out: string[] = []
  for (let i = 0; i < 120; i++) {
    const a = i * 3
    const t = (a * Math.PI) / 180
    out.push(P(48.3 + 1.25 * Math.sin(6 * t) + 0.55 * Math.sin(11 * t + 1.3), a))
  }
  return `M${out.join('L')}ZM${P(38.8, 0)}A38.8 38.8 0 1 0 ${P(38.8, 180)}A38.8 38.8 0 1 0 ${P(38.8, 0)}Z`
})()
const DRIPS = [68, 84, 99, 113].map((a, i) => {
  const [x, y] = at(47, a)
  return { x, y, L: [10.5, 14, 12, 9][i], f: [0, 0.45, 0.2, 0.7][i], dur: [3.4, 4.1, 3.7, 4.6][i] }
})
const dripPath = (L: number) => `M-2.7 0C-2.7 ${n2(L * 0.4)} -1.45 ${n2(L * 0.6)} -1.45 ${n2(L * 0.8)}A1.55 1.55 0 1 0 1.45 ${n2(L * 0.8)}C1.45 ${n2(L * 0.6)} 2.7 ${n2(L * 0.4)} 2.7 0Z`
const RUNS = [
  { a: -12, s: 78, f: 0 },
  { a: 192, s: -78, f: 0.5 },
  { a: 26, s: 50, f: 0.3 },
  { a: 154, s: -50, f: 0.8 },
]

const liquidgold: Art = (u, px) => {
  const live = px >= FX_LIVE
  const small = px < 36
  return (
    <>
      <defs>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="51">
          <stop offset=".76" stopColor="#8a5208" />
          <stop offset=".81" stopColor="#e0a530" />
          <stop offset=".865" stopColor="#fff3b8" />
          <stop offset=".905" stopColor="#f7c548" />
          <stop offset=".955" stopColor="#b37812" />
          <stop offset="1" stopColor="#7a4606" />
        </radialGradient>
        <linearGradient id={`${u}d`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7c548" />
          <stop offset=".55" stopColor="#ffe28a" />
          <stop offset="1" stopColor="#c98a14" />
        </linearGradient>
        <radialGradient id={`${u}b`} fx=".35" fy=".3">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset=".6" stopColor="#f7c548" />
          <stop offset="1" stopColor="#a8680c" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="45" fill="none" stroke="#f7c548" strokeOpacity=".16" strokeWidth="14" />
      {DRIPS.filter((_, i) => !small || i % 2).map((d, i) => (
        <g key={i} transform={`translate(${n2(d.x)} ${n2(d.y)})`}>
          <path className={live ? 'bjx-drip' : undefined} style={live ? tm(d.dur, d.f) : undefined} d={dripPath(d.L)} fill={`url(#${u}d)`} stroke="#7a4606" strokeOpacity=".45" strokeWidth=".4" />
          {live && <circle className="bjx-drop" style={tm(d.dur, d.f)} cx="0" cy={n2(d.L * 0.8 + 1.5)} r="1.5" fill={`url(#${u}b)`} />}
        </g>
      ))}
      <g className={live ? 'bjx-rot' : undefined} style={live ? tm(40) : undefined}>
        <path d={GOLD_WAVE} fillRule="evenodd" fill={`url(#${u}g)`} stroke="#6b3d04" strokeOpacity=".5" strokeWidth=".5" />
      </g>
      {live &&
        RUNS.map((r, i) => {
          const [x, y] = at(48.7, r.a)
          return (
            <g key={i} className="bjx-run" style={{ ...tm(5.2, r.f), ...vars({ '--sweep': `${r.s}deg` }) }}>
              <circle cx={n2(x)} cy={n2(y)} r="2" fill={`url(#${u}b)`} />
            </g>
          )
        })}
      <path d={arc(44, 20, 110)} fill="none" stroke="#5a3204" strokeOpacity=".28" strokeWidth="6" />
      <path d={arc(45.6, 190, 260)} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.9" strokeLinecap="round" />
      <path d={arc(43.4, 205, 235)} fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth=".9" strokeLinecap="round" />
      {live && (
        <g className="bjx-roll" style={tm(6)}>
          <path d={arc(44.6, 215, 243)} fill="none" stroke="#fffbe6" strokeOpacity=".75" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}
      <circle cx="50" cy="50" r="38.7" fill="none" stroke="#4a2a02" strokeOpacity=".55" strokeWidth=".9" />
      {!small &&
        [
          [20, 18, 3.6, 0],
          [86, 34, 2.4, 0.5],
        ].map(([x, y, s, f]) => <path key={x} className={live ? 'bjx-tw' : undefined} style={live ? tm(3.2, f) : undefined} d={sparkle(x, y, s)} fill="#fffbe6" />)}
    </>
  )
}

/* ---------------- Ouroboros ---------------- */

/** the dragon's body: from the neck behind its head (top, -76°) clockwise all the way round to the tail in its mouth */
const SERPENT = (() => {
  const R = 44
  const a0 = -76
  const a1 = 260
  const N = 112
  const half = (t: number) => (1.6 + 9 * Math.pow(1 - t, 0.9)) / 2
  const angle = (t: number) => a0 + (a1 - a0) * t
  const outer: string[] = []
  const inner: string[] = []
  const belly: string[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const a = angle(t)
    const h = half(t)
    outer.push(P(R + h, a))
    inner.push(P(R - h, a))
    belly.push(P(R - h * 0.42, a))
  }
  const body = `M${outer.join('L')}L${P(R, a1 + 3)}L${[...inner].reverse().join('L')}Z`
  const bellyD = `M${inner.join('L')}L${[...belly].reverse().join('L')}Z`
  const scales: string[] = []
  const fins: string[] = []
  const bands: string[] = []
  for (let a = a0 + 8; a < a1 - 4; a += 6.5) {
    const t = (a - a0) / (a1 - a0)
    const h = half(t)
    scales.push(`M${P(R + h * 0.72, a - 1.6)}L${P(R + h * 0.05, a + 2)}L${P(R - h * 0.32, a - 1)}`)
    bands.push(`M${P(R - h, a + 3)}L${P(R - h * 0.44, a + 3)}`)
  }
  for (let a = a0 + 12; a < a1 - 40; a += 12) {
    const h = half((a - a0) / (a1 - a0))
    fins.push(`M${P(R + h - 0.5, a - 3)}L${P(R + h + h * 0.85, a + 4.2)}L${P(R + h - 0.5, a + 2.6)}Z`)
  }
  // a sheen along the back, thinning toward the tail
  const ridge = `M${Array.from({ length: 60 }, (_, i) => {
    const t = (i / 59) * 0.92
    return P(R + half(t) * 0.48, angle(t))
  }).join('L')}`
  return { body, belly: bellyD, scales: scales.join(''), bands: bands.join(''), fins: fins.join(''), ridge }
})()

const serpent: Art = (u, px) => {
  const live = px >= FX_LIVE
  const fine = px >= 60
  return (
    <>
      <defs>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="52">
          <stop offset=".72" stopColor="#0f5c3b" />
          <stop offset=".83" stopColor="#36c482" />
          <stop offset=".9" stopColor="#24a068" />
          <stop offset="1" stopColor="#0b3f29" />
        </radialGradient>
        <linearGradient id={`${u}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8dffc8" />
          <stop offset=".45" stopColor="#2cae72" />
          <stop offset="1" stopColor="#0f5a3a" />
        </linearGradient>
        <linearGradient id={`${u}o`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset="1" stopColor="#d99a1c" />
        </linearGradient>
        <linearGradient id={`${u}y`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0b0" />
          <stop offset="1" stopColor="#d99a1c" />
        </linearGradient>
        <clipPath id={`${u}c`}>
          <path d={SERPENT.body} />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="45" fill="none" stroke="#22d36f" strokeOpacity=".12" strokeWidth="14" />
      <circle cx="50" cy="50" r="39.6" fill="none" stroke="#0a3825" strokeWidth="1.8" />
      <circle cx="50" cy="50" r="40.4" fill="none" stroke="#e9b44a" strokeOpacity=".7" strokeWidth=".5" />
      <g className={live ? 'bjx-rot' : undefined} style={live ? tm(44) : undefined}>
        <path d={SERPENT.fins} fill="#1fa86a" stroke="#062b1c" strokeWidth=".5" strokeLinejoin="round" />
        {fine && <path d={SERPENT.fins} fill="none" stroke="#a8ffd6" strokeOpacity=".55" strokeWidth=".35" strokeLinejoin="round" transform="translate(0 .25)" />}
        <path d={SERPENT.body} fill={`url(#${u}g)`} stroke="#062b1c" strokeWidth=".8" strokeLinejoin="round" />
        <path d={SERPENT.belly} fill={`url(#${u}y)`} />
        {fine && <path d={SERPENT.bands} stroke="#8a5a08" strokeOpacity=".55" strokeWidth=".35" />}
        {fine && <path d={SERPENT.scales} fill="none" stroke="#06301f" strokeOpacity=".6" strokeWidth=".5" strokeLinejoin="round" />}
        <path d={SERPENT.ridge} fill="none" stroke="#b4ffdc" strokeOpacity=".4" strokeWidth=".7" strokeLinecap="round" />
        {live && (
          <g clipPath={`url(#${u}c)`}>
            <circle className="bjx-rot" style={tm(3.6)} cx="50" cy="50" r="45.4" fill="none" stroke="#e8fff2" strokeOpacity=".55" strokeWidth="2.4" strokeDasharray="26 250" strokeLinecap="round" />
          </g>
        )}
        {/* the head, a size up from the body so it reads at a glance */}
        <g transform="translate(58 6) scale(1.28) translate(-58 -6)">
          <path d="M62.4 0C65 -3.6 68.6 -5.8 72.4 -6.2C69.6 -4.2 67.4 -1.8 66.2 1Z" fill={`url(#${u}o)`} stroke="#3a2400" strokeWidth=".45" />
          <path d="M58.6 -1C60.4 -5 63.4 -8 67 -9.4C64.6 -7 63 -4.2 62.4 -.6Z" fill={`url(#${u}o)`} stroke="#3a2400" strokeWidth=".45" />
          <g className={live ? 'bjx-jaw' : undefined} style={live ? { transformOrigin: '60px 9px' } : undefined}>
            <path d="M54.5 7.6C51 7.8 46.5 8.2 43.2 9.2C42 9.6 42 10.6 43.4 10.8C47 11.2 51.5 11.4 55.5 11.8C58 12 60 11.8 61.5 10.4Z" fill="#14674a" stroke="#062b1c" strokeWidth=".6" strokeLinejoin="round" />
            <path d="M44.4 9.3l.6-1.4.6 1.3M47 8.9l.6-1.5.6 1.4M49.8 8.6l.5-1.3.5 1.2" fill="#fff" stroke="#fff" strokeWidth=".2" />
          </g>
          <path d="M63.4 2.2C61.4 -1.6 56.8 -2.8 52.8 -1.6C49.2 -.6 45.6 .8 42 2C40.2 2.6 39.4 3.8 40.2 4.8C41.4 5.8 44 5.4 46.5 5.6L54 6.2C57 6.6 60 8.2 61.5 10.4C63.4 8.4 64.4 5 63.4 2.2Z" fill={`url(#${u}h)`} stroke="#062b1c" strokeWidth=".65" strokeLinejoin="round" />
          <path d="M44.6 5.5l.55 1.3.55-1.2M47.4 5.7l.55 1.4.55-1.3M50.2 5.9l.5 1.2.5-1.1" fill="#fff" stroke="#fff" strokeWidth=".2" />
          <path d="M49 .4C50.6 -.6 53 -.8 54.6 .2" fill="none" stroke="#062b1c" strokeWidth=".7" strokeLinecap="round" />
          <circle className={live ? 'bjx-pulse' : undefined} style={live ? tm(1.8) : undefined} cx="52.2" cy="2.1" r="3" fill="#ffcc3d" fillOpacity=".4" />
          <ellipse cx="52.2" cy="2.1" rx="1.5" ry="1.05" fill="#ffd34f" stroke="#7a3a00" strokeWidth=".3" />
          <path d="M52.3 1.2V3" stroke="#2a0a00" strokeWidth=".55" strokeLinecap="round" />
          <circle cx="42.4" cy="3" r=".45" fill="#062b1c" />
        </g>
      </g>
    </>
  )
}

/* ---------------- Event Horizon ---------------- */

/** the accretion disk: a circle squashed into an ellipse, so its dashes flowing round the circle flow round the ellipse */
const DISK = { tilt: -14, sq: 0.2 }
const DISK_STREAMS = [
  { r: 50.5, w: 1.3, c: '#fff6d6', dash: '9 5 3 7', dur: 2.6 },
  { r: 53.5, w: 2, c: '#ffc46b', dash: '14 6 5 9', dur: 3.6 },
  { r: 56.8, w: 1.8, c: '#ff8a3d', dash: '20 9 7 12', dur: 5 },
  { r: 60, w: 1.2, c: '#d6407e', dash: '11 14 6 18', dur: 7 },
]
const INFALL = (() => {
  const r = seq(83)
  return Array.from({ length: 7 }, (_, i) => ({ r0: 56 + r() * 8, dur: 2.2 + r() * 1.4, spin: 3 + r() * 3, f: i / 7, rot: r() * 360, s: 0.6 + r() * 0.5 }))
})()
const disk = (u: string, half: 'front' | 'back', live: boolean) => (
  <g transform={`translate(50 50) rotate(${DISK.tilt}) scale(1 ${DISK.sq})`} clipPath={`url(#${u}${half})`}>
    <circle r="55" fill="none" stroke={`url(#${u}dp)`} strokeWidth="11" strokeOpacity=".9" />
    {DISK_STREAMS.map((s, i) => (
      <circle key={i} className={live ? 'bjx-rot0' : undefined} style={live ? tm(s.dur, i * 0.3) : undefined} r={s.r} fill="none" stroke={s.c} strokeOpacity=".85" strokeWidth={s.w} strokeDasharray={s.dash} />
    ))}
  </g>
)
const diskDefs = (u: string) => (
  <>
    <linearGradient id={`${u}dp`} gradientUnits="userSpaceOnUse" x1="-60" y1="0" x2="60" y2="0">
      <stop offset="0" stopColor="#fffbe6" />
      <stop offset=".35" stopColor="#ffc46b" />
      <stop offset=".7" stopColor="#ff6a3d" stopOpacity=".8" />
      <stop offset="1" stopColor="#a8287a" stopOpacity=".55" />
    </linearGradient>
    <clipPath id={`${u}front`}>
      <rect x="-80" y="0" width="160" height="80" />
    </clipPath>
    <clipPath id={`${u}back`}>
      <rect x="-80" y="-80" width="160" height="80" />
    </clipPath>
  </>
)

const blackhole: Art = (u, px) => {
  const live = px >= FX_LIVE
  const small = px < 36
  return (
    <>
      <defs>
        {diskDefs(u)}
        <linearGradient id={`${u}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe7a8" />
          <stop offset=".5" stopColor="#ff8a3d" stopOpacity=".7" />
          <stop offset="1" stopColor="#ffd38a" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="43.6" fill="none" stroke="#05010c" strokeOpacity=".9" strokeWidth="9.6" />
      <circle cx="50" cy="50" r="42.4" fill="none" stroke={`url(#${u}l)`} strokeWidth="2.6" />
      <circle cx="50" cy="50" r="45" fill="none" stroke={`url(#${u}l)`} strokeOpacity=".7" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="47.4" fill="none" stroke={`url(#${u}l)`} strokeOpacity=".4" strokeWidth=".9" />
      {live && (
        <>
          <circle className="bjx-rot" style={tm(2.4)} cx="50" cy="50" r="42.4" fill="none" stroke="#fffbe8" strokeOpacity=".8" strokeWidth="1.4" strokeDasharray="10 6 3 9 16 7" />
          <circle className="bjx-rot" style={tm(4.2, 0.3)} cx="50" cy="50" r="45" fill="none" stroke="#ffe0a0" strokeOpacity=".7" strokeWidth="1" strokeDasharray="6 11 18 5" />
        </>
      )}
      <circle cx="50" cy="50" r="40.5" fill="none" stroke="#5fd8ff" strokeOpacity=".6" strokeWidth=".5" />
      <circle cx="50" cy="50" r="38.9" fill="none" stroke="#ff4fd8" strokeOpacity=".5" strokeWidth=".5" />
      <circle cx="50" cy="50" r="39.7" fill="none" stroke="#fffbe8" strokeWidth="1.1" />
      {disk(u, 'front', live)}
      {live &&
        INFALL.map((p, i) => (
          <g key={i} transform={`translate(50 50) rotate(${n2(p.rot)})`}>
            <g className="bjx-rot0" style={tm(p.spin, p.f)}>
              <g className="bjx-fall" style={{ ...tm(p.dur, p.f), ...vars({ '--r0': `${n2(p.r0)}px` }) }}>
                <circle r={n2(p.s * 2.2)} fill="#ffd38a" fillOpacity=".3" />
                <circle r={n2(p.s * 0.8)} fill="#fffbe8" />
              </g>
            </g>
          </g>
        ))}
      {!small &&
        [
          [90, 12, 3.2, 0],
          [7, 86, 2.6, 0.45],
          [95, 80, 2, 0.75],
        ].map(([x, y, s, f]) => <path key={x} className={live ? 'bjx-tw' : undefined} style={live ? tm(2.8, f) : undefined} d={sparkle(x, y, s)} fill="#fff" />)}
    </>
  )
}
const blackholeBack: Art = (u, px) => (
  <>
    <defs>
      {diskDefs(u)}
      <radialGradient id={`${u}v`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="58">
        <stop offset=".64" stopColor="#05010c" stopOpacity=".95" />
        <stop offset=".84" stopColor="#140728" stopOpacity=".8" />
        <stop offset="1" stopColor="#1a0a3a" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="58" fill={`url(#${u}v)`} />
    {disk(u, 'back', px >= FX_LIVE)}
  </>
)

/* ---------------- Prism ---------------- */

const PRISM_FACETS = Array.from({ length: 24 }, (_, i) => {
  const a0 = (i / 24) * 360 - 90
  const a1 = ((i + 1) / 24) * 360 - 90
  return { a: `M${P(38.8, a0)}L${P(49.4, a0)}L${P(49.4, a1)}Z`, b: `M${P(38.8, a0)}L${P(49.4, a1)}L${P(38.8, a1)}Z` }
})
const SPECTRUM = ['#ff3b6b', '#ff9f3b', '#ffe53b', '#5cff8a', '#3bd8ff', '#8a6bff']
/** the rainbow fan leaving the prism's right face, toward the top right */
const FAN = SPECTRUM.map((_, i) => {
  const a0 = -44 + i * 6
  const [x0, y0] = at(23, a0, 54.4, 2)
  const [x1, y1] = at(23, a0 + 6, 54.4, 2)
  return `M54.4 2L${n2(x0)} ${n2(y0)}L${n2(x1)} ${n2(y1)}Z`
})
const CAUSTICS = Array.from({ length: 6 }, (_, i) => ({ a: i * 60 + 18, c: SPECTRUM[i] }))
const RING_MASK = (r0: number, r1: number) => `radial-gradient(circle closest-side, transparent ${r0}%, #000 ${r0 + 0.8}%, #000 ${r1 - 0.8}%, transparent ${r1}%)`

const prism: Art = (u, px) => {
  const live = px >= FX_LIVE
  const small = px < 36
  const fine = px >= 64
  return (
    <>
      <defs>
        <linearGradient id={`${u}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity=".95" />
        </linearGradient>
        <linearGradient id={`${u}p`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#e2f2ff" />
          <stop offset="1" stopColor="#b8c8ff" />
        </linearGradient>
        <clipPath id={`${u}k`}>
          <path d="M.6 50a49.4 49.4 0 1 0 98.8 0a49.4 49.4 0 1 0-98.8 0ZM11.2 50a38.8 38.8 0 1 0 77.6 0a38.8 38.8 0 1 0-77.6 0Z" clipRule="evenodd" />
        </clipPath>
      </defs>
      {PRISM_FACETS.map((f, i) => (
        <g key={i}>
          <path d={f.a} fill="#fff" fillOpacity={[0.5, 0.14, 0.38, 0.07][i % 4]} />
          <path d={f.b} fill="#1a0b40" fillOpacity={[0.3, 0.1, 0.22, 0.05][i % 4]} />
        </g>
      ))}
      {live && (
        <g clipPath={`url(#${u}k)`}>
          <g className="bjx-rot bjx-rev" style={tm(9)}>
            <path d={sector(38, 50, -24, 6)} fill="#fff" fillOpacity=".45" />
            <path d={sector(38, 50, 156, 172)} fill="#fff" fillOpacity=".3" />
          </g>
        </g>
      )}
      {fine &&
        Array.from({ length: 24 }, (_, i) => <path key={i} d={`M${P(38.8, i * 15 - 90)}L${P(49.4, i * 15 - 90)}`} stroke="#fff" strokeOpacity=".4" strokeWidth=".45" />)}
      <circle cx="50" cy="50" r="49.4" fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth=".9" />
      <circle cx="50" cy="50" r="38.9" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth=".9" />
      <circle cx="50" cy="50" r="38.3" fill="none" stroke="#1a0b40" strokeOpacity=".5" strokeWidth=".8" />
      {live && (
        <g className="bjx-rot" style={tm(11)}>
          {CAUSTICS.map((c, i) => {
            const [x, y] = at(44, c.a)
            return <path key={i} className={live ? 'bjx-tw' : undefined} style={live ? tm(2.2, i * 0.17) : undefined} d={sparkle(x, y, 2.4)} fill={c.c} />
          })}
        </g>
      )}
      {!small && (
        <>
          <path d="M22 -14L45.6 .8" stroke="#fff" strokeOpacity=".35" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M22 -14L45.6 .8" stroke="#fff" strokeWidth=".8" strokeLinecap="round" />
          <g className={live ? 'bjx-fan' : undefined} style={live ? { ...tm(4.4), transformOrigin: '54.4px 2px' } : { opacity: 0.7 }}>
            {FAN.map((d, i) => (
              <path key={i} d={d} fill={SPECTRUM[i]} fillOpacity=".7" />
            ))}
          </g>
        </>
      )}
      <path d="M50 -5.6L57.6 7.6H42.4Z" fill={`url(#${u}p)`} stroke="#fff" strokeWidth=".7" strokeLinejoin="round" />
      <path d="M50 -5.6L57.6 7.6H50Z" fill="#7b8cff" fillOpacity=".35" />
      <path d="M50 -5.6L50 7.6" stroke="#fff" strokeOpacity=".7" strokeWidth=".4" />
      <path d="M47.6 0L50 -3.4" stroke="#fff" strokeWidth=".7" strokeLinecap="round" />
      {!small &&
        [
          [88, 22, 3.6, 0],
          [9, 30, 2.8, 0.3],
          [84, 90, 3, 0.55],
          [14, 88, 2.2, 0.8],
          [62, 102, 2, 0.15],
        ].map(([x, y, s, f]) => <path key={x} className={live ? 'bjx-tw' : undefined} style={live ? tm(2.6, f) : undefined} d={sparkle(x, y, s)} fill="#fff" />)}
    </>
  )
}

/* ---------------- the tables cosmetics.tsx merges ---------------- */

/** the frames, each drawn over the avatar like FRAME_ART's */
export const FX_FRAMES: Record<string, Art> = {
  'frame:frost': frost,
  'frame:glitch': glitch,
  'frame:plasma': plasma,
  'frame:orbit': orbitFront,
  'frame:runes': runes,
  'frame:kaiju': kaiju,
  'frame:inferno': inferno,
  'frame:storm': storm,
  'frame:liquidgold': liquidgold,
  'frame:serpent': serpent,
  'frame:blackhole': blackhole,
  'frame:prism': prism,
}

/** the parts some frames draw under the avatar (same grid; only drawn from 36 px up) */
export const FX_BACK: Record<string, Art> = {
  'frame:orbit': orbitBack,
  'frame:runes': runesBack,
  'frame:blackhole': blackholeBack,
}

/** plain elements under the avatar, filling the box: the spinning rainbows */
export const FX_UNDER: Record<string, (px: number) => ReactNode> = {
  'frame:prism': (px) => (
    <span
      aria-hidden
      className={`absolute inset-0 rounded-full ${px >= 36 ? 'bjx-hspin' : ''}`}
      style={{ background: 'conic-gradient(from 0deg,#ff3b6b,#ff9f3b,#ffe53b,#5cff8a,#3bd8ff,#6b6bff,#d63bff,#ff3b6b)', WebkitMaskImage: RING_MASK(77.4, 98.8), maskImage: RING_MASK(77.4, 98.8) }}
    />
  ),
  'frame:blackhole': (px) => (
    <span
      aria-hidden
      className={`absolute inset-0 rounded-full ${px >= 36 ? 'bjx-hspin' : ''}`}
      style={{ background: 'conic-gradient(from 90deg,#ff4fd8,#ffd34f,#5cff8a,#3bd8ff,#8a6bff,#ff4fd8)', WebkitMaskImage: RING_MASK(95.4, 99.6), maskImage: RING_MASK(95.4, 99.6), opacity: 0.9 }}
    />
  ),
}
