import {
  FIELD_W,
  FRONT_Z,
  GUTTER_Z0,
  HOPPER,
  LAND_Z,
  LOWER_PUSH_MAX,
  LOWER_PUSH_MIN,
  PUSH_PERIOD,
  SLOT_X,
  SLOT_Y,
  UPPER_FRONT_Z,
  UPPER_PUSH_MAX,
  UPPER_PUSH_MIN,
  pusherZ,
} from './geom'
import { FEED_MAX, FIELD_FEED, FIELD_LOW, FIELD_MAX, GOLD_TARGET, GUTTER_FLOOR, STOCK, bodyOf, isCoin, itemOf, mulberry, seedOf } from './field'
import { ITEM_KINDS, PRIZE_KINDS, type DropResult, type Field, type Item, type ItemKind, type Run, type RunEvent, type Track } from './types'
import { AIR, Body, G, GONE, IN_GUTTER, IN_TRAY, LIP, LIP_PRIZE, ON_FIELD, REST, TIP, World } from './world'

export { LOWER_TOP, UPPER_PUSH_H, G } from './world'

/*
  Coin Cascade's drop, played out: runDrop(field, result, aim, seed) takes the machine as it stands, the drawn result
  (rules.ts) and where the player aimed, and plays the drop on the physics (world.ts) so that exactly the result's
  things go over the front edge into the tray and nothing else does. It returns the Run the 3D machine shows: every
  moving body's pose frame by frame, the pushers, the moments (events) and the field as it rests afterwards. The same
  field, result, aim and seed always give the same run (its own seeded random stream; the page draws the seed).

  The drop. The player's coin leaves the slot at x = aim × SLOT_X, turning from edge-on, and lands on the upper tier
  at LAND_Z, on whatever is there. The pushers then run a whole number of PUSH_PERIOD cycles together: one or two for
  a plain drop, three when a prize is to go (so it can creep to the edge over the pushes, teeter, and go on the last),
  three for a Coin Shower (the hopper tips during the first push and pours its coins onto the lower tier), four for a
  Quake (on the second push the machine shudders and both pushers surge beyond their usual reach), and more when what
  has to fall is far from the edge. Then the machine stops, parked, while the last things land.

  How exactly the result goes over. Before anything moves, the result's items are chosen on the field: for each kind,
  the ones that can get to the edge soonest (nearest the front, nothing lying on them, not hard against a wall), and
  each is given its push: the cycle in which it goes, and a moment in that push's forward stroke (prizes go last, late
  in the last push, after a teeter). The front edge's invisible lip (world.ts) holds every other body back, and holds a
  chosen one too until its moment. While the pushers push, each chosen body is helped along at least as fast as it must
  go to reach the edge by its moment (a gentle push in time with the pushers, so it looks shoved): it rides up over
  coins that block its way (a prize too: onto the coin bed) and goes round a prize in its way; one that has made no
  headway for a couple of seconds of pushing rides up over the bed altogether (a last resort, seldom seen). At its
  moment the lip lets it go and it slides over, tips, and falls down the chute into the tray. If one is still on the
  field when the last cycle ends, the machine runs another cycle (it never needs to in the tests: tools/pusher-sim-test.ts).

  The look of a drop is drawn from the run's seed (which body goes when, how coins tumble, the hopper's spray): the
  result decides only what goes over. Aiming moves where the player's coin lands, nothing else.

  The stock. The hopper drops a few coins onto the lower tier when the field is getting low (a refill when it is very
  low) or short of gold (a Shower's coins do the same job, a few more than go over, fewer when the field is full);
  coins on the open sides at the front are squeezed off into the gutters, a few a drop, while the field is above
  GUTTER_FLOOR (field.ts); a prize that falls is replaced in the same drop (it drops in from above onto the middle of
  the upper tier once the pushers have parked: the 'restock' moment). So the field after any drop has between
  FIELD_MIN and FIELD_MAX coins and the whole prize stock.

  Frames. The physics steps once a frame, Run.step = 1/30 s, and the scene interpolates between frames (angles are
  continuous, never wrapped, so they interpolate too). A pose is the body's centre (x, y, z), its yaw, and its tilt
  about x and z; in three.js terms object.position.set(x, y, z) and object.rotation.set(tiltX, yaw, tiltZ, 'ZXY'). A
  body that does not move during the drop has no track and stays where the field had it. A body that falls into the
  tray is tracked to the end of the run, resting in the tray at its last pose (the scene may keep it there until the
  next drop); one that goes down a gutter is tracked until it is out of sight. A body that appears during the drop (the
  player's coin, the hopper's, a restocked prize) is on show from its first frame, in the air where it comes in.

  The lower pusher is a plate LOWER_TOP tall that slides out from under the upper shelf: things that fall onto it ride
  it and are scraped off its front by the shelf's front when it slides back (the shelf's front comes down to the plate).
*/

