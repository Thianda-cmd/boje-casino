import { useUid } from './ids'

/* A faceted gem (Mines, Keno, covers). Facets are flat shades of one hue, lit from the top left. */

const PALETTES = {
  green: ['#d9ffe9', '#8ff5bd', '#4fe394', '#2cc977', '#1ea862', '#128249', '#0a5e33'],
  violet: ['#f1e9ff', '#cdb6ff', '#a888ff', '#8c64ff', '#7448f0', '#5730c4', '#3c1f8f'],
  sky: ['#eafdff', '#a8f1ff', '#6fe0ff', '#3cc4f5', '#1fa0e0', '#1676b8', '#0d4f82'],
  gold: ['#fff7d6', '#ffe48a', '#ffd04d', '#f7b52b', '#e09a14', '#b4750a', '#7d4f05'],
  pink: ['#ffe6f0', '#ffb3d1', '#ff7aad', '#ff4f8f', '#e8336f', '#b81f52', '#7e1035'],
}

export function Gem({ size = 48, tone = 'green', glow = true, className, x, y }: { size?: number; tone?: keyof typeof PALETTES; glow?: boolean; className?: string; x?: number; y?: number }) {
  const u = useUid()
  const c = PALETTES[tone]
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 64 64" className={className} overflow="visible" aria-hidden>
      <defs>
        <filter id={`${u}f`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>
      {glow && <path d="M18 11h28l12 14-26 32L6 25Z" fill={c[3]} opacity=".55" filter={`url(#${u}f)`} />}
      {/* crown */}
      <path d="M18 11h8l-5 14H6Z" fill={c[2]} />
      <path d="M26 11h12l5 14H21Z" fill={c[1]} />
      <path d="M38 11h8l12 14H43Z" fill={c[3]} />
      {/* pavilion */}
      <path d="M6 25h15l11 32Z" fill={c[3]} />
      <path d="M21 25h11v32Z" fill={c[2]} />
      <path d="M32 25h11L32 57Z" fill={c[4]} />
      <path d="M43 25h15L32 57Z" fill={c[5]} />
      {/* girdle line and highlights */}
      <path d="M6 25h52" stroke={c[0]} strokeOpacity=".55" strokeWidth="1" />
      <path d="M27.5 13.5h9l2.2 6.5h-13.4Z" fill={c[0]} opacity=".7" />
      <path d="M10 25.5h7l7.5 19Z" fill={c[0]} opacity=".28" />
      <path d="M18 11h28l12 14-26 32L6 25Z" fill="none" stroke={c[6]} strokeOpacity=".55" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
