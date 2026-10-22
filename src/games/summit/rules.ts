/*
  Summit's rules: climb a mountain pitch by pitch, choosing your route each time, and bank your winnings whenever you
  like.

  A climb costs the stake and has PITCHES pitches to the summit. At each pitch the player picks a route: the Trail is
  safe most of the time and steps the multiplier up a little; the Wall is a long shot and steps it up a lot. The route
  holds with its chance p (ROUTES); if it holds, the climber moves up and the multiplier is multiplied by 1/p; if not,
  they fall and the climb pays nothing. After any pitch the player may bank: the climb pays the stake times RTP times
  the product of 1/p over the pitches climbed (capped at MAX_MULT). Reaching the summit banks automatically.

  Every route is priced at its own odds (a step of 1/p for a chance p), so whatever routes are chosen and whenever the
  player banks, the climb returns exactly RTP, until the cap bites: a climb that would pass MAX_MULT pays MAX_MULT,
  which only the boldest routes reach. (tools/summit-test.ts checks the multipliers and simulates ways of climbing.)

  Nothing is decided ahead: each pitch is drawn when the player commits to a route, and the climb so far is stored
  before the result is shown, so a reload never changes one.
*/

export const RTP = 0.97
export const PITCHES = 10
export const MAX_MULT = 10_000

export type RouteId = 'trail' | 'ridge' | 'cliff' | 'wall'
export interface Route {
  id: RouteId
  name: string
  line: string
  /** the chance the route holds */
  p: number
}
export const ROUTES: readonly Route[] = [
  { id: 'trail', name: 'Trail', line: 'Steady going', p: 0.9 },
  { id: 'ridge', name: 'Ridge', line: 'A narrow edge', p: 0.66 },
  { id: 'cliff', name: 'Cliff', line: 'Handholds only', p: 0.4 },
  { id: 'wall', name: 'Sheer Wall', line: 'Against all odds', p: 0.2 },
]
export const routeOf = (id: RouteId) => ROUTES.find((r) => r.id === id)!
/** what a route multiplies the climb by when it holds */
export const stepOf = (id: RouteId) => 1 / routeOf(id).p

export interface Climb {
  /** the routes climbed so far, in order */
  path: RouteId[]
  /** 'up' while climbing; 'fell' or 'banked' once it is over */
  state: 'up' | 'fell' | 'banked'
  /** the route that gave way (when it fell) */
  fellOn: RouteId | null
}

export const newClimb = (): Climb => ({ path: [], state: 'up', fellOn: null })

/** the multiplier a climb pays if banked now: RTP times every step climbed, capped (1 before the first pitch: nothing banked yet) */
export function multiplierOf(path: readonly RouteId[]): number {
  if (!path.length) return 0
  const m = RTP * path.reduce((a, r) => a * stepOf(r), 1)
  return Math.min(MAX_MULT, Math.floor(m * 100 + 1e-9) / 100)
}

/** the multiplier after one more pitch on route r, if it holds */
export const nextMultiplier = (path: readonly RouteId[], r: RouteId) => multiplierOf([...path, r])

/** the chance of reaching a multiplier from here by taking route r every time: shown on the route cards */
export const holdChance = (r: RouteId) => routeOf(r).p

/** climbs one pitch on route r with a uniform number u in [0, 1): it holds when u < p */
export function climb(c: Climb, r: RouteId, u: number): Climb {
  if (c.state !== 'up' || c.path.length >= PITCHES) return c
  if (u < routeOf(r).p) {
    const path = [...c.path, r]
    // the summit banks itself
    return { path, state: path.length >= PITCHES ? 'banked' : 'up', fellOn: null }
  }
  return { ...c, state: 'fell', fellOn: r }
}

/** banks the climb: only after at least one pitch */
export function bank(c: Climb): Climb {
  if (c.state !== 'up' || !c.path.length) return c
  return { ...c, state: 'banked' }
}

/** what a finished climb pays for a stake, to the cent */
export function payoutOf(stake: number, c: Climb): number {
  if (c.state !== 'banked') return 0
  return Math.floor(stake * multiplierOf(c.path) * 100 + 1e-6) / 100
}

/** whether a stored climb is well formed */
export function isClimb(x: unknown): x is Climb {
  const c = x as Climb
  return (
    !!c &&
    Array.isArray(c.path) &&
    c.path.length <= PITCHES &&
    c.path.every((r) => ROUTES.some((x) => x.id === r)) &&
    ['up', 'fell', 'banked'].includes(c.state) &&
    (c.fellOn === null || ROUTES.some((x) => x.id === c.fellOn))
  )
}