/** seconds per frame of a run (the scene interpolates between frames) */
export const STEP = 1 / 30
/** when the pushers start: once the player's coin has landed */
export const PUSH_START = 0.45
/** how much further than their usual reach the pushers go in a Quake */
export const SURGE_UPPER = 0.8
export const SURGE_LOWER = 0.9
/** the most cycles a drop can take (it never needs this many) */
const MAX_CYCLES = 10
/** how far a body can be helped along in one push, about */
const REACH_PER_PUSH = 2.4
/** the fastest a chosen body is helped along, units / s */
const VMAX = 2.6
const HALF_W = FIELD_W / 2

/** what was decided before the drop moved (for the lab and the tests) */
export interface DropPlan {
  cycles: number
  quakeCycle: number
  feed: number
  pour: number
  gutterBudget: number
  /** the chosen bodies: their ids, and the moment the lip lets each go (seconds into the drop) */
  chosen: { id: number; kind: ItemKind; goAt: number }[]
}

/** for the lab and the tests: the plan, and a look at the physics after every frame */
export interface DropDebug {
  plan?: (p: DropPlan) => void
  frame?: (w: World, frame: number) => void
}

/** how far a body has to travel to go over the front edge */
function distToEdge(b: Body) {
  if (b.upper) return UPPER_FRONT_Z - b.z + (FRONT_Z - UPPER_FRONT_Z) - 0.6
  return FRONT_Z - b.z
}

/** the forward stroke's strength at time t into the pushing (0 while the pushers go back) */
function strokeAt(tau: number) {
  if (tau < 0) return 0
  const u = (tau / PUSH_PERIOD) % 1
  if (u >= 0.5) return 0
  const k = u * 2
  return 6 * k * (1 - k)
}

/** the push time (the integral of strokeAt) between two moments of the pushing */
function pushBetween(t1: number, t2: number) {
  if (t2 <= t1) return 0
  const P = PUSH_PERIOD
  const H = P / 2
  // the integral from 0 to tau: whole cycles give H each, a part cycle the smoothstep of the part stroke
  const F = (tau: number) => {
    if (tau <= 0) return 0
    const c = Math.floor(tau / P)
    const r = tau - c * P
    const k = Math.min(1, r / H)
    return c * H + H * (k * k * (3 - 2 * k))
  }
  return F(t2) - F(t1)
}

