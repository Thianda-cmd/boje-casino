import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { CardId } from './rules'

/*
  The stage behind the cards, one scene per card, crossfading as the card changes: a clover meadow with drifting
  leaves, a canyon at dusk under a string of lanterns, a candy beach with floating lights and a black velvet vault under
  two sweeping spotlights. Only CSS animations of transform and opacity, so the compositor does the work; nothing
  moves when the player prefers reduced motion.
*/

const CSS = `
@keyframes scr-drift { 0% { transform: translate3d(0,-10%,0) rotate(0deg); opacity: 0 } 10% { opacity: var(--o) } 90% { opacity: var(--o) } 100% { transform: translate3d(var(--dx), 112%, 0) rotate(var(--rot)); opacity: 0 } }
@keyframes scr-rise { 0% { transform: translate3d(0, 0, 0) scale(.8); opacity: 0 } 15% { opacity: var(--o) } 85% { opacity: var(--o) } 100% { transform: translate3d(var(--dx), -120%, 0) scale(1.1); opacity: 0 } }
@keyframes scr-sway { 0%, 100% { transform: rotate(-2.2deg) } 50% { transform: rotate(2.2deg) } }
@keyframes scr-flicker { 0%, 100% { opacity: 1 } 40% { opacity: .82 } 55% { opacity: .95 } 70% { opacity: .78 } }
@keyframes scr-spot { 0%, 100% { transform: rotate(var(--a0)) } 50% { transform: rotate(var(--a1)) } }
@keyframes scr-twinkle { 0%, 100% { transform: scale(.3); opacity: 0 } 50% { transform: scale(1); opacity: .9 } }
.scr-bd * { animation-play-state: running }
@media (prefers-reduced-motion: reduce) { .scr-bd * { animation: none !important } }
`

