import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { navigate } from '../../lib/router'
import { IconUser } from '../icons'
import { keptProfile, loadProfile, profilePath, type ProfileAnswer } from './data'
import { ProfileCard, ProfileCardSkeleton } from './ProfileCard'

/*
  A player's name wherever other players are listed (the live games' player lists, the leaderboards). A guest's name
  is plain text. A signed-in player's (`acct`) is a button: with a mouse, resting on it opens their card (framed
  avatar, name, title, level and tier, online, a few numbers, View profile) and a click goes to their profile; on a
  touch screen a tap opens the card and its View profile button goes there. The card is fetched once per visit and
  kept (src/components/profile/data.ts), so moving between names is instant the second time.

  The card is drawn in a portal at the top of the page, placed under the name (or over it when there is no room
  below, counting the phone's bottom bar) and kept inside the screen, so it is never clipped by a scrolling list.
*/

const CARD_W = 304
const OPEN_MS = 320
const CLOSE_MS = 160
/** the screen's usable bottom: above the bottom bar on phones and tablets (App.tsx MobileNav, hidden from lg up) */
const floorOf = () => (window.innerWidth < 1024 ? window.innerHeight - 72 : window.innerHeight)

export function PlayerName({ name, acct, className = '', children }: { name: string; acct?: boolean; className?: string; children?: ReactNode }) {
  if (!acct) return <span className={className}>{children ?? name}</span>
  return (
    <ProfileHover name={name} className={className}>
      {children ?? name}
    </ProfileHover>
  )
}

type Place = { left: number; top?: number; bottom?: number; width: number; up: boolean }

function placeFor(el: HTMLElement): Place {
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const floor = floorOf()
  const width = Math.min(CARD_W, vw - 16)
  const left = Math.max(8, Math.min(vw - width - 8, r.left + r.width / 2 - width / 2))
  const room = 350
  const up = floor - r.bottom < room && r.top > floor - r.bottom
  return up ? { left, bottom: vh - r.top + 8, width, up } : { left, top: r.bottom + 8, width, up }
}

function ProfileHover({ name, className, children }: { name: string; className: string; children: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<null | 'hover' | 'tap'>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [got, setGot] = useState<ProfileAnswer | undefined>(() => keptProfile(name))
  const timer = useRef(0)
  const touch = useRef(false)

  const fetchCard = useCallback(() => {
    loadProfile(name).then(setGot)
  }, [name])
  const show = useCallback(
    (how: 'hover' | 'tap') => {
      if (!trigger.current) return
      setPlace(placeFor(trigger.current))
      setOpen(how)
      fetchCard()
    },
    [fetchCard],
  )
  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setOpen(null)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  // a tapped card closes on a tap elsewhere, on scrolling and on Escape; either kind closes when the page changes size
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!card.current?.contains(t) && !trigger.current?.contains(t)) hide()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    const onScroll = (e: Event) => {
      if (card.current?.contains(e.target as Node)) return
      hide()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  // a card that grows taller than the room left below it flips above
  useLayoutEffect(() => {
    if (!open || !place || place.up || !card.current || !trigger.current) return
    const h = card.current.offsetHeight
    const r = trigger.current.getBoundingClientRect()
    if (r.bottom + 8 + h > floorOf() - 8 && r.top - 8 - h > 8) setPlace({ ...place, top: undefined, bottom: window.innerHeight - r.top + 8, up: true })
  }, [open, place, got])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onPointerDown={(e) => {
          touch.current = e.pointerType !== 'mouse'
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return
          fetchCard()
          later(() => show('hover'), open ? 0 : OPEN_MS)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse' && open !== 'tap') later(hide, CLOSE_MS)
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (touch.current) {
            if (open) hide()
            else show('tap')
            return
          }
          hide()
          navigate(profilePath(name))
        }}
        className={`cursor-pointer text-left decoration-from-font underline-offset-2 hover:underline ${className}`}
      >
        {children}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && place && (
            <motion.div
              ref={card}
              data-profile-card={name}
              role="dialog"
              aria-label={`${name}'s profile card`}
              initial={{ opacity: 0, y: place.up ? 8 : -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: place.up ? 6 : -6, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              onPointerEnter={(e) => e.pointerType === 'mouse' && clearTimeout(timer.current)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && open === 'hover' && later(hide, CLOSE_MS)}
              onClick={(e) => e.stopPropagation()}
              className={`fixed z-[70] rounded-2xl ${place.up ? 'shadow-[0_-10px_50px_-12px_rgba(0,0,0,.85)]' : 'shadow-[0_30px_70px_-18px_rgba(0,0,0,.9)]'}`}
              style={{ left: place.left, top: place.top, bottom: place.bottom, width: place.width, transformOrigin: place.up ? 'bottom center' : 'top center' }}
            >
              {got === undefined ? (
                <ProfileCardSkeleton name={name} />
              ) : got === null || got === 'offline' ? (
                <div className="rounded-2xl bg-panel p-4 ring-1 ring-white/[.07]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
                      <IconUser size={20} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-extrabold">{name}</div>
                      <div className="text-[12px] text-muted">{got === null ? 'This profile is hidden or gone.' : "Profiles can't be reached right now."}</div>
                    </div>
                  </div>
                  {got === 'offline' && (
                    <button type="button" onClick={() => (setGot(undefined), loadProfile(name, true).then(setGot))} className="mt-3 h-9 w-full rounded-lg bg-raised text-[13px] font-bold transition hover:bg-hover">
                      Try again
                    </button>
                  )}
                </div>
              ) : (
                <ProfileCard p={got} onOpen={hide} />
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