/** plays a drop: exactly result.wins go over the front edge into the tray */
export function runDrop(field: Field, result: DropResult, aim: number, seed: number, debug?: DropDebug): Run {
  const rng = mulberry(seedOf(seed))
  const w = new World(rng)
  for (const it of field.items) w.add(bodyOf(it))
  const fieldBodies = w.bodies.length
  let nextId = field.nextId
  const wins = result.wins
  const P = PUSH_PERIOD
  const t0 = PUSH_START
  const shower = result.feature === 'shower'

  /* ---- the stock: what the hopper adds, what the gutters may take ---- */
  const coins0 = w.bodies.filter((b) => b.coin).length
  const gold0 = w.bodies.filter((b) => b.kind === 'gold').length
  const wonCoins = wins.silver + wins.gold
  // (a Shower pours a few more than go over, fewer when the field is already full)
  let pour = shower ? Math.max(4, wonCoins + 5 + Math.floor(rng() * 8) - Math.max(0, coins0 - 126)) : 0
  let feed = 0
  const before = coins0 + 1 - wonCoins
  if (before + pour < FIELD_LOW) feed = FIELD_FEED - before - pour
  else if (before + pour < FIELD_FEED) feed = Math.min(FEED_MAX, FIELD_FEED - before - pour)
  // gold coins go over far more often than they come in: when the field is short of gold the hopper drops one or two
  const goldLeft = gold0 - wins.gold
  const goldFeed = goldLeft < GOLD_TARGET && rng() < 0.6 ? Math.min(2, GOLD_TARGET - goldLeft) : 0
  feed = Math.max(feed, goldFeed)
  // a Shower is the hopper's coins already: no separate feed
  if (shower) {
    pour = Math.max(0, Math.min(pour + feed, FIELD_MAX - 2 - before))
    feed = 0
  }
  // never short of the coins the result needs (a field always has plenty: this is only a safeguard)
  const short: ItemKind[] = []
  for (const k of ['silver', 'gold'] as const) {
    const have = w.bodies.filter((b) => b.kind === k).length
    for (let i = have; i < wins[k]; i++) short.push(k)
  }
  const goldShare = Math.max(0.05, Math.min(0.6, 0.12 + (GOLD_TARGET - goldLeft) * 0.04))
  const coinKind = (): ItemKind => (rng() < goldShare ? 'gold' : 'silver')
  // (a few a drop at most, so a full field drains over a few drops rather than all at once)
  const excess = Math.max(0, before + pour + feed + short.length - GUTTER_FLOOR)
  const gutterBudget = Math.min(excess > 24 ? excess : shower ? 6 : 3, excess)
  let gutters = 0

  /* ---- the result's items on the field, and the cycles ---- */
  // what everything stands and leans on, before anything moves
  w.prime()
  const underSomething = new Set<Body>()
  for (const b of w.bodies) {
    if (b.ride) underSomething.add(b.ride)
    if (b.sup) underSomething.add(b.sup)
  }
  const chosen: Body[] = []
  const score = (b: Body) => distToEdge(b) + (underSomething.has(b) ? 0.5 : 0) + (Math.abs(b.x) > HALF_W - 1.1 ? 0.6 : 0) + rng() * 0.5
  for (const k of ITEM_KINDS) {
    if (!wins[k]) continue
    const cands = w.bodies.filter((b) => b.kind === k && b.state !== GONE && b.fate === ON_FIELD).map((b) => ({ b, s: score(b) }))
    cands.sort((a, b) => a.s - b.s)
    for (let i = 0; i < Math.min(wins[k], cands.length); i++) chosen.push(cands[i].b)
  }
  const prizeWin = PRIZE_KINDS.some((k) => wins[k] > 0)
  const far = chosen.reduce((a, b) => Math.max(a, distToEdge(b)), 0)
  let cycles: number
  if (result.feature === 'quake') cycles = 4
  else if (shower) cycles = 3
  else if (prizeWin) cycles = 3
  else if (!chosen.length) cycles = rng() < 0.3 ? 2 : 1
  else cycles = far < 1.1 && chosen.length <= 2 && rng() < 0.5 ? 1 : 2
  cycles = Math.min(7, Math.max(cycles, Math.ceil(far / REACH_PER_PUSH) + (prizeWin ? 1 : 0)))
  const quakeCycle = result.feature === 'quake' ? 1 : -1

  // each chosen body's push and its moment in that push's forward stroke
  const order = [...chosen].sort((a, b) => a.im - b.im || distToEdge(a) - distToEdge(b))
  let prizeSlot = 0
  const prizeCount = chosen.filter((b) => !b.coin).length
  for (const b of order) {
    let push: number
    let at: number
    const need = Math.max(0, Math.ceil(distToEdge(b) / REACH_PER_PUSH) - 1)
    if (!b.coin) {
      // prizes on the last push, the most valuable last of all
      push = cycles - 1
      at = 0.55 + (prizeCount > 1 ? (prizeSlot++ / (prizeCount - 1)) * 0.6 : 0.3)
    } else {
      let lo = Math.min(cycles - 1, need)
      if (shower) lo = Math.max(lo, Math.min(1, cycles - 1))
      if (result.feature === 'quake' && rng() < 0.65 && lo <= quakeCycle) push = quakeCycle
      else push = lo + Math.floor(rng() * (cycles - lo))
      at = 0.1 + rng() * 1.05
    }
    b.goAt = t0 + push * P + at
  }
  const live = new Set(chosen)

  /* ---- the record: every body's pose each frame, into a shared scratch buffer ---- */
  const feedKinds: ItemKind[] = [...short]
  for (let i = 0; i < feed; i++) feedKinds.push(i < goldFeed ? 'gold' : coinKind())
  const replace = PRIZE_KINDS.reduce((a, k) => a + wins[k], 0)
  const maxFrames = Math.ceil((t0 + MAX_CYCLES * P + 4) / STEP) + 2
  const stride = maxFrames * 6
  const buf = scratch(stride * (fieldBodies + 1 + feedKinds.length + pour + replace + 1))
  let frame = 0
  const put = (b: Body, f: number) => {
    const o = b.i * stride + f * 6
    buf[o] = b.x
    buf[o + 1] = b.shownY
    buf[o + 2] = b.z
    buf[o + 3] = b.yaw
    buf[o + 4] = b.tx
    buf[o + 5] = b.tz
  }
  // frame 0 is the field exactly as it stood
  for (let i = 0; i < fieldBodies; i++) {
    const it = field.items[i]
    const o = i * stride
    buf[o] = it.x
    buf[o + 1] = it.y
    buf[o + 2] = it.z
    buf[o + 3] = it.yaw
    buf[o + 4] = it.tiltX
    buf[o + 5] = it.tiltZ
  }
  const pushers: number[] = [UPPER_PUSH_MIN, LOWER_PUSH_MIN]
  const gone = new Map<Body, number>()
  const record = () => {
    for (const b of w.bodies) {
      if (gone.has(b)) continue
      put(b, frame)
      if (b.state === GONE) gone.set(b, frame)
    }
    pushers.push(w.zU, w.zL)
  }

  /* ---- what comes in: the player's coin, the hopper's, the restocked prizes ---- */
  const events: RunEvent[] = []
  const born = new Map<Body, number>()
  const spawn = (kind: ItemKind, x: number, y: number, z: number) => {
    const b = w.add(new Body(nextId++, kind))
    b.x = x
    b.y = y - b.h / 2
    b.z = z
    b.state = AIR
    b.fallY = b.y
    b.oy = b.y
    born.set(b, frame)
    // on show from this frame, where it comes in
    put(b, frame)
    return b
  }
  const pending: { t: number; make: () => void }[] = []
  const at = (t: number, make: () => void) => pending.push({ t, make })

  // the player's coin: out of the slot edge-on, turning flat as it falls
  const ax = Math.max(-1, Math.min(1, aim)) * SLOT_X
  const drop = spawn('silver', ax, SLOT_Y - 0.1, LAND_Z)
  drop.vy = -1.5
  drop.tx = Math.PI / 2
  drop.wtx = ((rng() < 0.5 ? -1 : 1) * Math.PI) / 2 / 0.26
  drop.wy = (rng() - 0.5) * 8
  put(drop, 0)
  events.push({ f: 0, kind: 'drop', id: drop.id, x: ax })

  // the hopper's coins
  const hopperCoin = (kind: ItemKind, spread: number, fwd: number) => {
    const b = spawn(kind, HOPPER.x + (rng() - 0.5) * 0.6, HOPPER.y - 0.5, HOPPER.z + (rng() - 0.5) * 0.4)
    b.vx = (rng() - 0.5) * spread
    b.vz = fwd * (0.2 + rng())
    b.vy = -0.5 - rng()
    // tumbling end over end (about x: a coin that lands face down is turned over about x, which its lean then adds to),
    // a whole number of half turns on the way down, give or take, so that it comes down more or less flat
    const fall = (b.vy + Math.sqrt(b.vy * b.vy + 2 * G * (HOPPER.y - 0.6))) / G
    b.wtx = ((rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 3)) * Math.PI) / fall + (rng() - 0.5) * 2
    b.wy = (rng() - 0.5) * 10
    put(b, frame)
    return b
  }
  if (feedKinds.length) {
    const t = 0.15
    at(t, () => events.push({ f: frame, kind: 'feed' }))
    feedKinds.forEach((k, i) =>
      at(t + i * (feedKinds.length > 6 ? 0.07 : 0.13), () => {
        const b = hopperCoin(k, 3.2, 1.6)
        // a coin the result needs that the field lacked goes over like the rest
        if (i < short.length) {
          b.goAt = t0 + (cycles - 1) * P + 0.4
          chosen.push(b)
          live.add(b)
        }
      }),
    )
  }
  if (shower) {
    const t = t0 + 0.1
    at(t, () => events.push({ f: frame, kind: 'shower' }))
    for (let i = 0; i < pour; i++) at(t + 0.18 + (i / pour) * 1.3, () => hopperCoin(coinKind(), 6.5, 2.6))
  }
  if (quakeCycle >= 0) at(t0 + quakeCycle * P - 0.2, () => events.push({ f: frame, kind: 'quake' }))
  debug?.plan?.({ cycles, quakeCycle, feed: feedKinds.length, pour, gutterBudget, chosen: chosen.map((b) => ({ id: b.id, kind: b.kind, goAt: b.goAt })) })

  // the pushers: parked, then whole cycles together (a Quake's surges further), then parked again
  const pushersAt = (t: number): [number, number] => {
    const tau = t - t0
    if (tau <= 0 || tau >= cycles * P) return [UPPER_PUSH_MIN, LOWER_PUSH_MIN]
    const k = Math.floor(tau / P)
    const s = k === quakeCycle
    return [pusherZ(UPPER_PUSH_MIN, UPPER_PUSH_MAX + (s ? SURGE_UPPER : 0), tau), pusherZ(LOWER_PUSH_MIN, LOWER_PUSH_MAX + (s ? SURGE_LOWER : 0), tau)]
  }

  // what happens on the field becomes the run's events
  w.hook = (e, b, h) => {
    if (e === 'edge') {
      // the lip makes this impossible for anything not chosen; a guard all the same
      if (!live.has(b)) throw new Error(`pusher sim: ${b.kind} ${b.id} went over the edge unplanned`)
      events.push({ f: frame, kind: 'edge', id: b.id, item: b.kind })
    } else if (e === 'tray') {
      events.push({ f: frame, kind: 'tray', id: b.id, item: b.kind })
      live.delete(b)
    } else if (e === 'gutter') {
      gutters++
      events.push({ f: frame, kind: 'gutter', id: b.id, item: b.kind })
    } else if (e === 'land' && h > 0.25) events.push({ f: frame, kind: 'land', id: b.id, item: b.kind })
  }

  /* ---- run it ---- */
  let t = 0
  let tailFrom = Infinity
  const restocked = new Set<Body>()
  pending.sort((a, b) => a.t - b.t)
  let pi = 0
  for (frame = 1; frame < maxFrames; frame++) {
    t += STEP
    while (pi < pending.length && pending[pi].t <= t) pending[pi++].make()
    // the Quake's shudder
    const tq = t - (t0 + quakeCycle * P)
    w.shake = quakeCycle >= 0 && tq > -0.1 && tq < 1.5 ? 2.6 * Math.sin((Math.PI * (tq + 0.1)) / 1.6) : 0
    steer(live, t, t0, cycles, P)
    gate(w, gutterBudget - gutters, strokeAt(t - t0))
    const [zu, zl] = pushersAt(t)
    w.step(STEP, zu, zl)
    record()
    debug?.frame?.(w, frame)
    const end = t0 + cycles * P
    if (t >= end - 1e-9 && tailFrom === Infinity) {
      // anything chosen still on the field: one more push (it never needs it, but it must never miss)
      if ([...live].some((b) => b.fate === ON_FIELD) && cycles < MAX_CYCLES) {
        cycles++
        continue
      }
      tailFrom = t
    }
    if (tailFrom < Infinity) {
      // the prizes that fell are replaced, once the pushers have parked (only those that did, so the stock is whole
      // whatever happened, and one that goes late is replaced late)
      const gone = w.bodies.filter((b) => !b.coin && b.fate !== ON_FIELD && !restocked.has(b))
      if (gone.length) {
        for (const b of gone) restocked.add(b)
        restock(w, gone.map((b) => b.kind), spawn, events, frame, rng)
      }
      const busy = live.size > 0 || w.bodies.some((b) => b.state === AIR || b.state === TIP)
      // still sliding, or still turning flat after a landing
      const moving = w.bodies.some((b) => b.state === REST && (Math.abs(b.vx) > 0.05 || Math.abs(b.vz) > 0.05 || Math.abs(b.tx - b.flipX - b.leanX) + Math.abs(b.tz - b.flipZ - b.leanZ) > 0.01))
      if (t - tailFrom > (live.size ? 6 : 2.5) || (t - tailFrom > 0.8 && !busy && !moving)) break
    }
  }
  const frames = Math.min(frame + 1, maxFrames)

  /* ---- the run ---- */
  const tracks: Track[] = []
  const bs = w.bodies
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i]
    const from = born.get(b) ?? 0
    const to = gone.get(b) ?? frames - 1
    if (i < fieldBodies && b.fate === ON_FIELD) {
      // a field body that never moved has no track
      const o = i * stride
      let moved = false
      for (let f = 1; f < frames && !moved; f++) {
        const q = o + f * 6
        for (let c = 0; c < 6; c++)
          if (Math.abs(buf[q + c] - buf[o + c]) > 2e-4) {
            moved = true
            break
          }
      }
      if (!moved) continue
    }
    const data = buf.slice(i * stride + from * 6, i * stride + (to + 1) * 6)
    tracks.push({ id: b.id, kind: b.kind, from, to, data, fate: b.fate === IN_TRAY ? 'tray' : b.fate === IN_GUTTER ? 'gutter' : 'field' })
  }
  const tracked = new Set(tracks.map((tr) => tr.id))
  const items: Item[] = []
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i]
    if (b.fate !== ON_FIELD || b.state === GONE) continue
    items.push(i < fieldBodies && !tracked.has(b.id) ? { ...field.items[i] } : itemOf(b))
  }
  events.sort((a, b) => a.f - b.f)
  return { step: STEP, frames, pushers: new Float32Array(pushers.slice(0, frames * 2)), tracks, events, after: { v: 1, items, nextId } }
}

