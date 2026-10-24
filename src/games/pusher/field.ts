import { BACK_Z, COIN_R, FIELD_W, FRONT_Z, LOWER_PUSH_MIN, PRIZE_SIZE, UPPER_FRONT_Z, UPPER_PUSH_MAX, UPPER_PUSH_MIN, UPPER_Y, pusherZ, PUSH_PERIOD, LOWER_PUSH_MAX } from './geom'
import { ITEM_KINDS, PRIZE_KINDS, type Field, type Item, type ItemKind } from './types'
import { Body, LIP, LIP_PRIZE, REST, World, shapeOf } from './world'

/*
  Coin Cascade's field: the coins and prizes on the machine between drops, how a new machine is stocked, and the
  check on anything read back from storage.

  A new machine is a lived-in one: both tiers well covered, the lower tier packed up to its lip (the front row
  hanging over the edge a little, as on every real pusher), about 125 coins in all, mostly silver with a sprinkling
  of gold (more of the gold on the lower tier), a good number lying on top of others, and the prize stock: two gems,
  a gold bar, the Golden Idol and the Crown, three of them on the upper tier and two at the back of the lower one.
  The coins are scattered and spread apart, the second layer laid over the first, and then the machine itself is run
  for a push so that everything settles where physics puts it (world.ts): what a player first sees has already been
  shoved about like the rest of their drops will be.

  The stock rules, which every drop keeps (sim.ts): after a drop the field has between FIELD_MIN and FIELD_MAX coins,
  in practice about 115 to 145 (the tiers hold about that many two layers deep: the hopper feeds a few coins in when
  the field runs low, and a few coins a drop slide off the open sides into the gutters when it is fuller than that),
  and it always has the prize stock: a prize that fell is replaced in the same drop, dropped in onto the upper tier
  once the pushers have parked, so the field saved after the drop already has it.
*/

/** the coins on the field after any drop are within these */
export const FIELD_MIN = 110
export const FIELD_MAX = 190
/** below this the hopper drops a few coins in (up to FEED_MAX a drop), and below FIELD_LOW it refills the field in one go */
export const FIELD_FEED = 116
export const FEED_MAX = 4
export const FIELD_LOW = 112
/** the gutters only take coins while the field has more than this */
export const GUTTER_FLOOR = 124
/** the field keeps about this many gold coins (the hopper's coins are gold more often when it has fewer) */
export const GOLD_TARGET = 18
/** the prizes always on the field */
export const STOCK: Record<'gem' | 'bar' | 'idol' | 'crown', number> = { gem: 2, bar: 1, idol: 1, crown: 1 }

const HALF_W = FIELD_W / 2

export const isCoin = (k: ItemKind) => k === 'silver' || k === 'gold'

/** how many of each kind a field holds */
export function countsOf(f: Field): Record<ItemKind, number> {
  const c = { silver: 0, gold: 0, gem: 0, bar: 0, idol: 0, crown: 0 }
  for (const it of f.items) c[it.kind]++
  return c
}

export const coinsOf = (f: Field) => f.items.reduce((a, it) => a + (isCoin(it.kind) ? 1 : 0), 0)

/** a small seeded random stream (mulberry32): the field and the simulation are the same for the same seed */
export function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** a seed from anything: a whole number as it is, a fraction in [0, 1) (rand()) spread over 32 bits */
export const seedOf = (s: number) => (Number.isInteger(s) ? s >>> 0 : Math.floor(Math.abs(s % 1) * 4294967296) >>> 0)

/* ---------------- bodies ↔ items ---------------- */

