import { useUid } from './ids'

/* Casino chips: a coloured disc with edge inserts, a dashed inlay ring and the value in the middle. */

const CHIP_COLORS: [number, string, string][] = [
  // [min value, body, edge inserts]
  [5000, '#ff5fa2', '#ffe3f0'],
  [1000, '#f59e0b', '#fff3d6'],
  [500, '#7c4dff', '#e9e1ff'],
  [100, '#26313f', '#f7c548'],
  [25, '#1fb866', '#e6fff1'],
  [10, '#2f7cf6', '#e3eeff'],
  [5, '#e8344e', '#ffe5e9'],
  [0, '#dfe6ee', '#3a4f63'],
]

export const chipColor = (v: number) => CHIP_COLORS.find(([min]) => v >= min)![1]
export const chipLabel = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : v >= 1 ? `${+v.toFixed(v % 1 ? 1 : 0)}` : v.toFixed(2))

export function Chip({ value, size = 40, label, className, x, y }: { value: number; size?: number; label?: string; className?: string; x?: number; y?: number }) {
  const u = useUid()
  const [, body, inset] = CHIP_COLORS.find(([min]) => value >= min)!
  const light = body === '#dfe6ee'
  const text = label ?? chipLabel(value)
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <radialGradient id={`${u}s`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="34.5" r="29" fill="rgba(0,0,0,.35)" />
      <circle cx="32" cy="32" r="29" fill={body} />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x="28" y="3" width="8" height="9" rx="1.5" fill={inset} transform={`rotate(${i * 60} 32 32)`} />
      ))}
      <circle cx="32" cy="32" r="20.5" fill={body} stroke="rgba(0,0,0,.18)" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="17.5" fill="none" stroke={inset} strokeOpacity=".7" strokeWidth="1.4" strokeDasharray="3.2 2.6" />
      <circle cx="32" cy="32" r="29" fill={`url(#${u}s)`} />
      <text
        x="32"
        y="32"
        dy=".36em"
        textAnchor="middle"
        fontFamily="Manrope, ui-sans-serif, system-ui, sans-serif"
        fontWeight="800"
        fontSize={text.length >= 4 ? 13 : text.length === 3 ? 15 : 18}
        fill={light ? '#22303e' : '#fff'}
      >
        {text}
      </text>
    </svg>
  )
}
