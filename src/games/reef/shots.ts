import { BULLET_LIFE, MAX_BULLETS } from './rules'
import type { Layout } from './field'
import type { Creature, Swimmers } from './swim'

/*
  Torpedoes in the water. Each one carries the shot it was fired as (its id and its own cost, so changing the cannon
  level mid-flight changes nothing) and flies straight at TORPEDO_SPEED, bouncing off the field's left, right and top
  edges; one that drifts out past the bottom edge, or touches nothing for BULLET_LIFE seconds, fizzles. Each frame
  it moves in short steps so it can't skip through a small fish, and the first creature it touches is its target
  (Swimmers.touching: the stage-1 hit ellipses). A locked torpedo homes on its creature, curving after it, and only
  collides with it; if that creature is caught by something else or leaves, it carries on as a plain torpedo.

  The scene decides what a contact means (the hit, the money, the playback); this only reports it, exactly once per
  torpedo: a contact or a fizzle, unless the scene clears the water first.
*/

/** reef units a second */
const TORPEDO_SPEED = 10
/** a torpedo's collision radius */
const TORPEDO_R = 0.16
/** the longest step a torpedo takes before checking for a hit (well under the smallest fish's half width) */
const STEP = 0.18
/** how fast a locked torpedo can turn after its creature (radians a second) */
const HOMING = 9

export interface Torpedo {
  live: boolean
  /** the shot's id and what it cost, fixed when it was fired */
  shot: number
  cost: number
  /** the cannon level it was fired at (its colour) */
  level: number
  x: number
  y: number
  /** its unit direction */
  dx: number
  dy: number
  age: number
  /** the creature it is locked on (and that creature's uid, so a reused slot doesn't count) */
  lock: Creature | null
  lockUid: number
  /** seconds to its next trail bubble */
  trail: number
}

export class Torpedoes {
  readonly list: Torpedo[] = Array.from({ length: MAX_BULLETS }, () => ({ live: false, shot: 0, cost: 0, level: 0, x: 0, y: 0, dx: 0, dy: 1, age: 0, lock: null, lockUid: 0, trail: 0 }))
  /** how many are in the water */
  count = 0

  /** a torpedo away from (x, y) along a field heading; false when MAX_BULLETS are already in the water */
  fire(shot: number, cost: number, level: number, x: number, y: number, heading: number, lock: Creature | null) {
    let t: Torpedo | null = null
    for (const q of this.list)
      if (!q.live) {
        t = q
        break
      }
    if (!t) return false
    t.live = true
    t.shot = shot
    t.cost = cost
    t.level = level
    t.x = x
    t.y = y
    t.dx = Math.cos(heading)
    t.dy = Math.sin(heading)
    t.age = 0
    t.lock = lock
    t.lockUid = lock ? lock.uid : 0
    t.trail = 0
    this.count++
    return true
  }

  /**
   * Moves every torpedo by dt. `contact(t, c)` is called the moment one touches its target (the torpedo is gone after
   * it), `fizzle(t)` when one gives up, `bounce(t)` when one bounces off an edge.
   */
  update(dt: number, field: Layout, swim: Swimmers, contact: (t: Torpedo, c: Creature) => void, fizzle: (t: Torpedo) => void, bounce: (t: Torpedo) => void) {
    const hw = field.w / 2 - TORPEDO_R
    const hh = field.h / 2 - TORPEDO_R
    for (let ti = 0; ti < this.list.length; ti++) {
      const t = this.list[ti]
      if (!t.live) continue
      t.age += dt
      const lock = t.lock
      if (lock && (!lock.alive || lock.uid !== t.lockUid || lock.mode === 'held')) t.lock = null
      if (t.lock) {
        // curve after the locked creature
        const want = Math.atan2(t.lock.y - t.y, t.lock.x - t.x)
        const now = Math.atan2(t.dy, t.dx)
        const d = Math.atan2(Math.sin(want - now), Math.cos(want - now))
        const a = now + Math.max(-HOMING * dt, Math.min(HOMING * dt, d))
        t.dx = Math.cos(a)
        t.dy = Math.sin(a)
      }
      let left = TORPEDO_SPEED * dt
      let hit: Creature | null = null
      while (left > 0 && !hit) {
        const step = Math.min(STEP, left)
        left -= step
        t.x += t.dx * step
        t.y += t.dy * step
        if (t.x < -hw || t.x > hw) {
          t.x = Math.max(-hw, Math.min(hw, t.x)) * 2 - t.x
          t.dx = -t.dx
          bounce(t)
        }
        if (t.y > hh) {
          t.y = 2 * hh - t.y
          t.dy = -t.dy
          bounce(t)
        }
        hit = swim.touching(t.x, t.y, TORPEDO_R, t.lock)
      }
      if (hit) {
        t.live = false
        this.count--
        contact(t, hit)
      } else if (t.age >= BULLET_LIFE || t.y < -hh - 0.8) {
        t.live = false
        this.count--
        fizzle(t)
      }
    }
  }

  /** every torpedo gone at once, reporting nothing (the screen has squared them up itself) */
  clear() {
    for (const t of this.list) t.live = false
    this.count = 0
  }
}
