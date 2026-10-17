import { GOLD, Lin, Rad, shadow, twinkle } from './symbolkit'

/*
  The blanks: four symbols per card that pay nothing and only ever fill the board (rules.ts). Same drawing rules as the
  prizes (flat shades lit from the top left, the card's ink round every shape, a 100 × 100 box), so a board reads as one
  printed sheet; the card shows them without a prize badge.
*/

/* ---------------- Lucky Clover (ink: deep green) ---------------- */

const CI = '#163a23'

export function Acorn({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}n`} stops={[[0, '#f2b672'], [0.5, '#c27a30'], [1, '#7a4012']]} cx={0.36} cy={0.3} r={0.85} />
        <Lin id={`${u}c`} stops={[[0, '#9a6636'], [1, '#5a3414']]} />
      </defs>
      {shadow(20, 92)}
      <path d="M30 46 C30 70 40 86 50 91 C60 86 70 70 70 46Z" fill={`url(#${u}n)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M38 56 C38 68 42 76 47 82" stroke="#ffdcae" strokeWidth="3.2" fill="none" strokeLinecap="round" opacity=".6" />
      <path d="M50 91 l0 -5" stroke={CI} strokeWidth="3" strokeLinecap="round" />
      <path d="M22 49 C20 31 34 20 50 20 C66 20 80 31 78 49 C66 54 34 54 22 49Z" fill={`url(#${u}c)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <g stroke="#3a200a" strokeWidth="1.5" opacity=".55" strokeLinecap="round">
        <path d="M30 44 L40 26 M40 47 L52 24 M52 48 L64 26 M64 46 L71 34" />
        <path d="M28 34 L44 48 M38 26 L58 49 M52 23 L70 43" />
      </g>
      <path d="M31 34 C35 28 41 25 48 24" stroke="#d29a62" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".75" />
      <path d="M50 20 C50 14 54 9 60 7" stroke={CI} strokeWidth="4.2" fill="none" strokeLinecap="round" />
      <path d="M50 19 C50 14 54 10 59 8" stroke="#8a5a2e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  )
}

export function Daisy({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}p`} stops={[[0, '#ffffff'], [1, '#e2e9ef']]} />
        <Rad id={`${u}c`} stops={[[0, '#fff6b0'], [0.5, '#ffc41f'], [1, '#d97f00']]} cx={0.38} cy={0.32} r={0.8} />
      </defs>
      {shadow(28, 92)}
      <path d="M50 70 Q52 82 48 92" stroke={CI} strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M50 70 Q52 82 48 92" stroke="#3fae55" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <g fill={`url(#${u}p)`} stroke={CI} strokeWidth="2.4">
        {Array.from({ length: 12 }, (_, i) => (
          <ellipse key={i} cx="50" cy="27" rx="7" ry="16" transform={`rotate(${i * 30 + 8} 50 47)`} />
        ))}
      </g>
      <g stroke="#c9d3dc" strokeWidth="1.3" opacity=".8" strokeLinecap="round">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M50 20 V32" transform={`rotate(${i * 30 + 8} 50 47)`} />
        ))}
      </g>
      <circle cx="50" cy="47" r="13" fill={`url(#${u}c)`} stroke={CI} strokeWidth="2.6" />
      <g fill="#c97a00" opacity=".6">
        <circle cx="46" cy="50" r="1.4" />
        <circle cx="53" cy="52" r="1.4" />
        <circle cx="55" cy="45" r="1.4" />
        <circle cx="48" cy="44" r="1.2" />
      </g>
      <path d="M42 42 A9 9 0 0 1 48 38" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".8" />
    </g>
  )
}

