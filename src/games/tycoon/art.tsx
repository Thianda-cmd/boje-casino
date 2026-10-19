import type { ReactNode } from 'react'
import { ACCENT } from './words'

/*
  Casino Tycoon's flat art for the panel and the HUD, in the floor's toon style: flat fills, a deep ink outline of
  even width and a white glint here and there. The ten attractions' icons, the Cash note (green, as on the floor's
  For sale signs), the Star, the managers' faces and the five cities' emblems (the Coin Vault's door is in door.tsx,
  light enough for the Rewards page to take on its own). Everything is
  plain SVG; the only ids are the city emblems' round clips, the same wherever an emblem repeats.
*/

const INK = '#25183a'
const W = 2.2

const Svg = ({ size, children, box = 48, className = '' }: { size: number; children: ReactNode; box?: number; className?: string }) => (
  <svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} className={className} aria-hidden>
    <g stroke={INK} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round">
      {children}
    </g>
  </svg>
)

/** a white glint: a short soft stroke on glass and paint */
const Glint = ({ d, w = 1.8 }: { d: string; w?: number }) => <path d={d} stroke="#fff" strokeWidth={w} opacity={0.75} fill="none" />

const pip = (cx: number, cy: number, r = 1.9, fill = INK) => <circle cx={cx} cy={cy} r={r} fill={fill} stroke="none" />

/** roulette's wedges round the hub */
const WEDGES = Array.from({ length: 12 }, (_, k) => {
  const a0 = (k / 12) * Math.PI * 2 - Math.PI / 2
  const a1 = ((k + 1) / 12) * Math.PI * 2 - Math.PI / 2
  const p = (r: number, a: number) => `${(24 + Math.cos(a) * r).toFixed(2)} ${(24 + Math.sin(a) * r).toFixed(2)}`
  return { d: `M${p(8, a0)} L${p(16.5, a0)} A16.5 16.5 0 0 1 ${p(16.5, a1)} L${p(8, a1)} A8 8 0 0 0 ${p(8, a0)}Z`, fill: k === 0 ? '#2fc47a' : k % 2 ? '#e0473f' : '#2a2233' }
})

