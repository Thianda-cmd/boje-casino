/*
  Crates (src/store/cosmetics.ts CRATES): the shop's section of three crates, their odds, and opening one.

  - CrateArt draws a crate in three-quarter view on a 200-unit grid: the Neon Crate a gunmetal box with neon tubes,
    the Cosmic Crate a violet one with a starfield panel and gold trim, the Mythic Crate an obsidian reliquary with a
    prism set in its front and another floating over the lid. The lid can be drawn on its own (`part`), so the opening
    can throw it off, and the light leaking from the seam under the lid takes any colour and strength (`seam`,
    `charge`).
  - CratesSection is the shop's row of crate cards: price, how many looks are left to find, the best one still in
    it, "See the odds" (every item the crate can still drop for this player, with its chance, by rarity) and Open.
  - CrateModal is the opening. The confirm step shows the price and the balance after; Open calls the wallet's
    openCrate at once (the drop is decided and owned the moment it is paid for) and then plays it out: the crate
    shakes harder and harder while the light in its seam climbs through the rarities, one step at a time, and stops
    at the colour of what is inside; the lid blows off in a flash and a ring of that colour, and the item rises out
    on a burst of rays, with its name, rarity and the chance it had. A Mythic gets the long version: the room
    darkens, the seam runs through every colour, the burst is a prismatic one with rainbow rings and a shower of
    sparkles. A press on the stage skips to the end. The button is held from the press until the reveal, so a
    double click opens one crate, not two.

  Motion is CSS keyframes (the bjk- sheet below) and Framer Motion; with reduced motion the crates stand still and
  the opening goes straight to the reveal.
*/
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal } from '../../components/Modal'
import { Coin, IconCheck } from '../../components/icons'
import { CosmeticPreview, RARITY } from '../../art/cosmetics'
import { useUid } from '../../art/ids'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { noise, reverseCymbal, sweep, tone } from '../../lib/sound'
import { useWallet } from '../../store/wallet'
import { CRATES, cosmetic, crateDrops, crateOf, type Crate, type Rarity } from '../../store/cosmetics'
import { EASE, IconSparkle, KIND_NAME, RARITY_ORDER, RarityTag, equip, useIdentity, useMedia, useWardrobe } from './kit'

const CSS = `
@keyframes bjk-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.bjk-float{animation:bjk-float 3.6s ease-in-out infinite}
@keyframes bjk-buzz{0%,82%,100%{opacity:1}84%{opacity:.35}86%{opacity:.95}89%{opacity:.5}91%{opacity:1}}
.bjk-buzz{animation:bjk-buzz 3.8s linear infinite}
@keyframes bjk-tw{0%,100%{opacity:.15;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}
.bjk-tw{transform-box:fill-box;transform-origin:center;animation:bjk-tw 2.4s ease-in-out infinite}
@keyframes bjk-pulse{0%,100%{opacity:.5}50%{opacity:1}}
.bjk-pulse{animation:bjk-pulse 2.6s ease-in-out infinite}
@keyframes bjk-bob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}
.bjk-bob{transform-box:fill-box;transform-origin:center;animation:bjk-bob 3s ease-in-out infinite}
@keyframes bjk-spin{to{transform:rotate(360deg)}}
.bjk-spin{animation:bjk-spin 14s linear infinite}
@keyframes bjk-shake{0%,100%{transform:translate(0,0) rotate(0)}20%{transform:translate(calc(var(--amp) * -1px),calc(var(--amp) * .4px)) rotate(calc(var(--amp) * -.7deg))}40%{transform:translate(calc(var(--amp) * 1px),calc(var(--amp) * -.3px)) rotate(calc(var(--amp) * .6deg))}60%{transform:translate(calc(var(--amp) * -.8px),calc(var(--amp) * -.5px)) rotate(calc(var(--amp) * .4deg))}80%{transform:translate(calc(var(--amp) * .7px),calc(var(--amp) * .3px)) rotate(calc(var(--amp) * -.5deg))}}
.bjk-shake{animation:bjk-shake .18s linear infinite}
@keyframes bjk-hue{to{filter:hue-rotate(360deg)}}
.bjk-hue{animation:bjk-hue 3s linear infinite}
@keyframes bjk-pan{to{background-position:-200% 0}}
.bjk-pan{background-size:200% 100%!important;animation:bjk-pan 2.4s linear infinite}
@media (prefers-reduced-motion:reduce){[class*="bjk-"]{animation:none!important}}
`
if (typeof document !== 'undefined') {
  const el = document.getElementById('bjk-css') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'bjk-css' }))
  el.textContent = CSS
}

const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const PRISM = ['#ff4fd8', '#ffd34f', '#5dff9a', '#3fd8ff', '#9b7bff']
const PRISM_BG = 'linear-gradient(90deg,#ff4fd8,#ffd34f,#5dff9a,#3fd8ff,#9b7bff,#ff4fd8)'
/** the seam's colour for a rarity (a Mythic's is set going through the rainbow) */
const seamOf = (r: Rarity) => (r === 'common' ? '#e3eaf1' : RARITY[r].color)

/* ---------------- the art ---------------- */

interface Look {
  front: [string, string]
  side: string
  lidTop: string
  lidFront: string
  lidSide: string
  trim: string
  seam: string
}
const LOOKS: Record<string, Look> = {
  'crate:neon': { front: ['#283550', '#151d2c'], side: '#111827', lidTop: '#31405a', lidFront: '#212b3f', lidSide: '#161e2d', trim: '#36e6ff', seam: '#36e6ff' },
  'crate:cosmic': { front: ['#43237e', '#1d0d3c'], side: '#170a30', lidTop: '#55309a', lidFront: '#331866', lidSide: '#220f48', trim: '#f7c548', seam: '#c48bff' },
  'crate:mythic': { front: ['#1d1726', '#08060d'], side: '#07050b', lidTop: '#2a2236', lidFront: '#16111e', lidSide: '#0c0912', trim: '#ffd76a', seam: '#ff8ae9' },
}