export function Butterfly({ u }: { u: string }) {
  const up = 'M48 46 C38 20 14 14 11 32 C9 46 24 56 46 53Z'
  const low = 'M47 55 C30 58 19 71 28 81 C36 88 46 74 48 61Z'
  return (
    <g>
      <defs>
        <Rad id={`${u}w`} stops={[[0, '#d6f1ff'], [0.5, '#46aaff'], [1, '#1b55b8']]} cx={0.7} cy={0.6} r={0.9} />
        <Rad id={`${u}l`} stops={[[0, '#ffd6ef'], [0.55, '#ff7ab8'], [1, '#c2307a']]} cx={0.8} cy={0.2} r={0.9} />
      </defs>
      {shadow(26, 92, 0.15)}
      {[1, -1].map((s) => (
        <g key={s} transform={s < 0 ? 'translate(100 0) scale(-1 1)' : undefined} stroke={CI} strokeWidth="3" strokeLinejoin="round">
          <path d={up} fill={`url(#${u}w)`} />
          <path d={low} fill={`url(#${u}l)`} />
          <path d="M14 30 C16 22 24 20 30 24" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".7" />
          <g fill="#fff" stroke="none" opacity=".9">
            <circle cx="20" cy="40" r="3" />
            <circle cx="28" cy="47" r="2" />
            <circle cx="31" cy="76" r="2.4" />
          </g>
        </g>
      ))}
      <ellipse cx="50" cy="56" rx="4.2" ry="19" fill="#2b2b2b" stroke={CI} strokeWidth="2" />
      <circle cx="50" cy="35" r="5" fill="#2b2b2b" stroke={CI} strokeWidth="2" />
      <path d="M48 31 C44 22 40 18 35 17 M52 31 C56 22 60 18 65 17" stroke={CI} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="35" cy="17" r="2.6" fill={CI} />
      <circle cx="65" cy="17" r="2.6" fill={CI} />
    </g>
  )
}

export function Snail({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}b`} stops={[[0, '#d9f2c2'], [1, '#88bd6a']]} />
        <Rad id={`${u}s`} stops={[[0, '#ffe0a8'], [0.5, '#ec9235'], [1, '#9c4a10']]} cx={0.36} cy={0.3} r={0.85} />
      </defs>
      {shadow(38, 90, 0.16)}
      <path d="M78 70 C80 58 82 48 80 40 M86 72 C90 60 94 52 94 44" stroke={CI} strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="80" cy="39" r="3.6" fill={CI} />
      <circle cx="94" cy="43" r="3.6" fill={CI} />
      <path d="M10 84 C16 74 30 74 44 75 L74 74 C76 66 82 62 88 64 C95 67 95 78 90 83 C86 87 80 87 74 87 L18 87 C12 87 9 86 10 84Z" fill={`url(#${u}b)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="86" cy="72" r="1.8" fill={CI} />
      <circle cx="44" cy="52" r="25" fill={`url(#${u}s)`} stroke={CI} strokeWidth="3" />
      <path d="M44 52 m3 0 a3 3 0 1 1 -6 0 a8 8 0 1 1 16 0 a13 13 0 1 1 -26 0 a18 18 0 1 1 36 0" stroke="#7a3606" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".75" />
      <path d="M26 42 C29 34 35 30 41 29" stroke="#fff3d6" strokeWidth="3.2" fill="none" strokeLinecap="round" opacity=".7" />
    </g>
  )
}

/* ---------------- Gold Rush (ink: dark leather) ---------------- */

const GI = '#3a1c08'

export function Boot({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}l`} stops={[[0, '#d08a48'], [1, '#86461a']]} x2={1} y2={0.4} />
        <Lin id={`${u}s`} stops={GOLD} x1={0} y1={0} x2={1} y2={1} />
      </defs>
      {shadow(32, 91)}
      <path d="M34 12 H64 L65 52 C65 60 71 64 81 66 C91 68 93 76 91 85 H40 L37 88 H27 L29 70 C29 50 31 30 34 12Z" fill={`url(#${u}l)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M33 12 H65 L65 22 H33Z" fill="#6a3410" stroke={GI} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M27 70 H40 V88 H27Z" fill="#5a2c0e" stroke={GI} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M40 30 C46 40 54 40 58 30 M40 44 C46 52 54 52 58 44" stroke="#ffd9a0" strokeWidth="1.6" fill="none" strokeDasharray="3 2" opacity=".85" />
      <path d="M38 24 V62" stroke="#f0b47a" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <path d="M44 85 H91" stroke="#5a2c0e" strokeWidth="2" opacity=".5" />
      <path d="M27 79 H16" stroke={GI} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14 72 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill={`url(#${u}s)`} stroke={GI} strokeWidth="1.6" strokeLinejoin="round" />
    </g>
  )
}