/* ---------------- helping the chosen bodies along ---------------- */

function steer(live: Set<Body>, t: number, t0: number, cycles: number, P: number) {
  const tau = t - t0
  const late = tau > (cycles - 1) * P + P / 2 || cycles > 7
  const a = Math.max(strokeAt(tau), late ? 0.35 : 0)
  for (const b of live) {
    b.steerZ = 0
    b.steerX = 0
    if (b.state !== REST || b.fate !== ON_FIELD || tau <= 0) continue
    const lip = b.coin ? LIP : LIP_PRIZE
    // on its way: as fast as it must go to be at the edge by its moment, in time with the push
    const target = b.goAt + (b.coin ? 0.25 : 0.4)
    const left = pushBetween(tau, target - t0)
    const d = b.upper ? distToEdge(b) + 0.4 : FRONT_Z + 0.06 - b.z
    let v = left > 0.05 ? (d / Math.max(0.3, left)) * 1.15 : VMAX
    v = Math.min(late ? VMAX * 1.5 : VMAX, v) * a
    // a prize creeps the last stretch, hangs at the lip, then slides over slowly: the teeter
    if (!b.coin && !b.upper) {
      const toLip = FRONT_Z - lip - b.z
      if (toLip < 0.7) v = Math.min(v, t >= b.goAt ? 0.45 : 0.35 + toLip)
      if (t >= b.goAt && v < 0.3) v = 0.3
    } else if (t >= b.goAt && !b.upper && FRONT_Z - b.z < 0.6) v = Math.max(v, 0.8)
    b.steerZ = Math.max(0.0001, v)
    // pushed and getting nowhere for a good while: it rides up over the bed (a last resort, seldom needed)
    if (a > 0.3 && !b.upper && b.steerZ > 0.25 && (t >= b.goAt || FRONT_Z - lip - b.z > 0.1)) {
      if (b.z - b.stuckZ > 0.04) {
        b.stuckZ = b.z
        b.stuckT = 0
      } else if ((b.stuckT += STEP) > 2) b.rideOver = true
    }
    // keep away from the open sides
    if (Math.abs(b.x) > HALF_W - 1.2 && b.z > GUTTER_Z0 - 1) b.steerX = -Math.sign(b.x) * 0.5
    // a prize in the way (it can't be climbed, and the lip holds it): go round it, to the side with room
    const o = b.squeezeBy
    if (o && !o.coin && o !== b.dodge && o.z > b.z && b.squeeze > 0) {
      b.dodge = o
      const side = b.x >= o.x ? 1 : -1
      const room = (s: number) => HALF_W - 0.3 - s * o.x - (o.ex + 2 * b.ex)
      b.dodgeSide = room(side) > 0 || room(-side) < room(side) ? side : -side
    }
    const q = b.dodge
    if (q) {
      if (q.fate !== ON_FIELD || q.z < b.z || Math.abs(b.x - q.x) > q.ex + b.ex + 0.08) b.dodge = null
      else b.steerX = b.dodgeSide * 1.4
    }
  }
}

