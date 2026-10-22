import { fmt } from '../../lib/format'
import { MAX_MULT, PITCHES, RTP, routeOf, stepOf, type RouteId } from './rules'

/*
  Summit's words and numbers: how a multiplier, a chance and an altitude are written, the camps' names, and each
  route's colours and the verbs the climber's moves are told with. The camps run from Base Camp (2,400 m) up ten
  pitches of 600 m to the summit at 8,400 m.
*/

export const BASE_ALT = 2400
export const PITCH_ALT = 600
export const altOf = (k: number) => BASE_ALT + k * PITCH_ALT
export const altText = (k: number) => `${fmt(altOf(k), 0)} m`
export const campName = (k: number) => (k <= 0 ? 'Base Camp' : k >= PITCHES ? 'Summit' : `Camp ${k}`)

/** a multiplier as the game writes it: to the cent, whole numbers from 1,000× (rounded down, never up) */
export const multText = (m: number) => (m >= 1000 ? `${fmt(Math.floor(m), 0)}×` : `${m.toFixed(2)}×`)
export const pct = (p: number, d = 0) => `${(p * 100).toFixed(d)}%`
/** "1 in 12" for a chance */
export const oneIn = (p: number) => {
  const n = 1 / p
  return `1 in ${n >= 100 ? fmt(Math.round(n), 0) : n >= 10 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')}`
}
export const coinText = (n: number) => (n >= 100_000 ? `${fmt(n / 1000, 1)}K` : fmt(n))

/** the multiplier a climb would make before the cap (to tell when the cap bites) */
export const uncapped = (path: readonly RouteId[]) => RTP * path.reduce((a, r) => a * stepOf(r), 1)
/** whether one more pitch on route r would pass the cap (the route card warns) */
export const passesCap = (path: readonly RouteId[], r: RouteId) => uncapped([...path, r]) > MAX_MULT
/** the chance of every pitch of a path holding */
export const pathChance = (path: readonly RouteId[]) => path.reduce((a, r) => a * routeOf(r).p, 1)

export interface Look {
  /** light and deep colours of the route's card and line */
  a: string
  b: string
  /** text on the light colour */
  ink: string
  glow: string
  /** what the climber is doing on it */
  doing: string
  /** how it gives way */
  gives: string
}
export const LOOK: Record<RouteId, Look> = {
  trail: { a: '#4ee58d', b: '#12a050', ink: '#03240f', glow: 'rgba(46,220,120,.55)', doing: 'Strolling up the Trail', gives: 'The Trail slid away underfoot' },
  ridge: { a: '#62cdff', b: '#1c74c9', ink: '#031a33', glow: 'rgba(76,180,255,.55)', doing: 'Edging along the Ridge', gives: 'The Ridge crumbled' },
  cliff: { a: '#ffbd52', b: '#e0631b', ink: '#2f1300', glow: 'rgba(255,160,60,.6)', doing: 'Scrambling up the Cliff', gives: 'A hold broke on the Cliff' },
  wall: { a: '#ff6b81', b: '#c0123a', ink: '#33000c', glow: 'rgba(255,70,100,.65)', doing: 'Roped up on the Sheer Wall', gives: 'The rope snapped on the Sheer Wall' },
}