export function Canteen({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}b`} stops={[[0, '#e8d6a2'], [0.55, '#b0925a'], [1, '#6a5428']]} cx={0.36} cy={0.32} r={0.85} />
        <Lin id={`${u}m`} stops={[[0, '#e6edf2'], [1, '#8a98a6']]} />
      </defs>
      {shadow(28, 92)}
      <path d="M24 46 C18 22 38 8 50 8 C62 8 82 22 76 46" stroke={GI} strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d="M24 46 C18 22 38 8 50 8 C62 8 82 22 76 46" stroke="#a0683a" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="50" cy="58" r="30" fill={`url(#${u}b)`} stroke={GI} strokeWidth="3" />
      <circle cx="50" cy="58" r="25" fill="none" stroke="#f6e6b8" strokeWidth="1.5" strokeDasharray="3 2.5" opacity=".9" />
      <circle cx="50" cy="58" r="19" fill="none" stroke="#7a6232" strokeWidth="2" opacity=".6" />
      <rect x="43" y="22" width="14" height="10" rx="2" fill={`url(#${u}m)`} stroke={GI} strokeWidth="2.5" />
      <rect x="41" y="15" width="18" height="8" rx="2.5" fill="#7d8a96" stroke={GI} strokeWidth="2.5" />
      <path d="M30 48 C32 40 38 35 45 33" stroke="#fff6d8" strokeWidth="3.2" fill="none" strokeLinecap="round" opacity=".6" />
    </g>
  )
}

export function Stetson({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}b`} stops={[[0, '#e2b276'], [1, '#a26c34']]} />
        <Lin id={`${u}c`} stops={[[0, '#ebbe82'], [0.6, '#b47a3e'], [1, '#8a5424']]} x2={1} y2={0} />
        <Lin id={`${u}g`} stops={GOLD} />
      </defs>
      {shadow(40, 86, 0.16)}
      <path d="M5 62 C9 52 26 57 50 57 C74 57 91 52 95 62 C91 74 70 77 50 77 C30 77 9 74 5 62Z" fill={`url(#${u}b)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M12 63 C24 70 76 70 88 63" stroke="#7a4a1c" strokeWidth="1.8" fill="none" opacity=".55" />
      <path d="M28 60 C26 40 30 23 40 21 C46 26 54 26 60 21 C70 23 74 40 72 60 C62 65 38 65 28 60Z" fill={`url(#${u}c)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M50 27 C48 36 50 45 50 52" stroke="#7a4a1c" strokeWidth="2" fill="none" opacity=".6" strokeLinecap="round" />
      <path d="M28 52 C40 57 60 57 72 52 L72 60 C60 65 40 65 28 60Z" fill="#4a2410" stroke={GI} strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="45" y="53.5" width="10" height="8" rx="1.6" fill="none" stroke={`url(#${u}g)`} strokeWidth="2.6" />
      <path d="M34 30 C32 40 32 46 33 52" stroke="#fbe0b2" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".6" />
    </g>
  )
}

export function Wheel({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}i`} stops={[[0, '#c9d3dc'], [1, '#5d6c7c']]} x1={0} y1={0} x2={1} y2={1} />
      </defs>
      {shadow(30, 93)}
      <g strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i} transform={`rotate(${i * 45 + 22.5} 50 50)`}>
            <path d="M50 42 V18" stroke={GI} strokeWidth="7" />
            <path d="M50 42 V18" stroke="#c88a4a" strokeWidth="3.2" />
          </g>
        ))}
      </g>
      <circle cx="50" cy="50" r="33" fill="none" stroke={GI} strokeWidth="13" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#a86a32" strokeWidth="7" />
      <circle cx="50" cy="50" r="38.5" fill="none" stroke={`url(#${u}i)`} strokeWidth="3.4" />
      <circle cx="50" cy="50" r="40.5" fill="none" stroke={GI} strokeWidth="1.6" />
      <g fill="#e6edf2" stroke={GI} strokeWidth="1">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return <circle key={i} cx={50 + Math.cos(a) * 38.5} cy={50 + Math.sin(a) * 38.5} r="1.8" />
        })}
      </g>
      <circle cx="50" cy="50" r="10" fill="#8a5a2e" stroke={GI} strokeWidth="3" />
      <circle cx="50" cy="50" r="4" fill="#c9d3dc" stroke={GI} strokeWidth="1.4" />
      <path d="M24 34 A30 30 0 0 1 36 22" stroke="#f0c48a" strokeWidth="2.6" fill="none" opacity=".75" />
    </g>
  )
}