const ICONS: ((s: number) => ReactNode)[] = [
  // claw machine: a pink cabinet under a marquee, a claw over the plush
  (s) => (
    <Svg size={s}>
      <rect x="10" y="12" width="28" height="31" rx="4" fill="#ff6fb1" />
      <rect x="11.5" y="5" width="25" height="8" rx="3" fill="#ffd23f" />
      <rect x="14" y="15.5" width="20" height="14" rx="2" fill="#c9f0ff" />
      <circle cx="19.5" cy="26" r="3" fill="#ffd23f" strokeWidth="1.8" />
      <circle cx="28.5" cy="26.4" r="2.6" fill="#7cdc5a" strokeWidth="1.8" />
      <path d="M24 15.5v4.5M20.8 23.2 22 20h4l1.2 3.2" fill="none" strokeWidth="1.8" />
      <rect x="14" y="33" width="8.5" height="6.5" rx="1.6" fill="#4a2a63" />
      <circle cx="30" cy="36.2" r="2.6" fill="#ff4f6e" />
      <Glint d="M16.6 17.6v4.4" />
      {pip(16, 9, 1.1, '#fff')}
      {pip(24, 9, 1.1, '#fff')}
      {pip(32, 9, 1.1, '#fff')}
    </Svg>
  ),
  // slot machine: three sevens behind the glass, a dome light and the lever
  (s) => (
    <Svg size={s}>
      <path d="M12 12c2.5-6 17.5-6 20 0Z" fill="#ffd23f" />
      <rect x="9" y="11.5" width="26" height="31.5" rx="4" fill="#ff5a4e" />
      <rect x="12" y="16" width="20" height="11.5" rx="2" fill="#fff7e6" />
      <path d="M18.7 16v11.5M25.3 16v11.5" strokeWidth="1.6" />
      <path d="M13.6 19.2h3.4l-2 5.4M20.3 19.2h3.4l-2 5.4M27 19.2h3.4l-2 5.4" fill="none" stroke="#e0473f" strokeWidth="1.8" />
      <rect x="13" y="31.5" width="18" height="7.5" rx="2" fill="#a3243a" />
      <path d="M35 29h3V17" fill="none" />
      <circle cx="38" cy="14" r="3.2" fill="#ffd23f" />
      <Glint d="M12 14.5c0-1 .4-1.8 1.4-2" />
    </Svg>
  ),
  // dice: a white die tumbling over a green one
  (s) => (
    <Svg size={s}>
      <g transform="rotate(16 32 18)">
        <rect x="23.5" y="8.5" width="17" height="17" rx="4" fill="#2fc47a" />
        {pip(28, 13, 1.7, '#fff')}
        {pip(32, 17, 1.7, '#fff')}
        {pip(36, 21, 1.7, '#fff')}
      </g>
      <g transform="rotate(-12 18 30)">
        <rect x="7.5" y="19.5" width="21" height="21" rx="5" fill="#fff" />
        {pip(12.8, 24.8, 2, '#e0473f')}
        {pip(23.2, 24.8, 2, '#e0473f')}
        {pip(18, 30, 2, '#e0473f')}
        {pip(12.8, 35.2, 2, '#e0473f')}
        {pip(23.2, 35.2, 2, '#e0473f')}
      </g>
    </Svg>
  ),
  // blackjack: an ace and a king fanned out, a chip at their foot
  (s) => (
    <Svg size={s}>
      <g transform="rotate(-14 19 27)">
        <rect x="9" y="11" width="19.5" height="27" rx="3" fill="#fff" />
        <path d="M18.8 19.5c-3.2 3.3-5.2 4.8-5.2 7 0 1.6 1.4 2.6 2.8 2.2-.3 1.2-.8 2-1.6 2.6h8c-.8-.6-1.3-1.4-1.6-2.6 1.4.4 2.8-.6 2.8-2.2 0-2.2-2-3.7-5.2-7Z" fill={INK} strokeWidth="1" />
      </g>
      <g transform="rotate(12 29 27)">
        <rect x="19.5" y="11" width="19.5" height="27" rx="3" fill="#fff" />
        <path d="M29.2 31.5c-4-3-6.2-5-6.2-7.4 0-1.7 1.3-2.9 2.9-2.9 1.4 0 2.6.9 3.3 2.1.7-1.2 1.9-2.1 3.3-2.1 1.6 0 2.9 1.2 2.9 2.9 0 2.4-2.2 4.4-6.2 7.4Z" fill="#e0473f" strokeWidth="1.4" />
      </g>
      <circle cx="37" cy="38.5" r="6.2" fill="#14b29a" />
      <circle cx="37" cy="38.5" r="3.4" fill="none" stroke="#fff" strokeWidth="1.4" strokeDasharray="2.2 1.8" />
    </Svg>
  ),
  // roulette: the wheel from above, the ball on the rim
  (s) => (
    <Svg size={s}>
      <circle cx="24" cy="24" r="20" fill="#8a4a24" />
      {WEDGES.map((w, k) => (
        <path key={k} d={w.d} fill={w.fill} strokeWidth="1" />
      ))}
      <circle cx="24" cy="24" r="8" fill="#f2b230" />
      <path d="M24 18v12M18 24h12" strokeWidth="1.8" />
      <circle cx="24" cy="24" r="2.2" fill="#fff3c8" strokeWidth="1.4" />
      <circle cx="33.5" cy="11.8" r="2.3" fill="#fff" strokeWidth="1.6" />
    </Svg>
  ),
  // poker: two stacks of chips and a card behind them
  (s) => (
    <Svg size={s}>
      <g transform="rotate(10 30 18)">
        <rect x="22" y="5" width="17" height="23" rx="3" fill="#fff" />
        <path d="M30.5 10.5 34 16l-3.5 5.5L27 16Z" fill="#e0473f" strokeWidth="1.4" />
      </g>
      {[0, 1, 2, 3].map((k) => (
        <g key={k}>
          <rect x="6" y={36 - k * 5} width="18" height="6" rx="3" fill={['#7d6cff', '#fff', '#7d6cff', '#fff'][k]} />
          <path d={`M11 ${37.2 - k * 5}v3.6M19 ${37.2 - k * 5}v3.6`} stroke={k % 2 ? '#7d6cff' : '#fff'} strokeWidth="1.6" />
        </g>
      ))}
      {[0, 1, 2].map((k) => (
        <g key={k}>
          <rect x="24" y={37 - k * 5} width="18" height="6" rx="3" fill={k % 2 ? '#fff' : '#e0473f'} />
          <path d={`M29 ${38.2 - k * 5}v3.6M37 ${38.2 - k * 5}v3.6`} stroke={k % 2 ? '#e0473f' : '#fff'} strokeWidth="1.6" />
        </g>
      ))}
    </Svg>
  ),
  // VIP lounge: a tufted velvet armchair with a little crown
  (s) => (
    <Svg size={s}>
      <path d="M12.5 27V16.5c0-4 2.5-6 6-6h11c3.5 0 6 2 6 6V27Z" fill="#b36bff" />
      {pip(19.5, 17, 1.2)}
      {pip(28.5, 17, 1.2)}
      {pip(24, 21.5, 1.2)}
      <path d="M12.2 37.5v3.5M35.8 37.5v3.5" stroke="#f2b230" strokeWidth="3" />
      <rect x="9" y="26" width="30" height="11" rx="4.5" fill="#9a52e6" />
      <rect x="6" y="22" width="8" height="15" rx="4" fill="#b36bff" />
      <rect x="34" y="22" width="8" height="15" rx="4" fill="#b36bff" />
      <path d="M18.5 9.5 19 3.8l3 3 2-3.8 2 3.8 3-3 .5 5.7Z" fill="#ffd23f" strokeWidth="1.8" />
      <Glint d="M16 15.5c.3-1.5 1-2.3 2-2.7" />
    </Svg>
  ),
  // sky bar: a cocktail with an olive
  (s) => (
    <Svg size={s}>
      <path d="M9 11h30L24 28Z" fill="#c9f0ff" />
      <path d="M13.6 15h20.8L24 26.8Z" fill="#25c2d0" strokeWidth="1.4" />
      <path d="M24 28v11" />
      <path d="M16.5 41h15" strokeWidth="3" />
      <path d="M33 4.5 26.5 17" strokeWidth="1.8" />
      <circle cx="29.6" cy="10.8" r="3" fill="#7cdc5a" strokeWidth="1.8" />
      <Glint d="M13.8 13.6l3.2 3.6" />
    </Svg>
  ),
  // grand stage: a microphone between red curtains under a valance
  (s) => (
    <Svg size={s}>
      <path d="M5 8h11c-1 13-4.5 24-10 34H5Z" fill="#e0473f" />
      <path d="M43 8H32c1 13 4.5 24 10 34h1Z" fill="#e0473f" />
      <path d="M4 5h40v5.5c-3.3 2.6-6.7 2.6-10 0-3.3 2.6-6.7 2.6-10 0-3.3 2.6-6.7 2.6-10 0-3.3 2.6-6.7 2.6-10 0Z" fill="#ff8a3d" />
      <path d="M24 28.5v10.5M18.5 41h11" />
      <rect x="20" y="15" width="8" height="13.5" rx="4" fill="#d9deea" />
      <path d="M20.6 19.5h6.8M20.6 23h6.8" strokeWidth="1.3" />
      <path d="M36 17.5l.9 2 2.1.2-1.6 1.4.5 2.1-1.9-1.1-1.9 1.1.5-2.1-1.6-1.4 2.1-.2Z" fill="#ffd23f" strokeWidth="1.2" />
    </Svg>
  ),
  // penthouse suites: a tower of lit windows with its beacon
  (s) => (
    <Svg size={s}>
      <rect x="7" y="27" width="8.5" height="16" rx="1" fill="#e8c46a" />
      <rect x="32.5" y="27" width="8.5" height="16" rx="1" fill="#e8c46a" />
      <path d="M15 43V14.5L24 8l9 6.5V43Z" fill="#fbecc4" />
      {[17.5, 23.5, 29.5, 35.5].map((y, r) =>
        [19.2, 26].map((x, c) => <rect key={`${r}${c}`} x={x} y={y} width="2.8" height="3.4" rx=".6" fill={(r + c) % 3 ? '#ffd23f' : '#4a2a63'} strokeWidth="1.2" />),
      )}
      <path d="M24 8V3.5" />
      <circle cx="24" cy="3.2" r="2" fill="#ff4f6e" strokeWidth="1.4" />
      <path d="M21 43v-4.5h6V43" fill="#4a2a63" strokeWidth="1.6" />
    </Svg>
  ),
]

