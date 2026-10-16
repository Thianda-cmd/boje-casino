import { useId, useState } from 'react'
import { BOJE_B, BOJE_FACET_LEFT, BOJE_FACET_TOP, BOJE_HEX, bojeFacets } from '../art/brand'
import { booting } from '../lib/boot'

/*
  Boje brand pieces: the gem mark and the loaders built from it. The loaders are one quiet idea: the gem is cut
  into six facets and a soft light travels round them, as if the stone were turning under a lamp. The keyframes
  live in index.css (boje-*), and index.html carries a plain copy of the big loader for before any script runs.
*/

const HEX = BOJE_HEX
const B = BOJE_B

const uid = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')

/** The Boje mark: a cut gem with a B. */
export function BojeMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const u = uid(useId())
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${u}g`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#6dffb2" />
          <stop offset="0.5" stopColor="#1fd172" />
          <stop offset="1" stopColor="#0b8a47" />
        </linearGradient>
        <clipPath id={`${u}c`}>
          <path d={HEX} />
        </clipPath>
      </defs>
      <path d={HEX} fill={`url(#${u}g)`} stroke={`url(#${u}g)`} strokeWidth="2.6" strokeLinejoin="round" />
      <g clipPath={`url(#${u}c)`}>
        <path d={BOJE_FACET_TOP} fill="#fff" opacity=".2" />
        <path d={BOJE_FACET_LEFT} fill="#000" opacity=".08" />
      </g>
      <path d={B} fill="#04260f" fillRule="evenodd" transform="translate(0.3 0)" />
    </svg>
  )
}

const FACETS = bojeFacets(0.07)
const SPIN_FACETS = bojeFacets(0.16)
/** one turn of the light round the gem, ms (index.css boje-facet and index.html use the same) */
const TURN = 2400
/** the gem lit from the top left: how much each facet is lifted, clockwise from the top right */
const SHADE = [0.2, 0.06, 0, 0, 0.05, 0.16]

/** The big loader: the faceted gem with light travelling round it, an optional label and a progress line. */
export function BojeLoader({ label, progress, className = '' }: { label?: string; progress?: number; className?: string }) {
  const u = uid(useId())
  // every loader shares one clock (the page's), so when the boot screen hands over to a page or game loader the
  // light carries on from where it was instead of starting again
  const [at] = useState(() => performance.now() % TURN)
  // while the boot screen is still fading out, wait for it rather than showing a second gem beside it
  const [late] = useState(booting)
  return (
    <div role="status" aria-label={label ?? 'Loading'} className={`flex flex-col items-center gap-4 ${late ? 'animate-[boje-in_.4s_ease-out_.5s_both]' : 'animate-[boje-in_.4s_ease-out_.15s_both]'} ${className}`}>
      <svg width={60} height={60} viewBox="0 0 32 32" aria-hidden className="drop-shadow-[0_10px_22px_rgba(8,110,62,.32)]">
        <defs>
          <linearGradient id={`${u}g`} gradientUnits="userSpaceOnUse" x1="7" y1="3" x2="25" y2="29">
            <stop offset="0" stopColor="#5ff5a6" />
            <stop offset="0.55" stopColor="#1fd172" />
            <stop offset="1" stopColor="#0c8d49" />
          </linearGradient>
        </defs>
        {FACETS.map((d, i) => (
          <path key={i} d={d} fill={`url(#${u}g)`} />
        ))}
        {FACETS.map((d, i) => (SHADE[i] ? <path key={`s${i}`} d={d} fill="#fff" opacity={SHADE[i]} /> : null))}
        {FACETS.map((d, i) => (
          <path
            key={`l${i}`}
            d={d}
            fill="#fff"
            fillOpacity=".38"
            opacity="0"
            className="animate-[boje-facet_2.4s_ease-in-out_infinite] motion-reduce:hidden"
            style={{ animationDelay: `${((i * TURN) / 6 - at) % TURN - TURN}ms` }}
          />
        ))}
        <path d={B} fill="#04260f" fillRule="evenodd" transform="translate(0.3 0)" />
      </svg>
      {label && <div className="text-[13px] font-semibold text-muted">{label}</div>}
      {progress != null && (
        <div className="h-[3px] w-32 overflow-hidden rounded-full bg-white/[.08]">
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-700 ease-[cubic-bezier(.22,.61,.36,1)]"
            style={{ transform: `scaleX(${Math.min(1, Math.max(0.04, progress))})` }}
          />
        </div>
      )}
    </div>
  )
}

/** Small inline loader for buttons and panels: the same facets, a bright wedge turning round the gem. */
export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="status" aria-label="Loading">
      {SPIN_FACETS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" opacity=".22" className="animate-[boje-spin_1.2s_linear_infinite]" style={{ animationDelay: `${i * 200 - 1200}ms` }} />
      ))}
    </svg>
  )
}

/** Full-area fallback while a page or game loads. */
export function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <BojeLoader />
    </div>
  )
}
