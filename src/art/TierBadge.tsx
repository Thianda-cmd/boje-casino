import { useUid } from './ids'
import { shade } from '../lib/pixel'

/** VIP tier emblem: a faceted shield in the tier colour, with stars for the tier rank. */
export function TierBadge({ color, rank, size = 64, dim = false, className = '' }: { color: string; rank: number; size?: number; dim?: boolean; className?: string }) {
  const id = useUid()
  const light = shade(color, 0.35)
  const dark = shade(color, -0.45)
  const stars = Math.min(rank + 1, 5)
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 100 112" className={className} style={dim ? { filter: 'grayscale(1)', opacity: 0.35 } : undefined} aria-hidden>
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset=".55" stopColor={color} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M50 4 92 20v34c0 26-18 44-42 54C26 98 8 80 8 54V20Z" fill={dark} />
      <path d="M50 9 87 23v31c0 23-16 39-37 48C29 93 13 77 13 54V23Z" fill={`url(#${id}f)`} />
      <path d="M50 9 87 23v31c0 4-.5 8-1.5 11.5L50 50 14.5 65.5C13.5 62 13 58 13 54V23Z" fill={`url(#${id}r)`} opacity=".5" />
      <path d="M50 9v93" stroke="#fff" strokeOpacity=".12" strokeWidth="1.5" />
      <path d="M50 27 61 49 50 76 39 49Z" fill="#fff" fillOpacity=".92" />
      <path d="M50 27 61 49H39Z" fill="#fff" />
      <path d="M50 49h11L50 76Z" fill={dark} fillOpacity=".35" />
      {Array.from({ length: stars }, (_, i) => {
        const x = 50 + (i - (stars - 1) / 2) * 11
        return <path key={i} transform={`translate(${x} 88) scale(.32)`} d="M0-12 3.5-4 12-3.6 5.4 2 7.6 10.4 0 5.8-7.6 10.4-5.4 2-12-3.6-3.5-4Z" fill="#fff" fillOpacity=".9" />
      })}
    </svg>
  )
}