/* ---------------- Fruit Frenzy (ink: deep berry) ---------------- */

const FI = '#4a0d2c'

export function Banana({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}b`} stops={[[0, '#fff7a8'], [0.5, '#ffd93a'], [1, '#e4a400']]} x1={0} y1={0} x2={0.6} y2={1} />
      </defs>
      {shadow(32, 92)}
      <path d="M18 30 C14 56 30 80 60 84 C76 86 88 80 91 73 C76 76 56 72 44 60 C34 50 30 40 31 28Z" fill={`url(#${u}b)`} stroke={FI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M27 38 C30 56 44 70 66 78" stroke="#c99a10" strokeWidth="2" fill="none" opacity=".6" strokeLinecap="round" />
      <path d="M22 44 C24 56 30 64 38 70" stroke="#fff" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity=".6" />
      <path d="M22 30 L26 15 L33 17 L31 31Z" fill="#8a6a2a" stroke={FI} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M88 74 l4 -2 1 3 -3 2Z" fill="#5a3a10" stroke={FI} strokeWidth="1.6" />
    </g>
  )
}

export function Pear({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}p`} stops={[[0, '#f6ffb8'], [0.5, '#bde24c'], [1, '#6aa42a']]} cx={0.36} cy={0.55} r={0.75} />
      </defs>
      {shadow(26, 93)}
      <path d="M50 21 C42 21 40 30 40 38 C40 46 26 52 24 66 C22 81 36 91 50 91 C64 91 78 81 76 66 C74 52 60 46 60 38 C60 30 58 21 50 21Z" fill={`url(#${u}p)`} stroke={FI} strokeWidth="3" strokeLinejoin="round" />
      <g fill="#7a9a2a" opacity=".5">
        <circle cx="44" cy="70" r="1.3" />
        <circle cx="58" cy="76" r="1.3" />
        <circle cx="62" cy="62" r="1.3" />
        <circle cx="50" cy="56" r="1.1" />
      </g>
      <path d="M50 22 C50 15 52 11 56 8" stroke={FI} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M54 14 C62 6 74 8 78 14 C70 20 60 20 54 14Z" fill="#46c35b" stroke={FI} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M33 64 C33 55 39 49 44 47" stroke="#fff" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity=".6" />
    </g>
  )
}

export function Plum({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}p`} stops={[[0, '#d2a6ff'], [0.5, '#7c3cc8'], [1, '#3a1270']]} cx={0.34} cy={0.3} r={0.85} />
      </defs>
      {shadow(30, 92)}
      <ellipse cx="50" cy="57" rx="31" ry="30" fill={`url(#${u}p)`} stroke={FI} strokeWidth="3" />
      <path d="M50 29 C43 41 43 63 50 85" stroke="#2e0d5a" strokeWidth="2.4" fill="none" opacity=".55" strokeLinecap="round" />
      <ellipse cx="37" cy="46" rx="7" ry="10" fill="#fff" opacity=".32" transform="rotate(20 37 46)" />
      <path d="M50 28 C50 21 52 17 55 14" stroke={FI} strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path d="M53 18 C60 10 72 12 76 18 C68 24 58 24 53 18Z" fill="#46c35b" stroke={FI} strokeWidth="2.4" strokeLinejoin="round" />
    </g>
  )
}

