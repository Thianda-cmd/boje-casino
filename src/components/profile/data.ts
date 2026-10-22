import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsPresent } from 'framer-motion'
import { fetchProfile, leaderboard, searchPlayers, type Board, type PlayerRow, type PublicProfile } from '../../lib/profiles'
import { cleanLook, type Look } from '../../store/cosmetics'
import { useWallet } from '../../store/wallet'
import { fmtAgo } from '../../lib/format'

/*
  Other players, as the community pages read them: profiles and leaderboards fetched once and kept for the visit, so
  a hover card, a leaderboard and a profile page opened one after the other only ask the server once. A profile is
  kept for a few minutes (a page that opens it shows the kept copy at once and quietly asks again); an 'offline'
  answer is never kept, so the next look tries again. Boards are kept for a minute.

  The hooks hold still while their page is leaving (App.tsx fades pages out with AnimatePresence): an answer that
  lands during the fade is dropped, because new motion elements mounted inside a leaving page would keep it from ever
  finishing its exit.

  Also here: the look the signed-in player wears (for the top bar and the account menu), a profile's link, and how
  "online" and "last seen" read.
*/

export type ProfileAnswer = PublicProfile | null | 'offline'
type Entry<T> = { at: number; p: Promise<T>; v?: T }

const PROFILE_FRESH = 3 * 60_000
const BOARD_FRESH = 60_000
const profiles = new Map<string, Entry<ProfileAnswer>>()
const boards = new Map<Board, Entry<PlayerRow[] | 'offline'>>()

const keyOf = (name: string) => name.trim().toLowerCase()

/** a profile already fetched this visit, if any (a first paint with no skeleton) */
export const keptProfile = (name: string): ProfileAnswer | undefined => {
  const v = profiles.get(keyOf(name))?.v
  return v === 'offline' ? undefined : v
}

/** a player's public profile; `fresh` asks the server again even when a copy is kept */
export function loadProfile(name: string, fresh = false): Promise<ProfileAnswer> {
  const k = keyOf(name)
  const hit = profiles.get(k)
  if (hit && !fresh && Date.now() - hit.at < PROFILE_FRESH && hit.v !== 'offline') return hit.p
  const e: Entry<ProfileAnswer> = { at: Date.now(), p: fetchProfile(name).catch(() => 'offline' as const) }
  e.p.then((v) => {
    e.v = v
    if (v === 'offline' && profiles.get(k) === e) profiles.delete(k)
  })
  profiles.set(k, e)
  return e.p
}

/** a leaderboard, kept for a minute */
export function loadBoard(board: Board, fresh = false): Promise<PlayerRow[] | 'offline'> {
  const hit = boards.get(board)
  if (hit && !fresh && Date.now() - hit.at < BOARD_FRESH && hit.v !== 'offline') return hit.p
  const e: Entry<PlayerRow[] | 'offline'> = { at: Date.now(), p: leaderboard(board).catch(() => 'offline' as const) }
  e.p.then((v) => {
    e.v = v
    if (v === 'offline' && boards.get(board) === e) boards.delete(board)
  })
  boards.set(board, e)
  return e.p
}
const keptBoard = (board: Board) => {
  const v = boards.get(board)?.v
  return v === 'offline' ? undefined : v
}

/** whether a media query matches now, following it as the window changes */
export function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const sync = () => setOn(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return on
}

/** false once the page this is on has started to leave (see above) */
function useStaying() {
  const present = useIsPresent()
  const ref = useRef(present)
  ref.current = present
  return ref
}

/** a profile for a page: the kept copy at once (then a fresh one), 'missing' for no such player */
export function useProfile(name: string) {
  const [got, setGot] = useState<{ name: string; v: ProfileAnswer | undefined }>(() => ({ name, v: keptProfile(name) }))
  const [tries, setTries] = useState(0)
  const staying = useStaying()
  useEffect(() => {
    let live = true
    setGot((g) => (g.name === name ? g : { name, v: keptProfile(name) }))
    loadProfile(name, true).then((v) => {
      // a kept profile stays on screen if the fresh ask fails
      if (live && staying.current) setGot((g) => (v === 'offline' && g.name === name && g.v && g.v !== 'offline' ? g : { name, v }))
    })
    return () => {
      live = false
    }
  }, [name, tries])
  const retry = useCallback(() => {
    setGot({ name, v: undefined })
    setTries((t) => t + 1)
  }, [name])
  const v = got.name === name ? got.v : undefined
  return { answer: v, retry }
}

/** a leaderboard for a page: the kept copy at once, refreshed when it is a minute old */
export function useBoard(board: Board) {
  const [got, setGot] = useState<{ board: Board; v: PlayerRow[] | 'offline' | undefined }>(() => ({ board, v: keptBoard(board) }))
  const [tries, setTries] = useState(0)
  const staying = useStaying()
  useEffect(() => {
    let live = true
    setGot((g) => (g.board === board ? g : { board, v: keptBoard(board) }))
    loadBoard(board, tries > 0).then((v) => live && staying.current && setGot({ board, v }))
    return () => {
      live = false
    }
  }, [board, tries])
  const retry = useCallback(() => {
    setGot({ board, v: undefined })
    setTries((t) => t + 1)
  }, [board])
  return { rows: got.board === board ? got.v : undefined, retry }
}

/** player search, asked `delay` ms after the query stops changing; nothing under `min` characters */
export function usePlayerSearch(query: string, min = 2, delay = 280) {
  const q = query.trim()
  const [got, setGot] = useState<{ q: string; v: PlayerRow[] | 'offline' } | null>(null)
  const staying = useStaying()
  useEffect(() => {
    if (q.length < min) return
    let live = true
    const t = setTimeout(() => {
      searchPlayers(q)
        .catch(() => 'offline' as const)
        .then((v) => live && staying.current && setGot({ q, v }))
    }, delay)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, min, delay])
  if (q.length < min) return { state: 'idle' as const }
  if (!got || got.q !== q) return { state: 'loading' as const, last: got?.v === 'offline' ? undefined : got?.v }
  return got.v === 'offline' ? { state: 'offline' as const } : { state: 'ready' as const, rows: got.v }
}

/** the look the signed-in player (or guest) wears now, from the wallet */
export function useMyLook(): Look {
  const look = useWallet((s) => s.look)
  return useMemo(() => cleanLook(look), [look])
}

/** the hash route of a player's profile */
export const profilePath = (name: string) => `/player/${encodeURIComponent(name)}`
/** the full link to a player's profile, for copying */
export const profileLink = (name: string) => {
  try {
    return `${location.origin}${location.pathname}#${profilePath(name)}`
  } catch {
    return `#${profilePath(name)}`
  }
}

/** "Online now", "Last seen 3h ago", or "Offline" */
export function seenText(p: { online: boolean; lastSeen?: string | null }, now = Date.now()) {
  if (p.online) return 'Online now'
  const t = p.lastSeen ? Date.parse(p.lastSeen) : NaN
  if (!Number.isFinite(t)) return 'Offline'
  const ago = fmtAgo(now - t)
  return ago === 'just now' ? 'Seen just now' : `Last seen ${ago}`
}

/** "March 2026" */
export function monthYear(iso: string) {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''
}

/** copies text to the clipboard, falling back to a hidden text box where the clipboard API is missing or never answers */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard')
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, no) => setTimeout(() => no(new Error('clipboard timed out')), 1500))])
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      el.remove()
      return ok
    } catch {
      return false
    }
  }
}
