import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal } from '../Modal'
import { Coin } from '../icons'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { currentLimits, lossToday, useWallet } from '../../store/wallet'
import { openAccount } from '../../pages/account/tab'

/*
  The responsible-play session reminder (store/wallet.ts Limits.reminderMin). Mounted once for the whole app: every
  so many minutes of session time it says how long the session has run and how today has gone, with Keep playing and
  Take a break (which opens the account's Responsible play tab).

  Session time is time this tab has been visible: the clock stops while the tab is hidden and goes on when it comes
  back, and it is kept for the tab (sessionStorage), so a reload carries on the same session. Changing the reminder
  counts from the session so far: at 45 minutes in, a 30-minute reminder next speaks at the hour. The Responsible
  play tab shows the same clock (useSessionMs). In dev builds, window.__session.add(ms) moves the clock on, for tests.
*/

const KEY = 'boje.session.v1'
let acc = 0
let since: number | null = null
let started = false

function fold() {
  if (since === null) return
  const t = performance.now()
  acc += t - since
  since = document.visibilityState === 'visible' ? t : null
}
function persist() {
  fold()
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ms: Math.round(acc) }))
  } catch {
    /* private mode: the clock lives as long as the page */
  }
}
function start() {
  if (started || typeof document === 'undefined') return
  started = true
  try {
    acc = Math.max(0, Number(JSON.parse(sessionStorage.getItem(KEY) ?? '{}').ms) || 0)
  } catch {
    acc = 0
  }
  if (document.visibilityState === 'visible') since = performance.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') since ??= performance.now()
    else persist()
  })
  window.addEventListener('pagehide', persist)
  setInterval(persist, 10_000)
}

/** this tab's session time so far (ms) */
export function sessionMs() {
  start()
  return acc + (since !== null ? performance.now() - since : 0)
}

/** the session time, refreshed every few seconds */
export function useSessionMs(every = 5000) {
  const [ms, setMs] = useState(sessionMs)
  useEffect(() => {
    const t = setInterval(() => setMs(sessionMs()), every)
    return () => clearInterval(t)
  }, [every])
  return ms
}

if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __session?: unknown }).__session = {
    add: (ms: number) => {
      start()
      acc += ms
    },
    ms: sessionMs,
  }

/** "45 minutes", "1 hour", "2 hours 15 minutes" */
export function spoken(ms: number) {
  const m = Math.floor(ms / 60_000)
  const h = Math.floor(m / 60)
  const r = m % 60
  const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`
  if (!h) return mins(Math.max(1, m))
  return `${h} hour${h === 1 ? '' : 's'}${r ? ` ${mins(r)}` : ''}`
}

/** a little clock face whose hand sweeps once as the reminder opens */
function ClockArt() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
      <defs>
        <linearGradient id="rmd-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b475c" />
          <stop offset="1" stopColor="#112230" />
        </linearGradient>
        <linearGradient id="rmd-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ef0b0" />
          <stop offset="1" stopColor="#14a957" />
        </linearGradient>
      </defs>
      <circle cx="42" cy="42" r="38" fill="url(#rmd-rim)" />
      <circle cx="42" cy="42" r="33" fill="url(#rmd-face)" />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d="M42 13v4.5" stroke={i % 3 ? '#5d7488' : '#eef4f9'} strokeWidth={i % 3 ? 1.6 : 2.6} strokeLinecap="round" transform={`rotate(${i * 30} 42 42)`} />
      ))}
      <path d="M42 42V26" stroke="#eef4f9" strokeWidth="3.2" strokeLinecap="round" transform="rotate(-60 42 42)" />
      <motion.path d="M42 42V18" stroke="#22d36f" strokeWidth="2.4" strokeLinecap="round" style={{ originX: 0.5, originY: 1 }} initial={{ rotate: -90 }} animate={{ rotate: 270 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
      <circle cx="42" cy="42" r="3.6" fill="#22d36f" stroke="#0a1620" strokeWidth="1.4" />
    </svg>
  )
}

export function SessionReminder() {
  const minutes = useWallet((s) => currentLimits(s.limits).reminderMin)
  const loss = useWallet((s) => lossToday(s))
  const balance = useWallet((s) => s.balance)
  const [open, setOpen] = useState<number | null>(null)
  const next = useRef(0)
  useEffect(() => {
    if (!minutes) return
    const period = minutes * 60_000
    next.current = (Math.floor(sessionMs() / period) + 1) * period
    const t = setInterval(() => {
      const ms = sessionMs()
      if (ms < next.current) return
      next.current = (Math.floor(ms / period) + 1) * period
      setOpen(ms)
      sfx.click()
    }, 1000)
    return () => clearInterval(t)
  }, [minutes])
  const net = -loss
  return (
    <AnimatePresence>
      {open !== null && (
        <Modal onClose={() => setOpen(null)} title="Time check" width={400}>
          <div className="flex flex-col items-center pb-1 text-center" data-session-reminder>
            <ClockArt />
            <div className="mt-3 text-[12px] font-extrabold uppercase tracking-[.1em] text-dim">This session</div>
            <div className="mt-1 text-[28px] font-black leading-tight tracking-tight">{spoken(open)}</div>
            <div className="mt-4 grid w-full grid-cols-2 gap-2">
              <div className="rounded-xl bg-stage px-3 py-2.5">
                <div className="text-[11.5px] font-bold text-dim">Today's result</div>
                <div className={`tnum mt-0.5 flex items-center justify-center gap-1 text-[18px] font-black ${net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : ''}`}>
                  {net > 0 ? '+' : net < 0 ? '−' : ''}
                  {fmt(Math.abs(net))} <Coin size={15} />
                </div>
              </div>
              <div className="rounded-xl bg-stage px-3 py-2.5">
                <div className="text-[11.5px] font-bold text-dim">Balance</div>
                <div className="tnum mt-0.5 flex items-center justify-center gap-1 text-[18px] font-black">
                  {fmt(balance)} <Coin size={15} />
                </div>
              </div>
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-muted">You asked to be told every {spoken((minutes ?? 0) * 60_000)}. Stretch, look away from the screen, and come back if you still feel like it.</p>
            <div className="mt-5 grid w-full grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setOpen(null)
                  openAccount('limits')
                }}
                className="h-12 rounded-xl bg-raised text-[14px] font-bold text-ink transition hover:bg-hover"
              >
                Take a break
              </button>
              <button onClick={() => setOpen(null)} className="h-12 rounded-xl bg-accent text-[14px] font-extrabold text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-110">
                Keep playing
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AnimatePresence>
  )
}