export function Kiwi({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}f`} stops={[[0, '#e2ffa8'], [0.55, '#8ed43c'], [1, '#4c9a1c']]} cx={0.5} cy={0.5} r={0.6} />
      </defs>
      {shadow(30, 92)}
      <circle cx="50" cy="52" r="34" fill="#8a6234" stroke={FI} strokeWidth="3" />
      <circle cx="50" cy="52" r="29" fill={`url(#${u}f)`} />
      <g stroke="#d6f59a" strokeWidth="1.2" opacity=".7">
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d="M50 42 V25" transform={`rotate(${i * 22.5} 50 52)`} />
        ))}
      </g>
      <ellipse cx="50" cy="52" rx="9" ry="7" fill="#fffbe0" />
      <g fill="#1d1a14">
        {Array.from({ length: 14 }, (_, i) => (
          <ellipse key={i} cx="50" cy="37" rx="1.5" ry="2.6" transform={`rotate(${i * 25.7} 50 52)`} />
        ))}
      </g>
      <path d="M26 40 A27 27 0 0 1 40 26" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".55" />
    </g>
  )
}

/* ---------------- Diamond Deluxe (ink: midnight) ---------------- */

const DI = '#0b0620'

export function Watch({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}g`} stops={GOLD} x1={0} y1={0} x2={1} y2={1} />
        <Rad id={`${u}f`} stops={[[0, '#ffffff'], [1, '#efe8d6']]} cx={0.4} cy={0.35} r={0.8} />
      </defs>
      {shadow(28, 93)}
      <path d="M55 12 C64 4 76 6 82 12 C86 16 86 22 82 25" stroke="#e8c25a" strokeWidth="2.6" fill="none" strokeDasharray="2.4 2" strokeLinecap="round" />
      <circle cx="50" cy="14" r="5.5" fill="none" stroke={DI} strokeWidth="6" />
      <circle cx="50" cy="14" r="5.5" fill="none" stroke={`url(#${u}g)`} strokeWidth="2.8" />
      <rect x="45.5" y="19" width="9" height="7" rx="1.6" fill={`url(#${u}g)`} stroke={DI} strokeWidth="2.2" />
      <circle cx="50" cy="57" r="32" fill={`url(#${u}g)`} stroke={DI} strokeWidth="3" />
      <circle cx="50" cy="57" r="25" fill={`url(#${u}f)`} stroke="#a8740a" strokeWidth="1.6" />
      <g stroke={DI} strokeWidth="2" strokeLinecap="round">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d={i % 3 ? 'M50 35 V37.5' : 'M50 35 V40'} transform={`rotate(${i * 30} 50 57)`} />
        ))}
      </g>
      <path d="M50 57 L50 42" stroke={DI} strokeWidth="3" strokeLinecap="round" />
      <path d="M50 57 L62 62" stroke={DI} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="50" cy="57" r="2.6" fill="#e8a21a" stroke={DI} strokeWidth="1.2" />
      <path d="M31 46 A21 21 0 0 1 42 37" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".8" />
    </g>
  )
}

