import { motion } from 'framer-motion'
import { useUid } from '../../art/ids'

/*
  A briefcase, seen from the front: brushed aluminium with gold corners, two gold latches, a leather handle and the
  case's number on a gold-rimmed plate. The player's own case is gold all over, with a dark plate.

  It opens like the show's: the latches snap, the front (the lid, hinged along its top edge) swings up and away in
  3D, showing the crimson velvet inside and the prize card, which rises out and settles back into the case. An opened
  case stays open with its card showing; a case already open when the page comes up (a resumed game) is drawn open
  with no animation. The card is blue for the board's low half, gold for its high half, and the top prize's card
  sparkles.

  Sizes are in px from the case's width w (its height is w / ASPECT, handle included); everything inside scales.
*/

/** a band of light sweeping across a gold or diamond face, over and over */
export function Sheen({ period = 2.2, className = 'rounded-[inherit]' }: { period?: number; className?: string }) {
  return (
    <motion.span
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ backgroundImage: 'linear-gradient(105deg,transparent 35%,rgba(255,255,255,.7) 48%,transparent 60%)', backgroundSize: '260% 100%', backgroundRepeat: 'no-repeat' }}
      animate={{ backgroundPositionX: ['130%', '-30%'] }}
      transition={{ duration: period, repeat: Infinity, ease: 'linear', repeatDelay: period * 0.4 }}
    />
  )
}

export const ASPECT = 1.2
/** the handle's share of the case's height: the lid is the rest */
const HANDLE = 0.15

export type CaseLook = 'closed' | 'open'