/** a field item as a resting body */
export function bodyOf(it: Item): Body {
  const b = new Body(it.id, it.kind)
  b.x = it.x
  b.z = it.z
  b.y = it.y - b.h / 2
  b.yaw = it.yaw
  const unit = b.coin ? Math.PI : Math.PI * 2
  b.flipX = Math.round(it.tiltX / unit) * unit
  b.flipZ = Math.round(it.tiltZ / unit) * unit
  b.tx = it.tiltX
  b.tz = it.tiltZ
  b.leanX = it.tiltX - b.flipX
  b.leanZ = it.tiltZ - b.flipZ
  b.state = REST
  b.extents()
  return b
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const wrap = (a: number) => {
  const t = Math.PI * 2
  let v = a % t
  if (v > Math.PI) v -= t
  else if (v <= -Math.PI) v += t
  return v
}

/** a resting body as a field item (positions to a tenth of a millimetre, so the field stays small in storage) */
export function itemOf(b: Body): Item {
  return { id: b.id, kind: b.kind, x: r4(b.x), y: r4(b.shownY), z: r4(b.z), yaw: r4(wrap(b.yaw)), tiltX: r4(wrap(b.tx)), tiltZ: r4(wrap(b.tz)) }
}

/* ---------------- a new machine ---------------- */

interface Spot {
  x: number
  z: number
}

/** n coin centres spread over a rectangle, at least a coin apart where they can be, clear of the prizes */
function scatter(rng: () => number, n: number, x0: number, x1: number, z0: number, z1: number, keepOut: { x: number; z: number; r: number }[]): Spot[] {
  const pts: Spot[] = []
  for (let i = 0; i < n; i++) pts.push({ x: x0 + rng() * (x1 - x0), z: z0 + rng() * (z1 - z0) })
  const D = COIN_R * 2 + 0.03
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = pts[i]
        const b = pts[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d2 = dx * dx + dz * dz
        if (d2 >= D * D) continue
        const d = Math.sqrt(d2) || 1e-3
        const p = (D - d) / 2 / d
        a.x -= dx * p
        a.z -= dz * p
        b.x += dx * p
        b.z += dz * p
      }
    for (const p of pts) {
      for (const k of keepOut) {
        const dx = p.x - k.x
        const dz = p.z - k.z
        const d = Math.sqrt(dx * dx + dz * dz) || 1e-3
        if (d < k.r) {
          p.x = k.x + (dx / d) * k.r
          p.z = k.z + (dz / d) * k.r
        }
      }
      p.x = Math.max(x0, Math.min(x1, p.x))
      p.z = Math.max(z0, Math.min(z1, p.z))
    }
  }
  return pts
}

