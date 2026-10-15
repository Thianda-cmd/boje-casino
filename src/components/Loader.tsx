import { useId } from 'react'
import { BOJE_B, BOJE_FACET_LEFT, BOJE_FACET_TOP, BOJE_HEX } from '../art/brand'

/*
  Boje brand pieces: the gem mark and the loaders built from it. The keyframes live in index.css
  (boje-*), and index.html carries a copy of the big loader in plain CSS so it shows before any script runs.
*/

const HEX = BOJE_HEX
const B = BOJE_B

const uid = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '')

/** The Boje mark: a cut gem with a B. */
export function BojeMark({ size = 32, className = '', shine = false }: { size?: number; className?: string; shine?: boolean }) {
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
        {shine && <polygon points="-4,-4 3,-4 -6,36 -13,36" fill="#fff" opacity=".5" className="animate-[boje-shine_2.4s_ease-in-out_infinite]" />}
      </g>
      <path d={B} fill="#04260f" fillRule="evenodd" transform="translate(0.3 0)" />
    </svg>
  )
}

/** Four-pointed glint. */
function Glint({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 10 10" className={`absolute ${className}`} style={style} aria-hidden>
      <path d="M5 0c.35 2.6 1.4 3.65 5 5-3.6 1.35-4.65 2.4-5 5-.35-2.6-1.4-3.65-5-5 3.6-1.35 4.65-2.4 5-5Z" fill="currentColor" />
    </svg>
  )
}

/** The big loader: the mark breathing inside a ring of light that runs round a hexagon, with glints and the name. */
export function BojeLoader({ label, progress, className = '' }: { label?: string; progress?: number; className?: string }) {
  const u = uid(useId())
  return (
    <div role="status" aria-label={label ?? 'Loading'} className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="relative h-[84px] w-[84px]">
        <svg viewBox="0 0 84 84" className="absolute inset-0" aria-hidden>
          <defs>
            <linearGradient id={`${u}r`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6dffb2" />
              <stop offset="1" stopColor="#25d9f0" />
            </linearGradient>
          </defs>
          <path d="M42 4 74.9 23v38L42 80 9.1 61V23Z" fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth="3" strokeLinejoin="round" />
          <path
            d="M42 4 74.9 23v38L42 80 9.1 61V23Z"
            pathLength={100}
            fill="none"
            stroke={`url(#${u}r)`}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="20 30"
            className="animate-[boje-chase_1.5s_linear_infinite] drop-shadow-[0_0_6px_rgba(52,255,150,.7)]"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <BojeMark size={46} shine className="animate-[boje-breathe_1.5s_ease-in-out_infinite] drop-shadow-[0_6px_14px_rgba(20,200,110,.45)]" />
        </div>
        <Glint className="-right-1 top-1 h-3.5 w-3.5 animate-[boje-twinkle_1.8s_ease-in-out_infinite] text-[#bfffe0]" />
        <Glint className="-left-1.5 top-9 h-2.5 w-2.5 animate-[boje-twinkle_1.8s_ease-in-out_.6s_infinite] text-[#9fefff]" />
        <Glint className="bottom-0 right-3 h-2 w-2 animate-[boje-twinkle_1.8s_ease-in-out_1.2s_infinite] text-[#ffe9a8]" />
      </div>
      <div className="flex text-[22px] font-extrabold leading-none tracking-[-0.03em]" aria-hidden>
        {'boje'.split('').map((ch, i) => (
          <span key={i} className="inline-block animate-[boje-wave_1.5s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.1}s` }}>
            {ch}
          </span>
        ))}
      </div>
      {label && <div className="text-[12px] font-semibold text-muted">{label}</div>}
      {progress != null && (
        <div className="h-1 w-36 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#1fd172,#25d9f0)] transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0.04, progress)) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

/** Small inline loader for buttons and panels. */
export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="status" aria-label="Loading">
      <path d={HEX} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3.2" strokeLinejoin="round" />
      <path
        d={HEX}
        pathLength={100}
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="28 72"
        className="animate-[boje-chase_1s_linear_infinite]"
      />
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