/** attraction i's icon on its coloured tile; `dim` for one not open yet */
export function AttractionIcon({ i, size = 48, dim = false, className = '' }: { i: number; size?: number; dim?: boolean; className?: string }) {
  const c = ACCENT[i]
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-[14px] ${className}`}
      style={{
        width: size,
        height: size,
        background: dim ? 'rgba(255,255,255,.04)' : `linear-gradient(150deg, ${c}55, ${c}1c)`,
        boxShadow: dim ? 'inset 0 0 0 1px rgba(255,255,255,.06)' : `inset 0 0 0 1px ${c}55, inset 0 -3px 0 rgba(0,0,0,.18)`,
      }}
    >
      <span style={dim ? { filter: 'grayscale(1) brightness(.75)', opacity: 0.55 } : undefined}>{ICONS[i](Math.round(size * 0.84))}</span>
    </span>
  )
}


/** Cash: the green note from the floor's For sale signs */
export function CashIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={Math.round(size * 0.72)} viewBox="0 0 25 18" className={`shrink-0 ${className}`} aria-hidden>
      <rect x="1.2" y="1.2" width="22.6" height="15.6" rx="3.2" fill="#3fc96a" stroke="#155f33" strokeWidth="1.6" />
      <rect x="3.6" y="3.6" width="17.8" height="10.8" rx="1.8" fill="none" stroke="#bff0cf" strokeWidth="1" opacity=".7" />
      <circle cx="12.5" cy="9" r="3.4" fill="#bff0cf" stroke="#155f33" strokeWidth="1.2" />
      <circle cx="6" cy="9" r="1.1" fill="#155f33" />
      <circle cx="19" cy="9" r="1.1" fill="#155f33" />
    </svg>
  )
}

/** a Star: gold with an ink rim */
export function StarIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden>
      <path d="m12 2.2 2.95 6.1 6.7.95-4.85 4.7 1.15 6.65L12 17.45 6.05 20.6l1.15-6.65-4.85-4.7 6.7-.95Z" fill="#ffcf4a" stroke="#7a4b00" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.4 9.9 11 9.5l1-2.1" fill="none" stroke="#fff6cf" strokeWidth="1.3" strokeLinecap="round" opacity=".9" />
    </svg>
  )
}

const SKIN = ['#ffd9b8', '#f2c08f', '#c98a5a', '#ffe0c4', '#e8b07c', '#8d5a38', '#ffd2ad', '#d69c6b', '#f7caa0', '#ffe3cc']
const SUIT = ['#ff6fb1', '#d8394b', '#1f9e63', '#127a69', '#b07a10', '#5446c8', '#7d3cc8', '#178a96', '#d9622a', '#8f6f2a']
const HAIR = ['#5a3b2a', '#2a2233', '#7a3a1a', '#3b2a1a', '#c2361f', '#2a2233', '#4a3a2a', '#d08a2a', '#ffd86b', '#9aa3b5']

/** a manager's portrait: a toon head and shoulders, each with their own hair or hat */
export function ManagerFace({ i, size = 40, off = false }: { i: number; size?: number; off?: boolean }) {
  const hair = HAIR[i]
  const style = [
    // bun
    <>
      <circle cx="20" cy="7" r="4" fill={hair} />
      <path d="M11 18c0-6 4-9.5 9-9.5s9 3.5 9 9.5c-2.5-2.5-6-3.6-9-3.6S13.5 15.5 11 18Z" fill={hair} />
    </>,
    // fedora
    <>
      <path d="M8.5 13.5c4-1.6 19-1.6 23 0" fill="none" strokeWidth="2.6" />
      <path d="M12.5 13c.4-5 3.4-7 7.5-7s7.1 2 7.5 7Z" fill="#3a3550" />
      <path d="M12.8 11.2h14.4" stroke="#ffd23f" strokeWidth="1.8" />
    </>,
    // curls
    <path d="M11 17c-1.6-5 1.4-9 4.4-9.4 1.4-2 6.8-2 8.4 0 3 .4 6 4.4 4.2 9.4-1-2.6-3.2-3-4.6-2.2-1-1.6-3.6-1.8-4.8-.2-1.4-1.2-4-.6-4.6 1.4-.9-.8-2.2-.6-3 1Z" fill={hair} />,
    // dealer's visor
    <>
      <path d="M11.4 16c0-5.4 3.6-8.4 8.6-8.4s8.6 3 8.6 8.4c-1.8-2.2-5.2-3.2-8.6-3.2s-6.8 1-8.6 3.2Z" fill={hair} />
      <path d="M10.5 13.6c3-1.5 16-1.5 19 0l-2 3.2c-3.6-1-11.4-1-15 0Z" fill="#2fc47a" />
    </>,
    // long hair
    <path d="M10.5 27c-1-5-1.2-11 .5-14.5 1.6-3.4 5-5 9-5s7.4 1.6 9 5c1.7 3.5 1.5 9.5.5 14.5-1-3-1.6-6.6-1.6-9.4-2.4-1-5.6-3.4-7-6-1.4 2.6-4.6 5-7.6 6 0 2.8-.6 6.4-1.8 9.4Z" fill={hair} />,
    // flat cap
    <>
      <path d="M11 15.5c0-5.5 3.8-8.5 9-8.5 5 0 8.4 2.4 9 6.6l3 1.6c-6-.8-14.6-1-21 .3Z" fill="#7d6cff" />
    </>,
    // top hat
    <>
      <path d="M9.5 12.4h21" strokeWidth="2.8" />
      <rect x="13.5" y="1.5" width="13" height="11" rx="1.4" fill="#2a2233" />
      <path d="M13.6 9.4h12.8" stroke="#b36bff" strokeWidth="2" />
    </>,
    // quiff
    <path d="M11.2 16.5c-.4-5 3-8.6 7.4-9.4 1.2-2.2 6.4-3.4 9.2-.8-1.2.2-2 .8-2.2 1.4 2.4 1.2 3.4 4.4 3.2 8.8-1.6-2-3.6-3.4-6-3.8-2.6 1.4-7 1.8-11.6 3.8Z" fill={hair} />,
    // diva: big hair and a star
    <>
      <path d="M8.5 24c-2-6-1.4-12.4 2-15.6 2.6-2.6 6-3.4 9.5-3.4s6.9.8 9.5 3.4c3.4 3.2 4 9.6 2 15.6-1.4-4-2-7.6-2-9.6-3-.6-6.8-2.6-9.5-5-2.7 2.4-6.5 4.4-9.5 5 0 2-.6 5.6-2 9.6Z" fill={hair} />
      <path d="M28.5 6.5l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z" fill="#ff6fb1" strokeWidth="1.1" />
    </>,
    // bowler and a moustache
    <>
      <path d="M9.8 13.2h20.4" strokeWidth="2.6" />
      <path d="M12.8 12.8c0-5 3.2-7.6 7.2-7.6s7.2 2.6 7.2 7.6Z" fill="#2a2233" />
      <path d="M15.8 22.4c1.6-1.6 3.2-1.6 4.2-.4 1-1.2 2.6-1.2 4.2.4-1.6.4-3 .2-4.2-.6-1.2.8-2.6 1-4.2.6Z" fill="#9aa3b5" strokeWidth="1.2" />
    </>,
  ][i]
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden style={off ? { filter: 'grayscale(1)', opacity: 0.45 } : undefined}>
      <g stroke={INK} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round">
        <path d="M5.5 40c0-8 5.8-11.5 14.5-11.5S34.5 32 34.5 40Z" fill={SUIT[i]} />
        <path d="M16 29l4 6.2 4-6.2" fill="#fff" />
        <path d="M17 31.2l3 1.4 3-1.4v3.2l-3-1.4-3 1.4Z" fill={i === 6 ? '#ffd23f' : '#25183a'} strokeWidth="1.1" />
        <circle cx="20" cy="18" r="9.2" fill={SKIN[i]} />
        {pip(16.6, 18.6, 1.25)}
        {pip(23.4, 18.6, 1.25)}
        <path d="M17.4 22.2c1.6 1.4 3.6 1.4 5.2 0" fill="none" strokeWidth="1.5" />
        <circle cx="14.6" cy="21.4" r="1.5" fill="#ff8fa8" stroke="none" opacity=".7" />
        <circle cx="25.4" cy="21.4" r="1.5" fill="#ff8fa8" stroke="none" opacity=".7" />
        {style}
      </g>
    </svg>
  )
}

/** the five cities' emblems: a windmill, a paddle steamer, the pyramid's beam, the Ferris wheel, a yacht */
const CITY_ART: { bg: [string, string]; art: ReactNode }[] = [
  {
    bg: ['#8fd3ff', '#5cbf6a'],
    art: (
      <>
        <path d="M0 34c8-4 16-5 24-3s16 1 24-2v19H0Z" fill="#4caf50" />
        <path d="M21 36l1.5-14h3L27 36Z" fill="#fff3e0" />
        <path d="M24 21.5 14 12M24 21.5l10-9.5M24 21.5 14 31M24 21.5l10 9.5" strokeWidth="3" />
        <circle cx="24" cy="21.5" r="2" fill="#e0473f" />
      </>
    ),
  },
  {
    bg: ['#9fdcff', '#3a8fd9'],
    art: (
      <>
        <path d="M0 33c6 2 12 2 18 0s12-2 18 0 9 2 12 1v14H0Z" fill="#2a6fb3" />
        <path d="M10 30h28l-3 5H13Z" fill="#fff" />
        <rect x="15" y="23" width="16" height="7" fill="#e0473f" />
        <path d="M19 23v-7M27 23v-7" strokeWidth="2.6" />
        <circle cx="34" cy="28" r="4.5" fill="#ffd23f" />
      </>
    ),
  },
  {
    bg: ['#ffc78a', '#ff8a3d'],
    art: (
      <>
        <path d="M24 2 21 20h6Z" fill="#fff6c4" stroke="none" opacity=".8" />
        <path d="M8 38 24 18l16 20Z" fill="#2a2233" />
        <path d="M24 18l16 20h-9Z" fill="#14101f" />
        <path d="M0 38h48v10H0Z" fill="#e8a65a" />
      </>
    ),
  },
  {
    bg: ['#5a3a9a', '#21154a'],
    art: (
      <>
        <circle cx="24" cy="22" r="13" fill="none" stroke="#ff6fb1" strokeWidth="2.4" />
        <path d="M24 9v26M11 22h26M14.8 12.8l18.4 18.4M14.8 31.2l18.4-18.4" stroke="#5cf2ff" strokeWidth="1.4" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
          <circle key={k} cx={24 + Math.cos((k / 8) * Math.PI * 2) * 13} cy={22 + Math.sin((k / 8) * Math.PI * 2) * 13} r="2.2" fill="#ffd23f" strokeWidth="1.2" />
        ))}
        <path d="M18 44l6-22 6 22" strokeWidth="2.4" />
      </>
    ),
  },
  {
    bg: ['#bfe9ff', '#2ab0c9'],
    art: (
      <>
        <circle cx="34" cy="13" r="5" fill="#ffd23f" />
        <path d="M0 34c6 1.6 12 1.6 18 0s12-1.6 18 0 9 1.6 12 .8V48H0Z" fill="#1d7fa3" />
        <path d="M24 8v22M24 9 13 27h11M25.5 12 33 27h-7.5" fill="#fff" strokeWidth="1.8" />
        <path d="M9 30h30l-4 5H13Z" fill="#fff" />
      </>
    ),
  },
]

/** a city's round emblem; `off` for one not reached yet */
export function CityEmblem({ k, size = 44, off = false }: { k: number; size?: number; off?: boolean }) {
  const c = CITY_ART[k]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden style={off ? { filter: 'grayscale(.85) brightness(.7)', opacity: 0.6 } : undefined}>
      <defs>
        <clipPath id={`ty-city-${k}`}>
          <circle cx="24" cy="24" r="22" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="22" fill={c.bg[0]} />
      <path d="M2 24h44v22H2Z" fill={c.bg[1]} opacity=".55" clipPath={`url(#ty-city-${k})`} />
      <g clipPath={`url(#ty-city-${k})`} stroke={INK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        {c.art}
      </g>
      <circle cx="24" cy="24" r="22" fill="none" stroke={INK} strokeWidth="2.4" />
    </svg>
  )
}
