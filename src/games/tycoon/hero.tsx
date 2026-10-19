import { useId } from 'react'

/*
  Casino Tycoon's lobby art, in the floor's toon style: a little casino on its red carpet under a marquee, palms on
  either side, a slot machine and the gold vault door in front, and Cash and coins flying up off it. The marquee's
  bulbs chase in two groups, each its own svg fading as a whole (as the lobby's star fields do), so the browser
  runs the twinkle on the GPU instead of repainting the picture.
*/

const INK = '#25183a'
const VIEW = '0 0 400 270'

/** a five-pointed star round (cx, cy) */
const star = (cx: number, cy: number, r: number) => {
  const p: string[] = []
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const q = k % 2 ? r * 0.45 : r
    p.push(`${(cx + Math.cos(a) * q).toFixed(1)} ${(cy + Math.sin(a) * q).toFixed(1)}`)
  }
  return `M${p.join(' L')}Z`
}

/** the marquee's bulbs: round the sign and along the cornice */
const BULBS = (() => {
  const out: [number, number][] = []
  for (let x = 204; x <= 340; x += 11.3) out.push([x, 103], [x, 145])
  for (let y = 114; y <= 134; y += 10) out.push([195, y], [349, y])
  for (let x = 180; x <= 364; x += 13.1) out.push([x, 93])
  return out
})()

const coin = (x: number, y: number, r: number, key: number) => (
  <g key={`c${key}`}>
    <circle cx={x} cy={y} r={r} fill="#ffd23f" stroke={INK} strokeWidth="2.4" />
    <circle cx={x} cy={y} r={r * 0.62} fill="none" stroke="#c98a12" strokeWidth="1.6" />
    <path d={star(x, y, r * 0.42)} fill="#c98a12" />
  </g>
)

const bill = (x: number, y: number, rot: number, key: number) => (
  <g key={`b${key}`} transform={`rotate(${rot} ${x} ${y})`}>
    <rect x={x - 15} y={y - 9.5} width="30" height="19" rx="3.5" fill="#3fc96a" stroke="#155f33" strokeWidth="2.2" />
    <circle cx={x} cy={y} r="4.6" fill="#bff0cf" stroke="#155f33" strokeWidth="1.6" />
  </g>
)

