import { useId } from 'react'
import type { SVGProps } from 'react'
import { BojeMark } from './Loader'

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = ({ size = 20, ...p }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
})

export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
  </svg>
)
export const IconGift = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13M5 12v9h14v-9" />
    <path d="M12 8S10.5 3 7.5 4.5 9 8 12 8Zm0 0s1.5-5 4.5-3.5S15 8 12 8Z" />
  </svg>
)
export const IconHistory = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
)
export const IconVolume = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
)
export const IconMute = (p: P) => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="m22 9-6 6M16 9l6 6" />
  </svg>
)
export const IconMenu = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)
export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
export const IconBolt = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </svg>
)
export const IconTrophy = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />
  </svg>
)
export const IconShuffle = (p: P) => (
  <svg {...base(p)}>
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)
export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
export const IconGrid = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
)
export const IconStar = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
  </svg>
)
export const IconCards = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="11" height="15" rx="2" />
    <path d="M8 3h9a2 2 0 0 1 2 2v12" />
  </svg>
)
export const IconUsers = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c2 .7 3.2 2.5 3.5 5.3" />
  </svg>
)
export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5" />
  </svg>
)
export const IconLogout = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
    <path d="M15 8l4 4-4 4M19 12H9" />
  </svg>
)
export const IconVault = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3.5" width="18" height="16" rx="2.5" />
    <circle cx="12" cy="11.5" r="4" />
    <path d="M12 7.5v1.5M16 11.5h-1.5M12 15.5V14M8 11.5h1.5M6 19.5v1.5M18 19.5v1.5" />
  </svg>
)
export const IconFire = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21c-4 0-7-2.8-7-6.6 0-4.2 3.6-6 4.4-10.4 2.7 1.8 4.3 4.1 4.6 6.6 1-.6 1.7-1.6 2-2.9 1.9 1.8 3 4 3 6.7 0 3.8-3 6.6-7 6.6Z" />
  </svg>
)
export const IconChart = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)

export function Coin({ size = 18, className = '' }: { size?: number; className?: string }) {
  const u = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={u} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="0.55" stopColor="#f7c548" />
          <stop offset="1" stopColor="#d99a1e" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill={`url(#${u})`} />
      <circle cx="16" cy="16" r="11" fill="none" stroke="#b97c12" strokeWidth="1.6" opacity="0.65" />
      <path d="M16 9.5l1.9 4 4.4.5-3.3 3 .9 4.3L16 19.1l-3.9 2.2.9-4.3-3.3-3 4.4-.5 1.9-4Z" fill="#b97c12" opacity="0.8" />
    </svg>
  )
}

export function Logo({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <BojeMark size={32} />
      {!compact && (
        <span className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-extrabold leading-none tracking-[-0.045em]">boje</span>
          <span className="text-[10px] font-extrabold uppercase leading-none tracking-[0.24em] text-accent">casino</span>
        </span>
      )}
    </div>
  )
}