export function GoldenKey({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}g`} stops={GOLD} x1={0} y1={0} x2={1} y2={1} />
      </defs>
      {shadow(30, 90)}
      <g transform="rotate(-38 50 50)">
        <path d="M44 46 H88 V54 H44Z" fill={`url(#${u}g)`} stroke={DI} strokeWidth="3" strokeLinejoin="round" />
        <path d="M70 54 V66 H76 V60 H81 V68 H87 V54Z" fill={`url(#${u}g)`} stroke={DI} strokeWidth="3" strokeLinejoin="round" />
        <path d="M48 48.5 H86" stroke="#fff6c8" strokeWidth="1.8" strokeLinecap="round" opacity=".8" />
        <circle cx="28" cy="50" r="14" fill="none" stroke={DI} strokeWidth="14" />
        <circle cx="28" cy="50" r="14" fill="none" stroke={`url(#${u}g)`} strokeWidth="8.4" />
        <g fill={`url(#${u}g)`} stroke={DI} strokeWidth="2">
          {[0, 90, 180, 270].map((a) => (
            <circle key={a} cx="28" cy="31" r="4" transform={`rotate(${a} 28 50)`} />
          ))}
        </g>
        <path d="M18 42 A13 13 0 0 1 26 37" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".85" />
      </g>
      <path d={twinkle(80, 22, 6)} fill="#fff" />
    </g>
  )
}

export function Perfume({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}b`} stops={[[0, '#ffe0f2'], [0.5, '#ff8ac4'], [1, '#b8307e']]} x1={0} y1={0} x2={1} y2={1} />
        <Lin id={`${u}s`} stops={[[0, '#f6ecff'], [1, '#a978f0']]} x1={0} y1={0} x2={1} y2={1} />
        <Lin id={`${u}g`} stops={GOLD} />
      </defs>
      {shadow(28, 93)}
      <path d="M25 52 L36 41 H64 L75 52 V81 L64 91 H36 L25 81Z" fill={`url(#${u}b)`} stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M34 54 L41 48 H59 L66 54 V78 L59 84 H41 L34 78Z" fill="#fff" opacity=".22" />
      <path d="M25 52 L34 54 M75 52 L66 54 M25 81 L34 78 M75 81 L66 78 M36 41 L41 48 M64 41 L59 48 M36 91 L41 84 M64 91 L59 84" stroke="#8a1f5c" strokeWidth="1.4" opacity=".55" />
      <rect x="43" y="31" width="14" height="10" rx="1.6" fill={`url(#${u}g)`} stroke={DI} strokeWidth="2.4" />
      <path d="M38 31 L42 13 H58 L62 31Z" fill={`url(#${u}s)`} stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M50 13 V31 M42 13 L46 31 M58 13 L54 31" stroke="#6a3ab0" strokeWidth="1.2" opacity=".5" />
      <path d="M31 56 V76" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
      <path d={twinkle(78, 26, 6)} fill="#fff" />
    </g>
  )
}

export function Champagne({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}w`} stops={[[0, '#fff6cf'], [0.5, '#ffd451'], [1, '#e8a21a']]} />
        <Lin id={`${u}gl`} stops={[[0, '#f4fbff'], [1, '#c4dcf0']]} />
      </defs>
      {shadow(20, 90)}
      <path d="M33 10 H67 C67 38 61 54 50 57 C39 54 33 38 33 10Z" fill={`url(#${u}gl)`} opacity=".65" />
      <path d="M34 20 H66 C65 40 59 53 50 56 C41 53 35 40 34 20Z" fill={`url(#${u}w)`} />
      <path d="M33 10 H67 C67 38 61 54 50 57 C39 54 33 38 33 10Z" fill="none" stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M34 20 H66" stroke="#fff8dc" strokeWidth="2" />
      <g fill="#fff" opacity=".85">
        <circle cx="45" cy="30" r="1.8" />
        <circle cx="54" cy="38" r="1.5" />
        <circle cx="48" cy="44" r="1.3" />
        <circle cx="57" cy="27" r="1.2" />
      </g>
      <path d="M48 57 H52 V82 H48Z" fill={`url(#${u}gl)`} stroke={DI} strokeWidth="2" strokeLinejoin="round" />
      <ellipse cx="50" cy="85" rx="17" ry="4.5" fill={`url(#${u}gl)`} stroke={DI} strokeWidth="2.6" />
      <path d="M39 16 C39 30 41 40 45 47" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".75" />
      <path d={twinkle(76, 14, 6)} fill="#fff" />
      <path d={twinkle(24, 30, 4)} fill="#fff6c8" />
    </g>
  )
}