/** which coins may slide off the open sides: none once the field is down to its floor (and never a chosen one) */
function gate(w: World, budget: number, push: number) {
  for (const b of w.bodies) {
    if (!b.coin || b.state !== REST || b.fate !== ON_FIELD || b.goAt < Infinity) continue
    b.gutterOk = budget > 0 && b.z > GUTTER_Z0 && Math.abs(b.x) > HALF_W - 1
    // while the field is over its floor, the press of the push squeezes coins at the open sides out over them
    b.steerX = b.gutterOk && push > 0 && (b.squeeze > 0.01 || b.y > 0.06) ? Math.sign(b.x) * 0.7 * push : 0
  }
}

/** the prizes that fell come back: dropped in from above onto the middle of the upper tier, apart from the prizes up there */
function restock(w: World, kinds: ItemKind[], spawn: (k: ItemKind, x: number, y: number, z: number) => Body, events: RunEvent[], frame: number, rng: () => number) {
  const taken: number[] = w.bodies.filter((b) => !b.coin && b.fate === ON_FIELD && b.upper).map((b) => b.x)
  for (const k of kinds) {
    let best = 0
    let bestD = -1
    for (let i = 0; i < 12; i++) {
      const x = -3.6 + (7.2 * i) / 11 + (rng() - 0.5) * 0.3
      const d = taken.reduce((a, q) => Math.min(a, Math.abs(q - x)), 9)
      if (d > bestD) {
        bestD = d
        best = x
      }
    }
    taken.push(best)
    const s = new Body(0, k)
    const b = spawn(k, best, SLOT_Y + 0.4, -6.1 + s.hd * 0.5 + rng() * 1.2)
    b.yaw = (rng() - 0.5) * 0.6
    b.extents()
    b.vy = -0.5
    events.push({ f: frame, kind: 'restock', id: b.id, item: k })
  }
}

/* ---------------- helpers for the scene, the lab and the tests ---------------- */

let shared = new Float32Array(0)
function scratch(n: number) {
  if (shared.length < n) shared = new Float32Array(Math.ceil(n * 1.25))
  return shared
}

/** a track's pose at frame f (clamped to the track), into out: x, y, z, yaw, tiltX, tiltZ */
export function poseOf(tr: Track, f: number, out: number[] | Float32Array) {
  const k = Math.max(tr.from, Math.min(tr.to, Math.round(f))) - tr.from
  for (let c = 0; c < 6; c++) out[c] = tr.data[k * 6 + c]
  return out
}

/** whether a body is on show at frame f (field bodies always, spawned ones from their first frame, fallen ones until gone) */
export const onShow = (tr: Track, f: number) => f >= tr.from && f <= tr.to

/** the counts of each kind a run sends to the tray (always the result's wins) */
export function trayOf(run: Run): Record<ItemKind, number> {
  const c = { silver: 0, gold: 0, gem: 0, bar: 0, idol: 0, crown: 0 }
  for (const tr of run.tracks) if (tr.fate === 'tray') c[tr.kind]++
  return c
}

export { STOCK, isCoin, LIP, LIP_PRIZE }
export type { DropResult }