/** a pseudo-random but fixed spread, so the scenes look the same every time */
const spread = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => {
    const r = (k: number) => {
      const x = Math.sin((i + 1) * 12.9898 * (k + 1) + seed * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    return { a: r(0), b: r(1), c: r(2), d: r(3) }
  })

function Meadow() {
  return (
    <>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 28%, #1d6a44 0%, #0f3d27 52%, #072018 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 14% 6%, rgba(255,238,170,.28), rgba(255,238,170,0) 42%)' }} />
      {/* rays from the sun */}
      <div className="absolute inset-0 opacity-[.07]" style={{ background: 'repeating-conic-gradient(from 200deg at 14% 6%, #fff6c8 0deg 4deg, transparent 4deg 14deg)' }} />
      <svg className="absolute inset-x-0 bottom-0 h-[34%] w-full" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden>
        <path d="M0 52 C60 30 120 36 180 50 C240 64 300 34 400 44 V100 H0Z" fill="#0d4a2c" />
        <path d="M0 70 C70 54 140 62 210 72 C280 82 330 60 400 66 V100 H0Z" fill="#0a3a23" />
        <path d="M0 86 C80 76 160 84 240 90 C300 94 350 82 400 84 V100 H0Z" fill="#072a19" />
      </svg>
      {spread(12, 1).map((s, i) => {
        const size = 10 + s.a * 14
        return (
          // a full-height lane, so a percentage of the lane's height is a percentage of the stage's
          <div key={i} className="absolute top-0 h-full" style={{ left: `${s.b * 100}%`, width: size, ['--o' as string]: 0.25 + s.c * 0.3, ['--dx' as string]: `${(s.d - 0.5) * 120}px`, ['--rot' as string]: `${(s.c - 0.5) * 720}deg`, animation: `scr-drift ${14 + s.c * 12}s linear ${-s.d * 24}s infinite` }}>
            <svg className="absolute left-0" style={{ top: -size }} viewBox="-12 -12 24 24" width={size} height={size} aria-hidden>
              <g fill={i % 3 ? '#6fe39a' : '#bff5cf'}>
                <circle cx="-3.4" cy="-2.6" r="3.6" />
                <circle cx="3.4" cy="-2.6" r="3.6" />
                <circle cx="0" cy="3.2" r="3.6" />
              </g>
            </svg>
          </div>
        )
      })}
    </>
  )
}

function Canyon() {
  const lanterns = [0.12, 0.27, 0.42, 0.58, 0.73, 0.88]
  return (
    <>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #1e0f2a 0%, #4a1d34 34%, #93402c 60%, #c2622c 72%, #2a1208 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 70%, rgba(255,190,90,.45) 0%, rgba(255,150,60,.12) 30%, rgba(0,0,0,0) 55%)' }} />
      <svg className="absolute inset-x-0 bottom-0 h-[44%] w-full" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden>
        <circle cx="200" cy="58" r="34" fill="#ffd27a" opacity=".85" />
        <path d="M0 70 L30 70 L38 52 L84 52 L92 70 L150 72 L160 60 L190 60 L198 76 L260 76 L270 48 L318 48 L330 72 L400 74 V140 H0Z" fill="#5e2414" />
        <path d="M0 96 L54 94 L64 80 L110 80 L120 98 L220 100 L232 86 L262 86 L272 102 L400 100 V140 H0Z" fill="#3c160c" />
        <path d="M0 118 C100 112 200 120 300 116 C340 114 370 116 400 118 V140 H0Z" fill="#240c06" />
      </svg>
      {/* the string of lanterns */}
      <svg className="absolute inset-x-0 top-0 h-[22%] w-full" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden>
        <path d="M-10 6 Q100 36 200 26 Q300 16 410 8" stroke="#1a0a06" strokeWidth="1.4" fill="none" />
      </svg>
      {lanterns.map((x, i) => {
        const y = 6 + Math.sin(x * Math.PI) * 13
        return (
          <div key={i} className="absolute" style={{ left: `${x * 100}%`, top: `calc(${(y / 60) * 22}% - 2px)`, transformOrigin: '50% 0', animation: `scr-sway ${3.2 + (i % 3) * 0.7}s ease-in-out ${-i * 0.6}s infinite` }}>
            <div className="relative -ml-[9px] h-[30px] w-[18px]">
              <div className="absolute left-1/2 top-0 h-[6px] w-px -translate-x-1/2 bg-[#1a0a06]" />
              <div
                className="absolute left-1/2 top-[5px] h-[22px] w-[16px] -translate-x-1/2 rounded-[6px]"
                style={{ background: `radial-gradient(circle at 50% 55%, #fff4c0, ${['#ffb03a', '#ff6f4a', '#ffd04a'][i % 3]} 60%, #8a3a10)`, boxShadow: '0 0 18px 6px rgba(255,170,60,.45)', animation: `scr-flicker ${1.8 + (i % 4) * 0.5}s ease-in-out ${-i * 0.3}s infinite` }}
              />
              <div className="absolute left-1/2 top-[3px] h-[4px] w-[10px] -translate-x-1/2 rounded-sm bg-[#2a1208]" />
            </div>
          </div>
        )
      })}
      {spread(14, 2).map((s, i) => (
        <div key={i} className="absolute bottom-0 h-full w-[5px]" style={{ left: `${s.a * 100}%`, ['--o' as string]: 0.2 + s.c * 0.35, ['--dx' as string]: `${(s.d - 0.5) * 80}px`, animation: `scr-rise ${16 + s.c * 14}s linear ${-s.d * 30}s infinite` }}>
          <span className="absolute left-0 rounded-full bg-[#ffd9a0]" style={{ bottom: `${s.b * 30}%`, width: 2 + s.b * 2.5, height: 2 + s.b * 2.5 }} />
        </div>
      ))}
    </>
  )
}

function Beach() {
  return (
    <>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(168deg, #4a0f3a 0%, #8f2160 36%, #d2506e 62%, #f08a6a 74%, #1d5e6e 100%)' }} />
      <div className="absolute inset-0 opacity-[.07]" style={{ background: 'repeating-linear-gradient(115deg, #fff 0 22px, transparent 22px 56px)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 82% 16%, rgba(255,240,170,.4), rgba(255,240,170,0) 34%)' }} />
      <svg className="absolute inset-x-0 bottom-0 h-[26%] w-full" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden>
        <path d="M0 30 C60 22 120 34 200 28 C280 22 340 32 400 26 V80 H0Z" fill="#2a8a96" opacity=".75" />
        <path d="M0 48 C80 40 160 52 240 46 C310 40 360 50 400 46 V80 H0Z" fill="#ffd9a8" opacity=".85" />
        <path d="M0 62 C90 56 180 66 270 60 C330 56 370 62 400 60 V80 H0Z" fill="#f2bf86" />
      </svg>
      {spread(16, 3).map((s, i) => {
        const size = 8 + s.a * 34
        const col = ['255,240,170', '255,170,220', '170,240,255', '255,255,255'][i % 4]
        return (
          <div key={i} className="absolute bottom-0 h-full" style={{ left: `${s.b * 100}%`, width: size, ['--o' as string]: 0.5 + s.d * 0.5, ['--dx' as string]: `${(s.d - 0.5) * 60}px`, animation: `scr-rise ${18 + s.a * 16}s linear ${-s.c * 34}s infinite` }}>
            <span className="absolute left-0 rounded-full" style={{ bottom: `${s.c * 50}%`, width: size, height: size, background: `radial-gradient(circle, rgba(${col},.55) 0%, rgba(${col},.18) 45%, rgba(${col},0) 70%)` }} />
          </div>
        )
      })}
    </>
  )
}

function Vault() {
  return (
    <>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 34%, #2a1c4c 0%, #140b29 50%, #05030c 100%)' }} />
      <div className="absolute inset-0 opacity-[.5]" style={{ backgroundImage: 'radial-gradient(rgba(150,120,255,.07) 1px, transparent 1.2px)', backgroundSize: '4px 4px' }} />
      {/* the vault door behind it all */}
      <svg className="absolute left-1/2 top-1/2 h-[120%] -translate-x-1/2 -translate-y-1/2 opacity-[.09]" viewBox="-100 -100 200 200" aria-hidden>
        <g fill="none" stroke="#c9a24a">
          <circle r="96" strokeWidth="3" />
          <circle r="84" strokeWidth="1.2" />
          <circle r="40" strokeWidth="2" />
          <circle r="12" strokeWidth="2" />
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} d="M0 -12 V-40" transform={`rotate(${i * 60})`} strokeWidth="3" />
          ))}
        </g>
        <g fill="#c9a24a">
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2
            return <circle key={i} cx={Math.cos(a) * 90} cy={Math.sin(a) * 90} r="2.6" />
          })}
        </g>
      </svg>
      {/* two spotlights sweeping from above */}
      {[
        { x: '18%', a0: '-24deg', a1: '-6deg', d: 9 },
        { x: '82%', a0: '24deg', a1: '6deg', d: 11 },
      ].map((s, i) => (
        <div
          key={i}
          className="absolute -top-[6%] h-[115%] w-[46%]"
          style={{ left: s.x, marginLeft: '-23%', transformOrigin: '50% 0', ['--a0' as string]: s.a0, ['--a1' as string]: s.a1, animation: `scr-spot ${s.d}s ease-in-out ${-i * 3}s infinite`, background: 'linear-gradient(to bottom, rgba(210,220,255,.2), rgba(170,150,255,.06) 60%, rgba(170,150,255,0) 90%)', clipPath: 'polygon(46% 0, 54% 0, 100% 100%, 0 100%)' }}
        />
      ))}
      {spread(12, 4).map((s, i) => (
        <svg
          key={i}
          className="absolute"
          viewBox="-10 -10 20 20"
          width={8 + s.a * 12}
          height={8 + s.a * 12}
          style={{ left: `${s.b * 100}%`, top: `${s.c * 100}%`, animation: `scr-twinkle ${2.4 + s.d * 3}s ease-in-out ${-s.a * 5}s infinite` }}
          aria-hidden
        >
          <path d="M0 -10 Q1.6 -1.6 10 0 Q1.6 1.6 0 10 Q-1.6 1.6 -10 0 Q-1.6 -1.6 0 -10Z" fill={i % 3 ? '#cfe6ff' : '#f3dc96'} />
        </svg>
      ))}
    </>
  )
}

const SCENE: Record<CardId, () => React.ReactNode> = { clover: Meadow, gold: Canyon, fruit: Beach, diamond: Vault }

/** the stage's scene for a card, crossfading to the next */
export const Backdrop = memo(function Backdrop({ id }: { id: CardId }) {
  const Scene = SCENE[id]
  return (
    <div className="scr-bd pointer-events-none absolute inset-0 overflow-hidden bg-[#08121b]">
      <style>{CSS}</style>
      <AnimatePresence initial={false}>
        <motion.div key={id} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease: 'easeInOut' }}>
          <Scene />
        </motion.div>
      </AnimatePresence>
      {/* a soft vignette, so the card always sits in the light */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,.45) 100%)' }} />
    </div>
  )
})