const sparkle = (x: number, y: number, r: number, key: number) => <path key={`s${key}`} d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`} fill="#fff6cf" />

function Palm({ x, flip = false }: { x: number; flip?: boolean }) {
  const s = flip ? -1 : 1
  const top = [x + 8 * s, 166]
  // a frond: out to its tip over the top, back underneath, wide in the middle
  const leaf = (dx: number, dy: number) => `M${top[0]} ${top[1]}Q${top[0] + dx * 0.45} ${top[1] + dy * 0.45 - 13} ${top[0] + dx} ${top[1] + dy}Q${top[0] + dx * 0.6} ${top[1] + dy * 0.6 + 5} ${top[0]} ${top[1]}Z`
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <path d={`M${x} 238C${x - 4 * s} 214 ${x + 2 * s} 188 ${top[0]} ${top[1]}`} fill="none" stroke={INK} strokeWidth="10" />
      <path d={`M${x} 238C${x - 4 * s} 214 ${x + 2 * s} 188 ${top[0]} ${top[1]}`} fill="none" stroke="#a8743c" strokeWidth="5.5" />
      <g fill="#2fc47a" stroke={INK} strokeWidth="2.4">
        <path d={leaf(-40 * s, 20)} />
        <path d={leaf(40 * s, 18)} />
        <path d={leaf(-34 * s, -6)} />
        <path d={leaf(34 * s, -8)} />
        <path d={leaf(6 * s, -26)} />
      </g>
    </g>
  )
}

/** a layer of the bulbs (every other one), to twinkle on its own */
const Bulbs = ({ odd, delay }: { odd: boolean; delay: string }) => (
  <svg className="twinkle absolute inset-0 h-full w-full" style={{ animationDelay: delay, animationDuration: '1.2s' }} viewBox={VIEW} preserveAspectRatio="xMaxYMid slice" aria-hidden>
    {BULBS.filter((_, k) => k % 2 === (odd ? 1 : 0)).map(([x, y], k) => (
      <circle key={k} cx={x} cy={y} r="2.6" fill={odd ? '#fff6cf' : '#ffe08a'} stroke="#7a4b00" strokeWidth="0.8" />
    ))}
  </svg>
)

export function TycoonHero() {
  const u = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[58%] sm:block [mask-image:linear-gradient(to_right,transparent,black_20%)]">
      <svg className="absolute inset-0 h-full w-full" viewBox={VIEW} preserveAspectRatio="xMaxYMid slice" aria-hidden>
        <defs>
          <radialGradient id={`${u}g`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffcf4a" stopOpacity=".45" />
            <stop offset="1" stopColor="#ffcf4a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${u}b`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#fff2c4" stopOpacity=".28" />
            <stop offset="1" stopColor="#fff2c4" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${u}d`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe9a8" />
            <stop offset="1" stopColor="#ffb84a" />
          </linearGradient>
        </defs>
        <ellipse cx="272" cy="140" rx="170" ry="130" fill={`url(#${u}g)`} />
        {/* the searchlights */}
        <path d="M214 236 160 0h40Z" fill={`url(#${u}b)`} />
        <path d="M330 236 370 0h40Z" fill={`url(#${u}b)`} />
        <ellipse cx="272" cy="242" rx="160" ry="11" fill="#000" opacity=".35" />

        <Palm x={158} />
        <Palm x={372} flip />

        <g stroke={INK} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
          {/* the tower and its star */}
          <rect x="242" y="42" width="60" height="56" rx="4" fill="#7a4fc4" />
          <path d="M236 46h72l-9-14h-54Z" fill="#ffd23f" />
          <rect x="256" y="56" width="12" height="16" rx="2" fill="#ffd86b" strokeWidth="2.2" />
          <rect x="276" y="56" width="12" height="16" rx="2" fill="#ffd86b" strokeWidth="2.2" />
          <path d={star(272, 16, 15)} fill="#ffd23f" />
          {/* the main block */}
          <rect x="182" y="92" width="180" height="144" rx="6" fill="#5b3a9e" />
          <rect x="174" y="86" width="196" height="14" rx="4" fill="#ffd23f" />
          {[194, 216, 312, 334].map((x) =>
            [154, 190].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="16" height="22" rx="2.5" fill={(x + y) % 3 ? '#ffd86b' : '#3a2160'} strokeWidth="2.2" />),
          )}
          {/* the marquee */}
          <rect x="198" y="106" width="148" height="36" rx="8" fill="#e0473f" />
          <text x="272" y="133" textAnchor="middle" fontSize="24" fontWeight="900" letterSpacing="3" fill="#fff" stroke={INK} strokeWidth="4" paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
            CASINO
          </text>
          {/* the door under its awning, lit from inside */}
          <path d="M250 236V182a22 22 0 0 1 44 0v54Z" fill={`url(#${u}d)`} />
          <path d="M272 168v68M258 200h4M282 200h4" strokeWidth="2.4" />
          <rect x="237" y="164" width="9" height="72" rx="2" fill="#ffd23f" />
          <rect x="298" y="164" width="9" height="72" rx="2" fill="#ffd23f" />
          <path d="M236 152h72v10c-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0Z" fill="#fff" />
          <path d="M248 152v13M260 152v12M272 152v13M284 152v12M296 152v13" stroke="#e0473f" strokeWidth="6" />
          <path d="M236 152h72v10c-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0-4 6-8 6-12 0Z" fill="none" />
          {/* the red carpet */}
          <path d="M254 236h36l26 34h-88Z" fill="#e0473f" />
          <path d="M258 240h28M250 252h44" stroke="#ffd23f" strokeWidth="2" />
        </g>

        {/* a slot machine and the vault in front */}
        <g transform="translate(110 168) scale(1.55)" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
          <path d="M12 12c2.5-6 17.5-6 20 0Z" fill="#ffd23f" />
          <rect x="9" y="11.5" width="26" height="31.5" rx="4" fill="#ff5a4e" />
          <rect x="12" y="16" width="20" height="11.5" rx="2" fill="#fff7e6" />
          <path d="M18.7 16v11.5M25.3 16v11.5" strokeWidth="1.6" />
          <path d="M13.6 19.2h3.4l-2 5.4M20.3 19.2h3.4l-2 5.4M27 19.2h3.4l-2 5.4" fill="none" stroke="#e0473f" strokeWidth="1.8" />
          <rect x="13" y="31.5" width="18" height="7.5" rx="2" fill="#a3243a" />
          <path d="M35 29h3V17" fill="none" />
          <circle cx="38" cy="14" r="3.2" fill="#ffd23f" />
        </g>
        <g transform="translate(326 186)">
          <circle cx="32" cy="32" r="31" fill="#3d3a6e" stroke={INK} strokeWidth="3" />
          <circle cx="32" cy="32" r="22" fill="#ffd36b" stroke={INK} strokeWidth="3" />
          <circle cx="32" cy="32" r="15" fill="none" stroke="#c9952b" strokeWidth="2.6" />
          <path d="M32 17v30M19 24.5l26 15M19 39.5l26-15" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
          <circle cx="32" cy="32" r="5" fill="#fff3c8" stroke={INK} strokeWidth="2.6" />
        </g>
        {coin(336, 252, 8, 0)}
        {coin(352, 256, 7, 1)}
        {coin(321, 258, 6.5, 2)}

        {/* Cash and coins flying up */}
        {bill(212, 62, -18, 0)}
        {bill(352, 44, 14, 1)}
        {bill(178, 112, 10, 2)}
        {coin(232, 30, 9, 3)}
        {coin(330, 76, 8, 4)}
        {coin(196, 82, 7, 5)}
        {coin(372, 112, 7.5, 6)}
        {sparkle(250, 64, 6, 0)}
        {sparkle(316, 28, 7, 1)}
        {sparkle(190, 44, 5, 2)}
        {sparkle(364, 82, 5, 3)}
      </svg>
      <Bulbs odd={false} delay="0s" />
      <Bulbs odd delay="0.6s" />
    </div>
  )
}