export function Briefcase({
  w,
  n,
  look,
  mine = false,
  prize,
  tone = 'low',
  top = false,
  live = false,
  dim = false,
}: {
  w: number
  /** the number on the plate (1-16) */
  n: number
  look: CaseLook
  mine?: boolean
  /** the card's text, once open */
  prize?: string
  tone?: 'low' | 'high'
  /** the board's top prize: the card sparkles */
  top?: boolean
  /** it is being opened now (the card rises out) */
  live?: boolean
  dim?: boolean
}) {
  const u = useUid() + 'bc'
  const h = w / ASPECT
  const open = look === 'open'
  const bodyH = h * (1 - HANDLE)
  return (
    <div className="relative transition-opacity duration-500" style={{ width: w, height: h, perspective: w * 5, opacity: dim && !open ? 0.5 : 1 }}>
      {/* the handle (it goes with the lid) */}
      <motion.svg className="absolute left-0 top-0" width={w} height={h * HANDLE + 2} viewBox="0 0 120 17" preserveAspectRatio="none" initial={false} animate={{ opacity: open ? 0 : 1, y: open ? -4 : 0 }} transition={{ duration: 0.25 }}>
        <defs>
          <linearGradient id={`${u}lea`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={mine ? '#6b3c12' : '#4a3426'} />
            <stop offset="1" stopColor={mine ? '#2e1606' : '#1b120c'} />
          </linearGradient>
        </defs>
        <path d="M40 17 V8 C40 3.5 43 1.5 48 1.5 H72 C77 1.5 80 3.5 80 8 V17 H73.5 V9.5 C73.5 8 72.6 7.4 71 7.4 H49 C47.4 7.4 46.5 8 46.5 9.5 V17Z" fill={`url(#${u}lea)`} stroke="#0b1220" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M44 6.5 C45 4 47 3.6 49 3.6 H71" stroke="#fff" strokeOpacity=".22" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <rect x="37" y="12" width="9" height="5.5" rx="1.5" fill="#f2c14e" stroke="#0b1220" strokeWidth="1.2" />
        <rect x="74" y="12" width="9" height="5.5" rx="1.5" fill="#f2c14e" stroke="#0b1220" strokeWidth="1.2" />
      </motion.svg>

      {/* the inside: velvet, the case's rim, the prize card */}
      <div className="absolute inset-x-0 bottom-0 overflow-visible" style={{ top: h * HANDLE }}>
        <div className="absolute inset-0 rounded-[9%/12%] border-2 border-[#0b1220]" style={{ background: mine ? 'linear-gradient(180deg,#e9b64c,#9c6a12)' : 'linear-gradient(180deg,#d9e1e8,#7f8c99)' }}>
          <div className="absolute inset-[5%] rounded-[7%/10%] shadow-[inset_0_4px_10px_rgba(0,0,0,.65)]" style={{ background: 'radial-gradient(ellipse 90% 80% at 50% 30%, #8c2643 0%, #4f1023 60%, #2a0612 100%)' }} />
          {dim && <div className="absolute inset-0 rounded-[inherit] bg-[#060a12]/35" />}
        </div>
        {prize != null && open && (
          <motion.div
            className="absolute left-1/2 flex items-center justify-center rounded-[12%/18%] border-2 border-[#0b1220] font-black leading-none"
            style={{
              width: w * 0.78,
              height: bodyH * 0.5,
              x: '-50%',
              top: bodyH * 0.25,
              fontSize: Math.max(10, w * (prize.length > 5 ? 0.15 : 0.19)),
              background: top ? 'linear-gradient(135deg,#fffbe0 0%,#ffd75e 30%,#ff9be8 60%,#9ad8ff 100%)' : tone === 'high' ? 'linear-gradient(180deg,#fff6cf 0%,#ffd45c 50%,#e39b14 100%)' : 'linear-gradient(180deg,#bfe4ff 0%,#4ea8ff 50%,#1d62d0 100%)',
              color: tone === 'high' || top ? '#2a1600' : '#fff',
              textShadow: tone === 'high' || top ? '0 1px 0 rgba(255,255,255,.5)' : '0 1px 0 rgba(0,0,0,.35)',
              boxShadow: live ? `0 0 ${w * 0.25}px ${tone === 'high' || top ? 'rgba(255,205,80,.85)' : 'rgba(90,170,255,.8)'}` : '0 3px 0 rgba(0,0,0,.35)',
            }}
            initial={live ? { y: bodyH * 0.25, scale: 0.85, opacity: 0 } : false}
            animate={live ? { y: [bodyH * 0.25, -bodyH * 0.42, -bodyH * 0.06], scale: [0.85, 1.12, 1], opacity: [0, 1, 1] } : { y: -bodyH * 0.06, scale: 1, opacity: dim ? 0.88 : 1 }}
            transition={live ? { duration: 0.9, times: [0, 0.45, 1], ease: 'easeOut', delay: 0.14 } : { duration: 0.3 }}
          >
            <span className="tnum relative whitespace-nowrap tracking-tight">{prize}</span>
            {top && <Sheen />}
          </motion.div>
        )}
      </div>

      {/* the lid: the case's front, hinged along its top edge */}
      <motion.div
        className="absolute inset-x-0 bottom-0"
        style={{ top: h * HANDLE, transformOrigin: '50% 0%', transformStyle: 'preserve-3d' }}
        initial={false}
        animate={{ rotateX: open ? -112 : 0 }}
        transition={open ? { type: 'spring', stiffness: 170, damping: 15, delay: live ? 0.08 : 0 } : { duration: 0.3 }}
      >
        <svg className="absolute inset-0 h-full w-full [backface-visibility:hidden]" viewBox="0 0 120 85" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={`${u}al`} x1="0" y1="0" x2="0" y2="1">
              {mine ? (
                <>
                  <stop offset="0" stopColor="#fff2b8" />
                  <stop offset=".35" stopColor="#f2c14e" />
                  <stop offset=".7" stopColor="#c48a18" />
                  <stop offset="1" stopColor="#e7b444" />
                </>
              ) : (
                <>
                  <stop offset="0" stopColor="#f4f8fb" />
                  <stop offset=".35" stopColor="#c6d0d9" />
                  <stop offset=".72" stopColor="#8794a1" />
                  <stop offset="1" stopColor="#b8c3cd" />
                </>
              )}
            </linearGradient>
            <linearGradient id={`${u}gd`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff3b8" />
              <stop offset=".5" stopColor="#f2c14e" />
              <stop offset="1" stopColor="#b07a10" />
            </linearGradient>
            <linearGradient id={`${u}sh`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".45" stopColor="#fff" stopOpacity="0" />
              <stop offset=".5" stopColor="#fff" stopOpacity=".35" />
              <stop offset=".58" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="1.2" y="1.2" width="117.6" height="82.6" rx="9" fill={`url(#${u}al)`} stroke="#0b1220" strokeWidth="2.2" />
          {/* brushed ridges */}
          <path d="M6 15 H114 M6 70 H114" stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
          <path d="M6 16.4 H114 M6 71.4 H114" stroke="#0b1220" strokeOpacity=".22" strokeWidth="1" />
          <rect x="1.2" y="1.2" width="117.6" height="82.6" rx="9" fill={`url(#${u}sh)`} />
          {/* gold corners */}
          {[
            'M1.2 18 V10 C1.2 5 5 1.2 10 1.2 H18 V6 H11 C8 6 6 8 6 11 V18Z',
            'M118.8 18 V10 C118.8 5 115 1.2 110 1.2 H102 V6 H109 C112 6 114 8 114 11 V18Z',
            'M1.2 67 V75 C1.2 80 5 83.8 10 83.8 H18 V79 H11 C8 79 6 77 6 74 V67Z',
            'M118.8 67 V75 C118.8 80 115 83.8 110 83.8 H102 V79 H109 C112 79 114 77 114 74 V67Z',
          ].map((d, i) => (
            <path key={i} d={d} fill={mine ? '#7a4c08' : `url(#${u}gd)`} stroke="#0b1220" strokeWidth="1.3" strokeLinejoin="round" />
          ))}
          {/* the latches */}
          {[20, 86].map((x) => (
            <g key={x}>
              <rect x={x} y="1.5" width="14" height="10" rx="2.2" fill={mine ? '#7a4c08' : `url(#${u}gd)`} stroke="#0b1220" strokeWidth="1.3" />
              <rect x={x + 3.5} y="4.5" width="7" height="3" rx="1.2" fill="#0b1220" opacity=".55" />
            </g>
          ))}
          {/* the number plate */}
          <rect x="33" y="24" width="54" height="37" rx="8" fill={mine ? '#2a1a04' : `url(#${u}gd)`} stroke="#0b1220" strokeWidth="1.8" />
          <rect x="37" y="27.5" width="46" height="30" rx="5.5" fill={mine ? '#120b02' : '#fffaf0'} />
          <text x="60" y="43.5" textAnchor="middle" dominantBaseline="central" fontSize={n > 9 ? 25 : 28} fontWeight="900" fill={mine ? '#ffd45c' : '#16202c'} fontFamily="Manrope, system-ui, sans-serif" letterSpacing="-1">
            {n}
          </text>
        </svg>
        {/* the inside of the lid, seen once it swings past upright */}
        <div className="absolute inset-0 rounded-[9%/12%] border-2 border-[#0b1220] [backface-visibility:hidden] [transform:rotateX(180deg)]" style={{ background: mine ? 'linear-gradient(0deg,#e9b64c,#9c6a12)' : 'linear-gradient(0deg,#e3e9ee,#8a96a2)' }}>
          <div className="absolute inset-[9%] rounded-[7%/10%]" style={{ background: 'linear-gradient(0deg,#9a2c48,#4f1023)' }} />
        </div>
      </motion.div>

    </div>
  )
}