const BODY_FRONT = 'M40 102H150V170Q150 174 146 174H44Q40 174 40 170Z'
const BODY_SIDE = 'M150 102L178 84V150Q178 153 175 155L150 174Z'
const LID_FRONT = 'M34 82H156V104H34Z'
const LID_TOP = 'M34 82L64 60H186L156 82Z'
const LID_SIDE = 'M156 82L186 60V82L156 104Z'

/** the light escaping under the lid: the seam itself, its glow, and rays when it is strong */
function Seam({ color, charge, u }: { color: string; charge: number; u: string }) {
  return (
    <g style={{ mixBlendMode: 'screen' }}>
      {charge > 0.35 && (
        <g opacity={Math.min(1, (charge - 0.35) * 1.6)}>
          {[52, 74, 98, 122, 142].map((x, i) => (
            <path key={x} d={`M${x - 3} 103L${x - 14 - i * 2} ${40 - i * 6}H${x + 10 + i * 2}L${x + 3} 103Z`} fill={`url(#${u}ray)`} opacity={0.5 + (i % 2) * 0.3} />
          ))}
          <path d="M156 101 168 93 196 40 186 44Z" fill={`url(#${u}ray)`} opacity=".5" />
        </g>
      )}
      <path d="M40 103H150L178 85" fill="none" stroke={color} strokeOpacity={0.25 + charge * 0.5} strokeWidth={6 + charge * 10} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 103H150L178 85" fill="none" stroke="#fff" strokeOpacity={0.4 + charge * 0.6} strokeWidth={1.4 + charge * 1.6} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  )
}

function Body({ id, u, still }: { id: string; u: string; still: boolean }) {
  const L = LOOKS[id]
  const live = !still
  return (
    <g>
      <path d={BODY_FRONT} fill={`url(#${u}front)`} />
      <path d={BODY_SIDE} fill={L.side} />
      <path d="M150 102V174" stroke="#000" strokeOpacity=".35" strokeWidth="1.2" />
      {id === 'crate:neon' && (
        <>
          <rect x="52" y="113" width="86" height="51" rx="7" fill="#0b111b" stroke="#36e6ff" strokeOpacity=".28" strokeWidth="1.4" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${158 + i * 5} ${110 - i * 3.4}V${160 - i * 3.4}`} stroke="#000" strokeOpacity=".35" strokeWidth="2" />
          ))}
          <g className={live ? 'bjk-buzz' : undefined}>
            <path d="M42 106V170M148 106V170" stroke="#36e6ff" strokeOpacity=".35" strokeWidth="6" strokeLinecap="round" />
            <path d="M42 106V170M148 106V170" stroke="#c8fbff" strokeWidth="1.8" strokeLinecap="round" />
          </g>
          <circle cx="95" cy="138" r="18" fill="#090d16" stroke="#ff4fd8" strokeOpacity=".4" strokeWidth="5" />
          <circle cx="95" cy="138" r="18" fill="none" stroke="#ff9cec" strokeWidth="1.6" />
          <g className={live ? 'bjk-pulse' : undefined}>
            <path d="M98 124 86 141H95L91 153 104 135H95Z" fill="#36e6ff" opacity=".35" transform="translate(95 138) scale(1.35) translate(-95 -138)" />
            <path d="M98 124 86 141H95L91 153 104 135H95Z" fill="#dffcff" stroke="#36e6ff" strokeWidth="1" strokeLinejoin="round" />
          </g>
          {[
            [47, 166],
            [143, 166],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="2.2" fill="#3a4a63" stroke="#0b111b" strokeWidth=".8" />
          ))}
        </>
      )}
      {id === 'crate:cosmic' && (
        <>
          <rect x="52" y="113" width="86" height="51" rx="7" fill={`url(#${u}space)`} stroke="#f7c548" strokeOpacity=".6" strokeWidth="1.6" />
          {[
            [62, 122, 1, 0],
            [128, 120, 1.3, 0.8],
            [70, 154, 0.9, 1.6],
            [122, 156, 1.1, 0.4],
            [108, 118, 0.7, 2],
            [58, 140, 0.8, 1.2],
            [134, 140, 0.8, 2.2],
          ].map(([x, y, r, d], i) => (
            <circle key={i} className={live ? 'bjk-tw' : undefined} style={{ animationDelay: `${-d}s` }} cx={x} cy={y} r={r * 1.3} fill="#fff" />
          ))}
          <ellipse cx="95" cy="139" rx="26" ry="7" fill="none" stroke="#ffe08a" strokeOpacity=".45" strokeWidth="3" transform="rotate(-16 95 139)" />
          <circle cx="95" cy="139" r="12" fill={`url(#${u}planet)`} />
          <path d="M70 146.2A26 7 -16 0 0 120 131.8" fill="none" stroke="#ffe08a" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M44 104 52 104 44 112ZM146 104 138 104 146 112ZM44 172 44 164 52 172ZM146 172 146 164 138 172Z" fill="#f7c548" />
          <path d="M40 102V174M150 102V174H40" fill="none" stroke="#f7c548" strokeWidth="2.2" />
          <path d="M150 174 178 155V84" fill="none" stroke="#b98a24" strokeWidth="2" />
        </>
      )}
      {id === 'crate:mythic' && (
        <>
          <path d="M95 112 116 136 95 166 74 136Z" fill={`url(#${u}prism)`} />
          <path d="M95 112 116 136H74Z" fill="#fff" opacity=".35" />
          <path d="M95 112 95 166M74 136 95 146 116 136" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1" />
          <path d="M95 112 116 136 95 166 74 136Z" fill="none" stroke={`url(#${u}gold)`} strokeWidth="2.6" strokeLinejoin="round" />
          {[
            [44, 106, 1],
            [146, 106, -1],
          ].map(([x, y, f]) => (
            <path key={x} d={`M${x} ${y}q${12 * f} 2 ${14 * f} 14q${-1 * f} -7 ${-8 * f} -8q${4 * f} 6 ${2 * f} 12q${-4 * f} -10 ${-8 * f} -18Z`} fill={`url(#${u}gold)`} />
          ))}
          {[
            [44, 170, 1],
            [146, 170, -1],
          ].map(([x, y, f]) => (
            <path key={x} d={`M${x} ${y}q${12 * f} -2 ${14 * f} -14q${-1 * f} 7 ${-8 * f} 8q${4 * f} -6 ${2 * f} -12q${-4 * f} 10 ${-8 * f} 18Z`} fill={`url(#${u}gold)`} />
          ))}
          <path d="M40 102V174H150V102" fill="none" stroke={`url(#${u}gold)`} strokeWidth="2.6" />
          <path d="M150 174 178 155V84" fill="none" stroke="#a87412" strokeWidth="2.2" />
          <path d="M60 170H130" stroke={`url(#${u}gold)`} strokeWidth="1.2" strokeDasharray="2 3" />
        </>
      )}
    </g>
  )
}

function Lid({ id, u, still }: { id: string; u: string; still: boolean }) {
  const L = LOOKS[id]
  const live = !still
  return (
    <g>
      <path d={LID_TOP} fill={L.lidTop} />
      <path d={LID_FRONT} fill={L.lidFront} />
      <path d={LID_SIDE} fill={L.lidSide} />
      <path d="M34 82H156L186 60" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="1.2" />
      {id === 'crate:neon' && (
        <>
          <g className={live ? 'bjk-buzz' : undefined} style={{ animationDelay: '-1.4s' }}>
            <path d="M36 83H155L185 61" fill="none" stroke="#ff4fd8" strokeOpacity=".35" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M36 83H155L185 61" fill="none" stroke="#ffd1f4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <text x="95" y="97.5" textAnchor="middle" fontSize="10" fontWeight="900" letterSpacing="4" fill="#ff9cec" fontFamily="Manrope, sans-serif">
            NEON
          </text>
          <path d="M80 72H130" stroke="#000" strokeOpacity=".25" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {id === 'crate:cosmic' && (
        <>
          <path d="M34 82H156L186 60M34 104H156L186 82" fill="none" stroke="#f7c548" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M110 64 113 70 120 71 115 75 116 82 110 78 104 82 105 75 100 71 107 70Z" fill="#ffe08a" stroke="#a86c0c" strokeWidth=".8" transform="translate(0 -1) scale(1 .62) translate(0 40)" />
          <text x="95" y="97.5" textAnchor="middle" fontSize="9.5" fontWeight="900" letterSpacing="3.6" fill="#ffe08a" fontFamily="Manrope, sans-serif">
            COSMIC
          </text>
        </>
      )}
      {id === 'crate:mythic' && (
        <>
          <path d="M34 82H156L186 60M34 104H156L186 82" fill="none" stroke={`url(#${u}gold)`} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M60 82 66 70 72 82M89 82 95 64 101 82M118 82 124 70 130 82" fill={`url(#${u}gold)`} />
          <text x="95" y="97.5" textAnchor="middle" fontSize="9.5" fontWeight="900" letterSpacing="3.4" fill={`url(#${u}gold)`} fontFamily="Manrope, sans-serif">
            MYTHIC
          </text>
          {/* the prism floating over the lid, shedding sparkles */}
          <g className={live ? 'bjk-bob' : undefined}>
            <ellipse cx="110" cy="40" rx="22" ry="22" fill={`url(#${u}halo)`} className={live ? 'bjk-pulse' : undefined} />
            <path d="M110 18 124 38 110 58 96 38Z" fill={`url(#${u}prism)`} />
            <path d="M110 18 124 38H96Z" fill="#fff" opacity=".4" />
            <path d="M110 18V58M96 38 110 44 124 38" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth=".9" />
          </g>
          {[
            [84, 24, 3.4, 0],
            [138, 30, 2.8, 0.8],
            [128, 8, 2.2, 1.5],
            [90, 52, 2, 2.1],
          ].map(([x, y, s, d], i) => (
            <path key={i} className={live ? 'bjk-tw' : undefined} style={{ animationDelay: `${-d}s` }} d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`} fill={PRISM[i % PRISM.length]} />
          ))}
        </>
      )}
    </g>
  )
}

/**
 * A crate, `size` px square. `seam` and `charge` (0 to 1) set the light leaking under the lid; `part` draws only the
 * body (with its seam) or only the lid, for the opening to move the lid on its own; `still` holds every animation.
 */
export function CrateArt({ id, size = 160, still = false, seam, charge = 0.3, part = 'all', className = '', style }: { id: string; size?: number; still?: boolean; seam?: string; charge?: number; part?: 'all' | 'body' | 'lid'; className?: string; style?: CSSProperties }) {
  const u = useUid()
  const L = LOOKS[id] ?? LOOKS['crate:neon']
  const key = LOOKS[id] ? id : 'crate:neon'
  const prismatic = key === 'crate:mythic' && !still && !calm()
  const rainbow = '#ff4fd8;#ffd34f;#5dff9a;#3fd8ff;#9b7bff;#ff4fd8'
  const color = seam ?? L.seam
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={`overflow-visible ${className}`} style={style} aria-hidden data-crate={key}>
      <defs>
        <linearGradient id={`${u}front`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor={L.front[0]} />
          <stop offset="1" stopColor={L.front[1]} />
        </linearGradient>
        <linearGradient id={`${u}ray`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={color} stopOpacity=".9" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${u}space`} cx=".35" cy=".3" r=".9">
          <stop offset="0" stopColor="#3b2380" />
          <stop offset=".6" stopColor="#140a32" />
          <stop offset="1" stopColor="#07041a" />
        </radialGradient>
        <radialGradient id={`${u}planet`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#ffd2f0" />
          <stop offset=".5" stopColor="#d06bff" />
          <stop offset="1" stopColor="#4a1a8a" />
        </radialGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#a86c0c" />
        </linearGradient>
        <linearGradient id={`${u}prism`} x1="0" y1="0" x2="1" y2="1">
          {PRISM.map((c, i) => (
            <stop key={i} offset={i / (PRISM.length - 1)} stopColor={c}>
              {prismatic && <animate attributeName="stop-color" values={rainbow.split(';').slice(i).concat(rainbow.split(';').slice(1, i + 1)).join(';')} dur="5s" repeatCount="indefinite" />}
            </stop>
          ))}
        </linearGradient>
        <radialGradient id={`${u}halo`}>
          <stop offset="0" stopColor="#fff" stopOpacity=".7" />
          <stop offset=".5" stopColor="#ff8ae9" stopOpacity=".25" />
          <stop offset="1" stopColor="#ff8ae9" stopOpacity="0" />
        </radialGradient>
      </defs>
      {part !== 'lid' && (
        <>
          <ellipse cx="110" cy="182" rx="74" ry="9" fill="#000" opacity=".45" />
          <Body id={key} u={u} still={still} />
          <Seam color={color} charge={charge} u={u} />
        </>
      )}
      {part !== 'body' && <Lid id={key} u={u} still={still} />}
    </svg>
  )
}

/* ---------------- sounds ---------------- */

const crateSfx = {
  /** a step of the seam's light: a rising note, higher for each rarity */
  step: (k: number) => {
    tone(330 * Math.pow(1.26, k), 0.16, 'triangle', 0.05)
    tone(660 * Math.pow(1.26, k), 0.12, 'sine', 0.03, 0.03)
  },
  rumble: () => noise(0.5, 0.08, 220),
  burst: (r: Rarity) => {
    noise(0.4, 0.2, 1800)
    sweep(0.5, 0.12, 400, 4000, 'bandpass', 1)
    tone(110, 0.4, 'sawtooth', 0.05, 0, 55)
    const chord = r === 'mythic' ? [523, 659, 784, 1046, 1318, 1568] : r === 'legendary' ? [523, 659, 784, 1046, 1318] : r === 'epic' ? [440, 554, 659, 880] : [392, 494, 587]
    chord.forEach((f, i) => tone(f, 0.5 + i * 0.05, 'triangle', 0.06, 0.12 + i * 0.07))
    if (r === 'mythic') chord.forEach((f, i) => tone(f * 2, 1.2, 'sine', 0.025, 0.6 + i * 0.05))
  },
  swell: () => reverseCymbal(1.1, 0.12),
}

/* ---------------- the shop's section ---------------- */

/** the crates whose pools hold a cosmetic */
export const cratesWith = (itemId: string) => CRATES.filter((c) => c.pool.includes(itemId))

export function CratesSection() {
  const w = useWardrobe()
  const [odds, setOdds] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section id="crates" className="scroll-mt-20" data-crates>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-0.5">
        <h2 className="flex items-center gap-2 text-[20px] font-black tracking-tight">
          <IconCrate size={20} /> Crates
        </h2>
        <p className="text-[12.5px] text-muted">Each crate drops one look you don't have yet. Every chance is shown before you open one.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {CRATES.map((c, i) => (
          <CrateCard key={c.id} c={c} i={i} left={crateDrops(c, w)} onOdds={() => setOdds(c.id)} onOpen={() => setOpen(c.id)} />
        ))}
      </div>
      <AnimatePresence>{odds && <OddsModal key={odds} id={odds} onClose={() => setOdds(null)} onOpen={() => (setOdds(null), setOpen(odds))} />}</AnimatePresence>
      <AnimatePresence>{open && <CrateModal key={open} id={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </section>
  )
}

function CrateCard({ c, i, left, onOdds, onOpen }: { c: Crate; i: number; left: { id: string; chance: number }[]; onOdds: () => void; onOpen: () => void }) {
  const balance = useWallet((s) => s.balance)
  const R = RARITY[c.rarity]
  const mythic = c.rarity === 'mythic'
  const exclusive = c.pool.filter((id) => cosmetic(id)?.unlock?.crate === c.id).length
  const best = [...left].sort((a, b) => RARITY_ORDER.indexOf(cosmetic(b.id)!.rarity) - RARITY_ORDER.indexOf(cosmetic(a.id)!.rarity) || a.chance - b.chance)[0]
  const rarest = best ? cosmetic(best.id)! : null
  const afford = balance >= c.price
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: i * 0.06, ease: EASE }} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-panel shadow-[0_18px_40px_-28px_rgba(0,0,0,.9)] ring-1 ring-white/[.05]" data-crate-card={c.id}>
      <button onClick={left.length ? onOpen : onOdds} className="relative flex h-[188px] items-center justify-center overflow-hidden" style={{ background: `radial-gradient(circle at 50% 58%, ${R.color}4d, transparent 64%), linear-gradient(180deg, #14293b, #0b1823)` }} aria-label={`Open the ${c.name}`}>
        <span className={`absolute inset-x-0 top-0 h-[3px] ${mythic ? 'bjk-pan' : ''}`} style={{ background: mythic ? PRISM_BG : `linear-gradient(90deg, transparent, ${R.color}, transparent)` }} />
        <Rays color={R.color} prismatic={mythic} className="absolute left-1/2 top-[56%] h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 opacity-40 transition-opacity duration-300 group-hover:opacity-70" />
        <div className="bjk-float relative transition-transform duration-300 group-hover:scale-[1.06]" style={{ animationDelay: `${-i * 1.1}s` }}>
          <CrateArt id={c.id} size={150} />
        </div>
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10.5px] font-extrabold text-ink backdrop-blur">
          {left.length ? `${left.length} looks to find` : 'All found'}
        </span>
        {exclusive > 0 && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-extrabold" style={{ background: `${R.color}2e`, color: R.light }}>
            <IconSparkle size={11} /> {exclusive} only here
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          <span className="truncate text-[17px] font-black tracking-tight">{c.name}</span>
          <RarityTag rarity={c.rarity} />
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{c.line}</p>
        {rarest && best && (
          <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-stage/70 px-2.5 py-2 ring-1 ring-white/[.03]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: `radial-gradient(circle, ${RARITY[rarest.rarity].color}40, #0c1925 75%)` }}>
              <CosmeticPreview id={rarest.id} size={34} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-extrabold">{rarest.name}</span>
              <span className="block truncate text-[11px] font-bold text-dim">
                Rarest left · {KIND_NAME[rarest.kind]}
              </span>
            </span>
            <span className="tnum shrink-0 text-[12px] font-extrabold" style={{ color: RARITY[rarest.rarity].color }}>
              {pct(best.chance)}
            </span>
          </div>
        )}
        <div className="mt-auto grid grid-cols-[1fr_1.35fr] gap-2 pt-3.5">
          <button onClick={onOdds} className="h-11 rounded-xl bg-raised text-[13px] font-bold transition hover:bg-hover" data-crate-odds={c.id}>
            See the odds
          </button>
          {left.length ? (
            <button
              onClick={onOpen}
              className={`tnum flex h-11 items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-extrabold transition ${afford ? 'bg-[linear-gradient(180deg,#ffd75e,#f2b134)] text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] hover:brightness-105' : 'bg-stage text-dim'}`}
              data-crate-open={c.id}
            >
              <Coin size={15} /> {fmt(c.price, 0)}
            </button>
          ) : (
            <span className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-stage text-[12.5px] font-bold text-muted">
              <IconCheck size={14} /> Complete
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

const pct = (p: number) => `${p >= 0.1 ? (p * 100).toFixed(1) : (p * 100).toFixed(2)}%`

/** light rays turning slowly behind a crate or a revealed item */
function Rays({ color, prismatic = false, className = '', spin = true }: { color: string; prismatic?: boolean; className?: string; spin?: boolean }) {
  const u = useUid()
  return (
    <svg viewBox="-100 -100 200 200" className={`pointer-events-none ${className}`} aria-hidden>
      <defs>
        <radialGradient id={`${u}r`}>
          <stop offset=".1" stopColor={prismatic ? '#fff' : color} stopOpacity=".9" />
          <stop offset="1" stopColor={prismatic ? '#fff' : color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className={`${spin ? 'bjk-spin' : ''} ${prismatic ? 'bjk-hue' : ''}`}>
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d="M0 0L-7 -100H7Z" fill={prismatic ? PRISM[i % PRISM.length] : `url(#${u}r)`} opacity={prismatic ? 0.55 : i % 2 ? 0.55 : 0.9} transform={`rotate(${i * 22.5})`} />
        ))}
      </g>
      {prismatic && <circle r="100" fill={`url(#${u}r)`} opacity=".25" />}
    </svg>
  )
}

const IconCrate = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3.5 8.5 12 4l8.5 4.5v8L12 21l-8.5-4.5z" />
    <path d="M3.5 8.5 12 13l8.5-4.5M12 13v8" />
    <path d="M7.8 6.2l8.5 4.6" />
  </svg>
)

/* ---------------- the odds ---------------- */

function OddsModal({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: () => void }) {
  const c = crateOf(id)!
  const w = useWardrobe()
  const left = crateDrops(c, w)
  const owned = c.pool.length - left.length
  const groups = RARITY_ORDER.slice()
    .reverse()
    .map((r) => ({ r, items: left.filter((x) => cosmetic(x.id)!.rarity === r).sort((a, b) => cosmetic(a.id)!.name.localeCompare(cosmetic(b.id)!.name)) }))
    .filter((g) => g.items.length)
  return (
    <Modal onClose={onClose} title={`${c.name}: the odds`} width={480}>
      <div data-odds={id}>
        <p className="text-[12.5px] leading-relaxed text-muted">
          One look per opening, never one you can already wear. Each is weighted by its rarity, so the chances below are for your next opening and change as your collection grows.
          {owned > 0 && ` You already have ${owned} of the ${c.pool.length} in this crate.`}
        </p>
        {groups.length ? (
          <div className="mt-3 flex flex-col gap-3">
            {groups.map((g) => (
              <div key={g.r}>
                <div className="mb-1.5 flex items-center justify-between px-0.5">
                  <RarityTag rarity={g.r} />
                  <span className="tnum text-[12px] font-extrabold" style={{ color: RARITY[g.r].color }}>
                    {pct(g.items.reduce((a, x) => a + x.chance, 0))} together
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl bg-stage/70 ring-1 ring-white/[.03]">
                  {g.items.map((x, i) => {
                    const it = cosmetic(x.id)!
                    return (
                      <div key={x.id} className={`flex items-center gap-3 px-3 py-2 ${i ? 'border-t border-line/70' : ''}`} data-odds-item={x.id}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-panel">
                          <CosmeticPreview id={x.id} size={34} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{it.name}</span>
                          <span className="block truncate text-[11px] font-semibold text-dim">
                            {KIND_NAME[it.kind]}
                            {it.unlock?.crate === c.id ? ' · only in this crate' : it.price !== undefined ? ` · ${fmt(it.price, 0)} in the shop` : ''}
                          </span>
                        </span>
                        <span className="tnum shrink-0 text-[13px] font-extrabold">{pct(x.chance)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-stage/70 p-5 text-center text-[13px] text-muted">You have everything this crate can drop.</div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="h-11 rounded-xl bg-raised text-[13.5px] font-bold transition hover:bg-hover">
            Close
          </button>
          <button disabled={!left.length} onClick={onOpen} className="tnum flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[linear-gradient(180deg,#ffd75e,#f2b134)] text-[13.5px] font-extrabold text-[#2a1c00] transition hover:brightness-105 disabled:opacity-40">
            <Coin size={15} /> Open for {fmt(c.price, 0)}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- the opening ---------------- */

type Stage = 'ready' | 'shake' | 'burst' | 'reveal'

/** bits flung out of the crate when it bursts */
const SHARDS = Array.from({ length: 26 }, (_, i) => {
  const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.17
  const d = 120 + ((i * 47) % 90)
  return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.75 - 30, r: ((i * 71) % 360) - 180, s: 5 + (i % 4) * 2.5, delay: (i % 5) * 0.015 }
})

export function CrateModal({ id, onClose }: { id: string; onClose: () => void }) {
  const c = crateOf(id)!
  const R = RARITY[c.rarity]
  const balance = useWallet((s) => s.balance)
  const openCrate = useWallet((s) => s.openCrate)
  const pushToast = useWallet((s) => s.pushToast)
  const me = useIdentity()
  const w = useWardrobe()
  const wide = useMedia('(min-width: 640px)')
  const left = crateDrops(c, w)
  const [stage, setStage] = useState<Stage>('ready')
  const [drop, setDrop] = useState<{ id: string; chance: number } | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [worn, setWorn] = useState(false)
  // the balance as it was when Open was pressed, so the price lines don't move while the crate plays out
  const [paidFrom, setPaidFrom] = useState<number | null>(null)
  // the press is held from the click to the reveal: a second click in between does nothing
  const held = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms))
  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => clear, [])

  // the rarities the seam climbs through: from the crate's lowest to the drop's
  const ladder = useMemo(() => {
    const ranks = c.pool.map((x) => RARITY_ORDER.indexOf(cosmetic(x)!.rarity))
    const lo = Math.min(...ranks)
    const to = drop ? RARITY_ORDER.indexOf(cosmetic(drop.id)!.rarity) : lo
    return RARITY_ORDER.slice(lo, to + 1)
  }, [c, drop])
  const item = drop ? cosmetic(drop.id)! : null
  const rarity: Rarity = item?.rarity ?? c.rarity
  const mythic = rarity === 'mythic'
  const seam = stage === 'ready' ? undefined : stage === 'shake' ? seamOf(ladder[Math.min(step, ladder.length - 1)]) : seamOf(rarity)
  const from = stage === 'ready' || paidFrom === null ? balance : paidFrom
  const short = stage === 'ready' ? Math.max(0, c.price - balance) : 0

  const reveal = () => {
    clear()
    setStage('reveal')
    held.current = false
  }
  const burst = (r: Rarity) => {
    clear()
    setStage('burst')
    crateSfx.burst(r)
    later(reveal, 650)
  }
  const start = () => {
    if (held.current) return
    held.current = true
    const r = openCrate(id)
    if (!r.ok) {
      held.current = false
      pushToast({ kind: 'info', title: r.why === 'coins' ? 'Not enough coins for that crate.' : r.why === 'complete' ? 'You already have everything in this crate.' : r.why === 'cooloff' ? "You're on a cool-off: crates stay shut until it ends." : "That crate isn't available." })
      return
    }
    const got = cosmetic(r.id)!
    setPaidFrom(balance)
    setDrop({ id: r.id, chance: r.chance })
    setWorn(false)
    setStep(0)
    if (calm()) {
      setStage('reveal')
      held.current = false
      return
    }
    setStage('shake')
    crateSfx.rumble()
    const ranks = c.pool.map((x) => RARITY_ORDER.indexOf(cosmetic(x)!.rarity))
    const steps = RARITY_ORDER.indexOf(got.rarity) - Math.min(...ranks)
    const pace = got.rarity === 'mythic' ? 520 : 430
    crateSfx.step(0)
    for (let k = 1; k <= steps; k++)
      later(() => {
        setStep(k)
        crateSfx.step(k)
        if (k === steps && got.rarity === 'mythic') crateSfx.swell()
      }, 700 + (k - 1) * pace)
    later(() => burst(got.rarity), 700 + steps * pace + (got.rarity === 'mythic' ? 1100 : 380))
  }
  const skip = () => {
    if (stage === 'shake' && item) burst(item.rarity)
  }
  const wear = async () => {
    if (!item) return
    setBusy(true)
    const err = await equip(item)
    setBusy(false)
    if (err) pushToast({ kind: 'info', title: err })
    else {
      setWorn(true)
      pushToast({ kind: 'reward', title: `Now wearing ${item.name}` })
    }
  }
  const close = () => {
    // closing while it plays: the item is already theirs, say so
    if (item && stage !== 'reveal') pushToast({ kind: 'reward', title: `${c.name}: you found ${item.name}` })
    onClose()
  }
  const again = () => {
    setStage('ready')
    setDrop(null)
    setPaidFrom(null)
    setTimeout(start, 30)
  }
  const amp = stage === 'shake' ? 1.2 + step * 1.3 + (mythic && step === ladder.length - 1 ? 2.5 : 0) : 0
  const charge = stage === 'ready' ? 0.3 : stage === 'shake' ? 0.45 + (step / Math.max(1, ladder.length - 1)) * 0.5 : 1
  const glowColor = seam ?? R.color
  const stageH = wide ? 300 : 260

  return (
    <Modal onClose={close} title={stage === 'reveal' && item ? (mythic ? 'MYTHIC!' : 'You found…') : c.name} width={460}>
      <div data-crate-modal={id} data-stage={stage} data-drop={drop?.id ?? ''}>
        {/* the stage */}
        <div onClick={skip} className="relative -mx-5 overflow-hidden" style={{ height: stageH, background: 'radial-gradient(120% 90% at 50% 60%, #14293b, #070f16 70%)' }}>
          <motion.div aria-hidden className="absolute inset-0" animate={{ opacity: stage === 'shake' && mythic && step === ladder.length - 1 ? 0.65 : 0 }} style={{ background: '#000' }} />
          <motion.div aria-hidden className="pointer-events-none absolute inset-0" animate={{ background: `radial-gradient(60% 55% at 50% 58%, ${glowColor}${stage === 'reveal' ? '55' : stage === 'shake' ? '40' : '26'}, transparent 70%)` }} transition={{ duration: 0.35 }} />
          <AnimatePresence>
            {stage !== 'reveal' && (
              <motion.div key="crate" className="absolute inset-0 flex items-center justify-center" exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.3 }}>
                <Rays color={glowColor} prismatic={stage !== 'ready' && mythic && step === ladder.length - 1} className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2" />
                <div className={stage === 'shake' ? 'bjk-shake' : 'bjk-float'} style={{ ['--amp' as string]: amp } as CSSProperties}>
                  <div className="relative" style={{ width: 210, height: 210 }}>
                    <CrateArt id={id} size={210} part="body" seam={stage === 'shake' && mythic && step === ladder.length - 1 ? '#ffffff' : seam} charge={charge} className="absolute inset-0" />
                    <motion.div className="absolute inset-0" animate={stage === 'burst' ? { y: -260, x: 70, rotate: 38, opacity: 0 } : { y: stage === 'shake' ? [0, -3 - step, 0] : 0, x: 0, rotate: 0, opacity: 1 }} transition={stage === 'burst' ? { duration: 0.6, ease: [0.2, 0.7, 0.4, 1] } : { duration: 0.24, repeat: stage === 'shake' ? Infinity : 0 }}>
                      <CrateArt id={id} size={210} part="lid" seam={seam} className="absolute inset-0" />
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* the burst: a flash, rings, shards */}
          <AnimatePresence>
            {(stage === 'burst' || stage === 'reveal') && item && (
              <motion.div key="burst" className="pointer-events-none absolute inset-0" initial={{ opacity: 1 }} animate={{ opacity: 1 }}>
                <motion.div className="absolute inset-0" style={{ background: mythic ? 'radial-gradient(circle at 50% 55%, #fff, #ffd3f6 30%, transparent 70%)' : `radial-gradient(circle at 50% 55%, #fff, ${R.light} 25%, transparent 65%)` }} initial={{ opacity: 0.95 }} animate={{ opacity: 0 }} transition={{ duration: 0.7, ease: 'easeOut' }} />
                {(mythic ? PRISM : [RARITY[rarity].color, RARITY[rarity].light]).map((col, i) => (
                  <motion.span key={i} className="absolute left-1/2 top-[55%] rounded-full" style={{ width: 80, height: 80, marginLeft: -40, marginTop: -40, boxShadow: `0 0 0 ${mythic ? 4 : 5}px ${col}` }} initial={{ scale: 0.2, opacity: 1 }} animate={{ scale: 4.5 + i * 0.6, opacity: 0 }} transition={{ duration: 0.9 + i * 0.12, delay: i * 0.08, ease: [0.2, 0.7, 0.4, 1] }} />
                ))}
                {SHARDS.map((s, i) => (
                  <motion.span
                    key={i}
                    className="absolute left-1/2 top-[55%] rounded-[2px]"
                    style={{ width: s.s, height: s.s * (i % 2 ? 1.8 : 1), marginLeft: -s.s / 2, marginTop: -s.s / 2, background: mythic ? PRISM[i % PRISM.length] : i % 3 ? RARITY[rarity].color : RARITY[rarity].light }}
                    initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
                    animate={{ x: s.x * (mythic ? 1.4 : 1), y: [0, s.y, s.y + 70], rotate: s.r * 3, opacity: [1, 1, 0], scale: 1 }}
                    transition={{ duration: 1.3, delay: s.delay, ease: [0.15, 0.7, 0.4, 1], times: [0, 0.55, 1] }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          {/* the reveal */}
          <AnimatePresence>
            {stage === 'reveal' && item && (
              <motion.div key="item" className="absolute inset-0 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Rays color={RARITY[rarity].color} prismatic={mythic} className="absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 opacity-80" />
                {mythic && <MythicSparkles />}
                <motion.div className="relative" initial={{ y: 60, scale: 0.3, rotate: -8 }} animate={{ y: 0, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 15 }}>
                  <div className="bjk-float drop-shadow-[0_18px_30px_rgba(0,0,0,.6)]">
                    <CosmeticPreview id={item.id} size={wide ? 168 : 150} avatar={me.avatar} />
                  </div>
                </motion.div>
                {mythic && (
                  <motion.div className="absolute inset-x-0 top-4 text-center" initial={{ y: -14, opacity: 0, scale: 0.8 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ delay: 0.25, type: 'spring', stiffness: 300, damping: 16 }}>
                    <span className="bjk-pan inline-block bg-clip-text text-[30px] font-black tracking-[.18em] text-transparent [-webkit-background-clip:text]" style={{ backgroundImage: PRISM_BG, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.7))' }}>
                      MYTHIC
                    </span>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {stage === 'shake' && <div className="absolute inset-x-0 bottom-2.5 text-center text-[11px] font-bold text-white/40">Tap to skip</div>}
          {stage === 'ready' && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <span className="rounded-full bg-black/50 px-3 py-1 text-[11.5px] font-bold text-ink/80 backdrop-blur">{left.length} looks left to find in this crate</span>
            </div>
          )}
        </div>

        {/* under the stage: the confirm step, then what dropped */}
        <AnimatePresence mode="wait" initial={false}>
          {stage === 'reveal' && item && drop ? (
            <motion.div key="got" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3, ease: EASE }} className="pt-4" data-crate-result={item.id}>
              <div className="flex flex-col items-center text-center">
                <div className="text-[22px] font-black leading-tight tracking-tight">{item.name}</div>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-[12.5px] font-semibold text-muted">
                  <RarityTag rarity={item.rarity} /> {KIND_NAME[item.kind]} · {item.line}
                </div>
                <div className="tnum mt-1.5 text-[11.5px] font-bold text-dim">A {pct(drop.chance)} chance{item.unlock?.crate ? ', and only found in crates' : ''}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button disabled={busy || worn} onClick={() => void wear()} className="h-12 rounded-xl bg-accent text-[14px] font-extrabold text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-110 disabled:opacity-50" data-crate-wear>
                  {worn ? 'Wearing it' : busy ? 'Saving…' : 'Wear it now'}
                </button>
                {left.length > 0 && balance >= c.price ? (
                  <button onClick={again} className="tnum flex h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[linear-gradient(180deg,#ffd75e,#f2b134)] px-2 text-[14px] font-extrabold text-[#2a1c00] transition hover:brightness-105" data-crate-again>
                    Open again <Coin size={15} /> {fmt(c.price, 0)}
                  </button>
                ) : (
                  <button onClick={onClose} className="h-12 rounded-xl bg-raised text-[14px] font-bold transition hover:bg-hover">
                    Done
                  </button>
                )}
              </div>
              {left.length === 0 && <p className="mt-3 text-center text-[12px] text-muted">That was the last one: you have everything in the {c.name}.</p>}
            </motion.div>
          ) : (
            <motion.div key="confirm" initial={{ opacity: 0, y: 6 }} animate={{ opacity: stage === 'ready' ? 1 : 0.4, y: 0 }} exit={{ opacity: 0 }} className="pt-4">
              <div className="tnum overflow-hidden rounded-xl bg-stage text-[13px] font-bold">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-muted">Price</span>
                  <span className="flex items-center gap-1.5 text-gold">
                    {fmt(c.price, 0)} <Coin size={14} />
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5">
                  <span className="text-muted">After</span>
                  <span className={short ? 'text-danger' : ''}>{short ? `${fmt(short)} short` : fmt(from - c.price)}</span>
                </div>
              </div>
              {short > 0 && (
                <p className="mt-3 text-[12.5px] text-muted">
                  You need {fmt(short)} more coins.{' '}
                  <button onClick={() => (onClose(), navigate('/rewards'))} className="font-bold text-accent hover:underline">
                    Free coins in Rewards
                  </button>
                </p>
              )}
              <button
                disabled={stage !== 'ready' || short > 0 || !left.length}
                onClick={start}
                className={`mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-40 ${c.rarity === 'mythic' ? 'bjk-pan text-white [text-shadow:0_1px_2px_rgba(0,0,0,.5)]' : 'bg-[linear-gradient(180deg,#ffd75e,#f2b134)] text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] hover:brightness-105'}`}
                style={c.rarity === 'mythic' ? { backgroundImage: PRISM_BG } : undefined}
                data-crate-go
              >
                {stage === 'ready' ? (
                  <>
                    Open the {c.name} · <Coin size={16} /> {fmt(c.price, 0)}
                  </>
                ) : (
                  'Opening…'
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}

/** a shower of rainbow sparkles for a Mythic */
function MythicSparkles() {
  const bits = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ x: ((i * 37) % 100) - 50, y: ((i * 61) % 80) - 50, s: 8 + (i % 4) * 4, d: (i % 7) * 0.12, c: PRISM[i % PRISM.length] })), [])
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {bits.map((b, i) => (
        <motion.svg key={i} viewBox="-10 -10 20 20" width={b.s} height={b.s} className="absolute" style={{ left: `${50 + b.x}%`, top: `${50 + b.y}%` }} initial={{ scale: 0, opacity: 0, rotate: 0 }} animate={{ scale: [0, 1.2, 0], opacity: [0, 1, 0], rotate: 90 }} transition={{ duration: 1.6, delay: 0.2 + b.d, repeat: Infinity, repeatDelay: 0.6 }}>
          <path d="M0 -10Q1.5 -1.5 10 0Q1.5 1.5 0 10Q-1.5 1.5 -10 0Q-1.5 -1.5 0 -10Z" fill={b.c} />
        </motion.svg>
      ))}
    </div>
  )
}

/** the crate line for a crate-only cosmetic: which crates drop it and the chance in the first one, for this player */
export function CrateHint({ itemId, children }: { itemId: string; children?: ReactNode }) {
  const w = useWardrobe()
  const list = cratesWith(itemId)
  if (!list.length) return null
  const first = list[0]
  const p = crateDrops(first, w).find((x) => x.id === itemId)?.chance
  return (
    <div className="flex items-center gap-3">
      <CrateArt id={first.id} size={48} still />
      <div className="min-w-0 flex-1 text-[12px] font-bold">
        <div className="text-muted">Only in {list.length > 1 ? `the ${list.map((c) => c.name.replace(/ Crate$/, '')).join(' and ')} crates` : `the ${first.name}`}</div>
        {p !== undefined && <div className="tnum text-dim">{pct(p)} from a {first.name.replace(/ Crate$/, '')} crate</div>}
      </div>
      {children}
    </div>
  )
}

