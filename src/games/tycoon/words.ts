import { ATTRACTIONS, CITIES, MILESTONES, N_ATTR, PAY_STEP_FROM, SPEED_STEPS, STAR_K, STAR_SCALE, UPGRADES, starsFor, type Milestone, type Save } from './engine'

/*
  Casino Tycoon's words and the small sums the screen shows but the engine doesn't need: the managers' names, each
  city's line, the attractions' colours, the count steps, how far along each milestone is, the next Star, and
  durations and amounts in plain words.
*/

/** each attraction's manager: a name and the line under it */
export const MANAGERS: readonly { name: string; line: string }[] = [
  { name: 'Clawdia', line: 'Never misses a plush.' },
  { name: 'Lucky Lou', line: 'Pulls a mean lever.' },
  { name: 'Dicey Dee', line: 'Rolls with it.' },
  { name: 'Ace Avery', line: 'Deals a fast shoe.' },
  { name: 'Rosa Rouge', line: 'Spins like clockwork.' },
  { name: 'Poker Pete', line: 'Keeps a straight face.' },
  { name: 'Velvet Vic', line: 'Knows every VIP by name.' },
  { name: 'Sky Sam', line: 'Shakes, never stirs.' },
  { name: 'Diva Dana', line: 'Sells out every show.' },
  { name: 'Sir Suite', line: 'Turns down every bed.' },
]

/** what each city is like, for the Stars tab */
export const CITY_LINES = [
  'Where it all starts: a windmill on the hill and a quiet main street.',
  'A paddle steamer on the river and a lot more money in town.',
  'Neon in the desert: the pyramid beam lights up the night.',
  'The city that never sleeps: the Ferris wheel spins all night.',
  'Yachts in the harbour and a palace on the hill. The top.',
] as const

/** each attraction's colour in the panel (the floor tints its pad with a pale one of these) */
export const ACCENT = ['#ff6fb1', '#ff5a4e', '#2fc47a', '#14b29a', '#f2b230', '#7d6cff', '#b36bff', '#25c2d0', '#ff8a3d', '#e8c46a'] as const

/** the counts at which attraction steps happen up to n (25, 50, 100, 200, 300 …), for the step track */
export function stepsBetween(from: number, to: number) {
  const out: number[] = []
  for (const k of SPEED_STEPS) if (k > from && k <= to) out.push(k)
  for (let k = PAY_STEP_FROM; k <= to; k += 100) if (k > from) out.push(k)
  return out
}

/** the last count step at or below n (0 below the first) */
export function lastStep(n: number) {
  let s = 0
  for (const k of SPEED_STEPS) if (n >= k) s = k
  if (n >= PAY_STEP_FROM) s = PAY_STEP_FROM + 100 * Math.floor((n - PAY_STEP_FROM) / 100)
  return s
}

/** lifetime Cash that earns Star number n */
const cashForStar = (n: number) => STAR_SCALE * (n / STAR_K) ** 3

/** the lifetime Cash the next Star a sale would bring needs */
export const nextStarAt = (s: Save) => cashForStar(Math.max(s.stars, starsFor(s.lifetime)) + 1)

/** how far along a milestone is: what it counts and the goal, to draw its bar */
export function milestoneProgress(m: Milestone, s: Save): { have: number; need: number; cash?: boolean } {
  const id = m.id
  const count = (xs: boolean[]) => xs.filter(Boolean).length
  if (id.startsWith('open-')) {
    const i = ATTRACTIONS.findIndex((a) => `open-${a.id}` === id)
    return { have: Math.min(1, s.owned[i]), need: 1 }
  }
  if (id === 'any-100') return { have: Math.max(...s.owned), need: 100 }
  if (id === 'all-25') return { have: Math.min(...s.owned), need: 25 }
  if (id === 'all-100') return { have: Math.min(...s.owned), need: 100 }
  if (id === 'manager-1') return { have: count(s.managers), need: 1 }
  if (id === 'manager-all') return { have: count(s.managers), need: N_ATTR }
  if (id === 'upgrades-10') return { have: s.upgrades.length, need: 10 }
  if (id === 'upgrades-all') return { have: s.upgrades.length, need: UPGRADES.length }
  if (id.startsWith('cash-')) return { have: s.lifetime, need: Number(id.slice(5)), cash: true }
  if (id === 'sale-1') return { have: s.sales, need: 1 }
  if (id.startsWith('stars-')) return { have: s.stars, need: Number(id.slice(6)) }
  if (id.startsWith('city-')) return { have: s.stars, need: CITIES[Number(id.slice(5))].stars }
  if (id.startsWith('whales-')) return { have: s.whales, need: Number(id.slice(7)) }
  if (id.startsWith('chips-')) return { have: s.chips, need: Number(id.slice(6)) }
  return { have: m.done(s) ? 1 : 0, need: 1 }
}

/** every milestone's coins together */
export const MILESTONE_COINS = MILESTONES.reduce((a, m) => a + m.coins, 0)

/** "4h 12m", "35m", "50s": a stretch of time in plain words */
export function spell(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${s}s`
}

/** a cycle's length: "0.25s", "6s", "1m 36s", "10h 14m" */
export function cycleWord(sec: number) {
  if (sec < 1) return `${sec.toFixed(sec < 0.1 ? 3 : 2).replace(/0+$/, '')}s`
  if (sec < 60) return `${Number.isInteger(sec) ? sec : sec.toFixed(1)}s`
  return spell(sec * 1000)
}

/** coins as the site writes them: whole numbers bare, cents when there are some */
export const coinWord = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

/** "1 thing", "2 things" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