/** a lively starting field (the same for the same seed) */
export function newField(seed?: number): Field {
  const rng = mulberry(seedOf(seed ?? Math.floor(Math.random() * 4294967296)))
  const items: Item[] = []
  let id = 1
  const side = rng() < 0.5 ? -1 : 1
  const prize = (kind: 'gem' | 'bar' | 'idol' | 'crown', x: number, z: number, floor: number, yaw: number) => {
    items.push({ id: id++, kind, x, y: floor + PRIZE_SIZE[kind].h / 2, z, yaw, tiltX: 0, tiltZ: 0 })
  }
  // the prizes: three up top, two at the back of the lower tier
  const idolX = side * (0.4 + rng() * 1.8)
  const crownX = -side * (1.9 + rng() * 1.7)
  prize('idol', idolX, -5.1 + rng() * 0.9, UPPER_Y, (rng() - 0.5) * 0.8)
  prize('crown', crownX, -4.7 + rng() * 0.9, UPPER_Y, (rng() - 0.5) * 1.2)
  let gx = 0
  for (let k = 0; k < 20; k++) {
    gx = (rng() - 0.5) * 8
    if (Math.abs(gx - idolX) > 1.7 && Math.abs(gx - crownX) > 1.9) break
  }
  prize('gem', gx, -4.0 + rng() * 0.6, UPPER_Y, rng() * Math.PI)
  const barX = side * (1.2 + rng() * 2.4)
  prize('bar', barX, -1.6 + rng() * 0.8, 0, (rng() - 0.5) * 0.7)
  prize('gem', -side * (1 + rng() * 3), -0.9 + rng() * 1.3, 0, rng() * Math.PI)

  const keepOut = items.map((p) => ({ x: p.x, z: p.z, r: Math.hypot(PRIZE_SIZE[p.kind as 'gem'].w, PRIZE_SIZE[p.kind as 'gem'].d) / 2 + COIN_R - 0.05, upper: p.z < UPPER_FRONT_Z }))
  const coin = (x: number, z: number, floor: number, gold: number) =>
    items.push({ id: id++, kind: rng() < gold ? 'gold' : 'silver', x, y: floor + 0.06, z, yaw: rng() * Math.PI * 2, tiltX: rng() < 0.5 ? 0 : Math.PI, tiltZ: 0 })
  const lowerOut = keepOut.filter((k) => !k.upper)
  const upperOut = keepOut.filter((k) => k.upper)
  const m = HALF_W - COIN_R - 0.02
  // the lower tier: packed to the lip
  const lower = scatter(rng, 44 + Math.floor(rng() * 4), -m, m, LOWER_PUSH_MIN + COIN_R + 0.05, FRONT_Z - LIP, lowerOut)
  for (const p of lower) coin(p.x, p.z, 0, 0.19)
  // the upper tier: covered in front of the pusher, a few fresh coins behind
  const upper = scatter(rng, 40 + Math.floor(rng() * 3), -m, m, UPPER_PUSH_MAX + COIN_R - 0.3, UPPER_FRONT_Z - 0.15, upperOut)
  for (const p of upper) coin(p.x, p.z, UPPER_Y, 0.12)
  for (let k = 0; k < 4; k++) coin((rng() - 0.5) * 8, BACK_Z + 0.8 + rng() * 1.4, UPPER_Y, 0.08)
  // the second layer: coins lying on coins
  const layer = (base: Spot[], n: number, floor: number, gold: number) => {
    const top: Spot[] = []
    for (let k = 0, tries = 0; k < n && tries < n * 30; tries++) {
      const b = base[Math.floor(rng() * base.length)]
      const a = rng() * Math.PI * 2
      const r = rng() * 0.32
      const p = { x: Math.max(-m, Math.min(m, b.x + Math.cos(a) * r)), z: b.z + Math.sin(a) * r }
      if (top.some((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 1.06)) continue
      if (keepOut.some((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < q.r * q.r)) continue
      top.push(p)
      coin(p.x, Math.min(p.z, FRONT_Z - LIP), floor + 0.12, gold)
      k++
    }
  }
  layer(lower, 12 + Math.floor(rng() * 4), 0, 0.2)
  layer(upper, 20 + Math.floor(rng() * 4), UPPER_Y, 0.12)

  // run the machine for a push so everything settles where it would
  const f = settle({ v: 1, items, nextId: id }, rng, 1)
  return f
}

/** plays the pushers for a few cycles (nothing is let over the edge or into a gutter) and returns the settled field */
export function settle(field: Field, rng: () => number, cycles: number): Field {
  const w = new World(rng)
  for (const it of field.items) w.add(bodyOf(it))
  const dt = 1 / 60
  const steps = Math.round((cycles * PUSH_PERIOD + 1) / dt)
  for (let s = 0; s < steps; s++) {
    const t = (s + 1) * dt
    const run = t < cycles * PUSH_PERIOD
    w.step(dt, run ? pusherZ(UPPER_PUSH_MIN, UPPER_PUSH_MAX, t) : UPPER_PUSH_MIN, run ? pusherZ(LOWER_PUSH_MIN, LOWER_PUSH_MAX, t) : LOWER_PUSH_MIN)
  }
  const items = w.bodies.filter((b) => b.state === REST).map(itemOf)
  return { v: 1, items, nextId: field.nextId }
}

/* ---------------- the check on stored fields ---------------- */

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** a field read from storage, checked and copied, or null if it is not one this game could have saved */
export function cleanField(x: unknown): Field | null {
  if (!x || typeof x !== 'object') return null
  const f = x as Partial<Field>
  if (f.v !== 1 || !Array.isArray(f.items) || f.items.length > 400 || !Number.isInteger(f.nextId)) return null
  const items: Item[] = []
  const ids = new Set<number>()
  let maxId = 0
  for (const raw of f.items as unknown[]) {
    if (!raw || typeof raw !== 'object') return null
    const it = raw as Item
    if (!Number.isInteger(it.id) || it.id <= 0 || ids.has(it.id)) return null
    if (!ITEM_KINDS.includes(it.kind)) return null
    const s = shapeOf(it.kind)
    const lip = s.coin ? LIP : LIP_PRIZE
    if (!num(it.x, -HALF_W, HALF_W) || !num(it.z, BACK_Z, FRONT_Z - lip + 0.005) || !num(it.y, 0, 8)) return null
    if (!num(it.yaw, -100, 100) || !num(it.tiltX, -4, 4) || !num(it.tiltZ, -4, 4)) return null
    // behind the upper tier's lip it must be on the upper tier, not in the shelf under it
    if (it.z < UPPER_FRONT_Z && it.y - s.h / 2 < UPPER_Y - 0.05) return null
    ids.add(it.id)
    maxId = Math.max(maxId, it.id)
    items.push({ id: it.id, kind: it.kind, x: it.x, y: it.y, z: it.z, yaw: it.yaw, tiltX: it.tiltX, tiltZ: it.tiltZ })
  }
  if ((f.nextId as number) <= maxId) return null
  const field: Field = { v: 1, items, nextId: f.nextId as number }
  const c = countsOf(field)
  const coins = c.silver + c.gold
  if (coins < FIELD_MIN || coins > FIELD_MAX) return null
  for (const k of PRIZE_KINDS) if (c[k] !== STOCK[k as keyof typeof STOCK]) return null
  return field
}
