import * as THREE from 'three'
import type { Attraction } from './attraction'
import { popScale } from './attraction'
import type { Splats } from './floor'
import { DOOR, FOYER_IN, PAD_H, PLOTS, RING, VAULT_R, spotOf, toWorld } from './layout'
import { canvasTexture, FONT, rng, roundRectPath } from './models'
import { People, POSE, UNIFORM, buildWhale, guestOutfit, type Outfit, type PersonPose, type Pose, type WhaleRig } from './people'

/*
  Everyone on the floor. Guests come in at the entrance, walk the ring of corridors round the plaza to an attraction
  the player owns, stand at it a while (cheering when it pays), move on to another or to the plaza, and in time walk
  out again; the more the casino earns, the more of them there are (setTarget). Managers stand by the attractions
  they run, and the attractions' own staff (dealers, a bartender, the singer, seated players) are drawn from their
  `staff` lists. All of them go through one People batch set.

  The whale (Whale) is a big gentleman in a gold suit: called in (spawn), he strides from the entrance to the front of
  the vault and waits there, a gold ring under him and a "×5" bubble over his head, until he is tipped (a click on
  him, on the way in too: he jumps for joy and leaves) or his time is up (he leaves anyway). His time starts once he
  is at his spot, and the ring and the bubble show through whatever stands in front of him (the entrance arch, as he
  comes in under it), so he is never missed for being hidden.
*/

const MAX_PATH = 16
const WALK = 1.15

interface Guest {
  alive: boolean
  outfit: Outfit
  x: number
  z: number
  yaw: number
  path: Float32Array
  n: number
  k: number
  /** 0 walking to its target, 1 at it, 2 walking out */
  mode: number
  /** the plot it is going to or at, -1 the plaza */
  target: number
  /** the ring node it is nearest when at its target */
  node: number
  wait: number
  clock: number
  speed: number
  ox: number
  oz: number
  /** facing while it stands at its target */
  face: number
}

const _pose: PersonPose = { x: 0, y: 0, z: 0, yaw: 0, pose: POSE.stand, clock: 0, k: 0, scale: 1 }
const _w: [number, number] = [0, 0]
const turnTo = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k)

export class Crowd {
  readonly people: People
  private readonly guests: Guest[]
  private readonly rand = rng(77)
  private target = 0
  private spawnGap = 0
  private owned: readonly number[] = []
  private managers: boolean[] = []
  private readonly hiredAt: number[] = []
  private readonly managerOutfits: Outfit[]
  private readonly cheerAt: number[] = []
  /** the plots guests can visit, kept between frames */
  private readonly open: number[] = []

  constructor(cap: number, staffCap: number) {
    this.people = new People(cap + staffCap + 12)
    this.guests = Array.from({ length: cap }, () => ({
      alive: false,
      outfit: guestOutfit(this.rand),
      x: 0,
      z: 0,
      yaw: 0,
      path: new Float32Array(MAX_PATH * 2),
      n: 0,
      k: 0,
      mode: 0,
      target: -1,
      node: 0,
      wait: 0,
      clock: 0,
      speed: WALK,
      ox: 0,
      oz: 0,
      face: 0,
    }))
    this.managerOutfits = PLOTS.map(() => UNIFORM.manager(this.rand))
    for (let i = 0; i < PLOTS.length; i++) {
      this.hiredAt.push(-9)
      this.cheerAt.push(-9)
    }
  }

  /** how many guests the floor should have */
  setTarget(n: number) {
    this.target = Math.min(this.guests.length, Math.max(0, Math.round(n)))
  }

  /** what the player owns and runs */
  setOwned(owned: readonly number[], managers: readonly boolean[], t: number) {
    this.owned = owned
    for (let i = 0; i < PLOTS.length; i++) {
      const m = managers[i] && owned[i] > 0
      if (m && !this.managers[i]) this.hiredAt[i] = t
      this.managers[i] = m
    }
    this.open.length = 0
    for (let i = 0; i < PLOTS.length; i++) if (owned[i] > 0) this.open.push(i)
  }

  /** plot i paid: its guests, staff and manager cheer (not on every pay of a fast one) */
  cheer(i: number, t: number) {
    if (t - this.cheerAt[i] > 2.2) this.cheerAt[i] = t
  }

  /** appends a point (world x, z) to a guest's path */
  private push(g: Guest, x: number, z: number) {
    if (g.n >= MAX_PATH) return
    g.path[g.n * 2] = x
    g.path[g.n * 2 + 1] = z
    g.n++
  }

  private ringWalk(g: Guest, from: number, to: number) {
    const N = RING.length
    const fwd = (to - from + N) % N
    const step = fwd <= N / 2 ? 1 : -1
    for (let k = from; ; k = (k + step + N) % N) {
      this.push(g, RING[k][0] + g.ox, RING[k][1] + g.oz)
      if (k === to) break
    }
  }

  /** sends a guest from ring node `from` on to a new target (after the path so far, if `keep`) */
  private sendTo(g: Guest, from: number, target: number, keep = false) {
    if (!keep) g.n = 0
    g.k = 0
    g.target = target
    g.mode = 0
    if (target >= 0) {
      const p = PLOTS[target]
      this.ringWalk(g, from, p.anchor)
      spotOf(target, this.rand() * 2 - 1, _w, 0.55 + this.rand() * 0.5)
      this.push(g, _w[0], _w[1])
      g.node = p.anchor
      g.face = p.face === 'x' ? -Math.PI / 2 : Math.PI
    } else {
      // the plaza: somewhere round the vault, near the node it comes from
      const node = from
      const a = Math.atan2(RING[node][1], RING[node][0]) + (this.rand() - 0.5) * 1.1
      const r = VAULT_R + 1.0 + this.rand() * 1.2
      this.push(g, RING[node][0] + g.ox, RING[node][1] + g.oz)
      this.push(g, Math.cos(a) * r, Math.sin(a) * r)
      g.node = node
      g.face = Math.atan2(-Math.cos(a), -Math.sin(a))
    }
    g.wait = 4 + this.rand() * 6
  }

  private leave(g: Guest) {
    g.n = 0
    g.k = 0
    g.mode = 2
    this.ringWalk(g, g.node, 0)
    this.push(g, FOYER_IN[0] + g.ox, FOYER_IN[1] + g.oz)
    this.push(g, DOOR[0] + g.ox, DOOR[1] + g.oz)
  }

  private pick() {
    if (!this.open.length || this.rand() < 0.15) return -1
    return this.open[Math.floor(this.rand() * this.open.length)]
  }

  private spawn() {
    const g = this.guests.find((x) => !x.alive)
    if (!g) return
    g.alive = true
    g.outfit = guestOutfit(this.rand)
    g.ox = (this.rand() - 0.5) * 0.7
    g.oz = (this.rand() - 0.5) * 0.7
    g.x = DOOR[0] + g.ox
    g.z = DOOR[1] + g.oz
    g.yaw = -Math.PI * 0.75
    g.clock = this.rand() * 10
    g.speed = WALK * (0.85 + this.rand() * 0.3)
    // in through the foyer to ring node 0, and on from there
    g.n = 0
    this.push(g, FOYER_IN[0] + g.ox, FOYER_IN[1] + g.oz)
    this.sendTo(g, 0, this.pick(), true)
  }

  /** moves everyone on and draws them (with their shadows); attractions give their staff */
  update(t: number, dt: number, atts: readonly Attraction[], shadows: Splats) {
    // guests come in one by one while there are too few; extras leave when they finish what they're doing
    let alive = 0
    for (let i = 0; i < this.guests.length; i++) if (this.guests[i].alive) alive++
    this.spawnGap -= dt
    if (alive < this.target && this.spawnGap <= 0) {
      this.spawn()
      this.spawnGap = 0.7 + this.rand() * 1.2
    }
    const P = this.people
    P.begin()
    for (let gi = 0; gi < this.guests.length; gi++) {
      const g = this.guests[gi]
      if (!g.alive) continue
      let pose: Pose = POSE.walk
      let k = 1
      if (g.mode === 1) {
        // at its target: watching and cheering, until it moves on (or leaves, if the floor is too full)
        g.wait -= dt
        const cheering = g.target >= 0 && t - this.cheerAt[g.target] < 1.4
        pose = cheering ? POSE.cheer : POSE.stand
        k = cheering ? Math.min(1, (t - this.cheerAt[g.target]) * 6) : 0
        g.yaw = turnTo(g.yaw, g.face, dt * 6)
        if (g.target >= 0 && !(this.owned[g.target] > 0)) g.wait = 0
        if (g.wait <= 0) {
          if (alive > this.target || this.rand() < 0.18) {
            this.leave(g)
            alive--
          } else this.sendTo(g, g.node, this.pick())
        }
      } else {
        const tx = g.path[g.k * 2]
        const tz = g.path[g.k * 2 + 1]
        const dx = tx - g.x
        const dz = tz - g.z
        const d = Math.hypot(dx, dz)
        const step = g.speed * dt
        if (d <= step) {
          g.x = tx
          g.z = tz
          g.k++
          if (g.k >= g.n) {
            if (g.mode === 2) {
              g.alive = false
              continue
            }
            g.mode = 1
          }
        } else {
          g.x += (dx / d) * step
          g.z += (dz / d) * step
          g.yaw = turnTo(g.yaw, Math.atan2(dx, dz), dt * 8)
        }
      }
      g.clock += dt
      _pose.x = g.x
      _pose.y = 0
      _pose.z = g.z
      _pose.yaw = g.yaw
      _pose.pose = pose
      _pose.clock = g.clock
      _pose.k = k
      _pose.scale = 1
      P.put(_pose, g.outfit)
      shadows.put(g.x, 0.012, g.z, 0.3)
    }
    // the managers by the attractions they run
    for (let i = 0; i < PLOTS.length; i++) {
      if (!this.managers[i]) continue
      const a = atts[i]
      toWorld(i, a.managerAt.x, a.managerAt.z, _w)
      const since = t - this.cheerAt[i]
      _pose.x = _w[0]
      _pose.y = 0
      _pose.z = _w[1]
      _pose.yaw = a.managerAt.yaw + PLOTS[i].rot
      _pose.pose = since < 1.4 ? POSE.cheer : POSE.stand
      _pose.k = since < 1.4 ? Math.min(1, since * 6) : 0
      _pose.clock = t + i * 3.1
      _pose.scale = Math.max(0.001, popScale(t - this.hiredAt[i]))
      P.put(_pose, this.managerOutfits[i])
      shadows.put(_w[0], 0.012, _w[1], 0.3 * _pose.scale)
    }
    // the attractions' staff
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i]
      if (a.tier < 0) continue
      const since = t - this.cheerAt[i]
      const s0 = Math.max(0.001, popScale(t - a.built - 0.35))
      for (let si = 0; si < a.staff.length; si++) {
        const s = a.staff[si]
        toWorld(i, s.x, s.z, _w)
        const cheering = s.cheers && since < 1.4
        _pose.x = _w[0]
        _pose.y = PAD_H + s.y
        _pose.z = _w[1]
        _pose.yaw = s.yaw + PLOTS[i].rot
        _pose.pose = cheering && s.pose !== POSE.sit ? POSE.cheer : s.pose
        _pose.k = cheering ? Math.min(1, since * 6) : s.pose === POSE.sit ? 0 : 1
        _pose.clock = t + s.seed
        _pose.scale = s0
        P.put(_pose, s.outfit)
        if (s.pose !== POSE.sit) shadows.put(_w[0], PAD_H + s.y + 0.012, _w[1], 0.28 * s0)
      }
    }
    P.end()
  }

  dispose() {
    this.people.dispose()
  }
}

/* ---------------- the whale ---------------- */

/** where the whale waits: in front of the vault, facing the camera */
const WAIT_AT: [number, number] = [VAULT_R + 1.4, VAULT_R + 1.4]
const WHALE_SCALE = 1.5
/** his stride (units a second): the walk in takes a few seconds, not half his stay */
const WHALE_WALK = 2.2

let bubbleTex: THREE.CanvasTexture | null = null
function bubbleTexture() {
  return (bubbleTex ??= canvasTexture(256, 200, (g) => {
    g.fillStyle = 'rgba(20, 12, 40, 0.3)'
    roundRectPath(g, 18, 22, 222, 128, 44)
    g.fill()
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#22153a'
    g.lineWidth = 9
    roundRectPath(g, 14, 12, 222, 128, 44)
    g.fill()
    g.stroke()
    g.beginPath()
    g.moveTo(108, 136)
    g.lineTo(128, 186)
    g.lineTo(150, 136)
    g.fill()
    g.stroke()
    g.fillStyle = '#ffffff'
    g.fillRect(104, 126, 50, 12)
    const grad = g.createLinearGradient(0, 30, 0, 130)
    grad.addColorStop(0, '#ffcf3a')
    grad.addColorStop(1, '#f08a1c')
    g.fillStyle = grad
    g.font = `800 78px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 8
    g.strokeStyle = '#7a3a0a'
    g.strokeText('×5', 125, 80)
    g.fillText('×5', 125, 80)
  }))
}

export class Whale {
  readonly rig: WhaleRig
  readonly ring: THREE.Mesh
  readonly bubble: THREE.Sprite
  /** off, walking in, waiting, tipped (cheering), walking out */
  state: 'off' | 'in' | 'wait' | 'tipped' | 'out' = 'off'
  x = DOOR[0]
  z = DOOR[1]
  private yaw = 0
  private clock = 0
  private readonly path: [number, number][] = []
  private k = 0
  /** how long he waits once at his spot (s), and until when */
  private stay = 20
  private until = Infinity
  private stateAt = 0
  private onTip?: () => void
  private onMiss?: () => void

  constructor() {
    this.rig = buildWhale()
    this.rig.root.visible = false
    this.rig.root.scale.setScalar(WHALE_SCALE)
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc53a').multiplyScalar(1.5), transparent: true, depthWrite: false, depthTest: false, opacity: 0.8 })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.42, 40), ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.renderOrder = 10
    this.ring.visible = false
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(), depthWrite: false, depthTest: false, transparent: true }))
    this.bubble.scale.set(1.7, 1.3, 1)
    this.bubble.visible = false
    this.bubble.renderOrder = 13
  }

  /** can a click tip him now? */
  get clickable() {
    return this.state === 'in' || this.state === 'wait'
  }

  /** the ms he still waits for a tip (all of his stay while he walks in); 0 when he isn't waiting */
  left(t: number) {
    if (this.state === 'in') return this.stay * 1000
    return this.state === 'wait' ? Math.max(0, this.until - t) * 1000 : 0
  }

  /** where he is, or where he is going while he walks in */
  spot(): readonly [number, number] {
    return this.state === 'in' ? WAIT_AT : [this.x, this.z]
  }

  /** calls him in, to wait `stay` ms once he is at his spot; false if he is already about */
  spawn(t: number, stay: number, onTip?: () => void, onMiss?: () => void) {
    if (this.state !== 'off') return false
    this.state = 'in'
    this.stateAt = t
    this.stay = stay / 1000
    this.until = Infinity
    this.onTip = onTip
    this.onMiss = onMiss
    this.path.length = 0
    this.path.push([FOYER_IN[0], FOYER_IN[1]], [RING[0][0], RING[0][1]], WAIT_AT)
    this.k = 0
    this.x = DOOR[0]
    this.z = DOOR[1]
    this.yaw = -Math.PI * 0.75
    this.rig.root.visible = true
    return true
  }

  /** tips him (a click): true if it counted */
  tip(t: number) {
    if (!this.clickable) return false
    this.state = 'tipped'
    this.stateAt = t
    const cb = this.onTip
    this.onTip = this.onMiss = undefined
    cb?.()
    return true
  }

  /** sends him away at once, without a callback */
  clear() {
    this.state = 'off'
    this.onTip = this.onMiss = undefined
    this.rig.root.visible = this.ring.visible = this.bubble.visible = false
  }

  private walkOut(t: number) {
    this.state = 'out'
    this.stateAt = t
    this.path.length = 0
    this.path.push([RING[0][0], RING[0][1]], [FOYER_IN[0], FOYER_IN[1]], [DOOR[0], DOOR[1]])
    this.k = 0
  }

  update(t: number, dt: number, shadows: Splats) {
    if (this.state === 'off') return
    this.clock += dt
    let walking = false
    if ((this.state === 'in' || this.state === 'out') && this.k < this.path.length) {
      const [tx, tz] = this.path[this.k]
      const dx = tx - this.x
      const dz = tz - this.z
      const d = Math.hypot(dx, dz)
      const step = dt * WHALE_WALK
      if (d <= step) {
        this.x = tx
        this.z = tz
        this.k++
      } else {
        this.x += (dx / d) * step
        this.z += (dz / d) * step
        this.yaw = turnTo(this.yaw, Math.atan2(dx, dz), dt * 5)
        walking = true
      }
      if (this.k >= this.path.length) {
        if (this.state === 'out') {
          this.clear()
          return
        }
        this.state = 'wait'
        this.stateAt = t
        this.until = t + this.stay
      }
    }
    if (this.clickable && t > this.until) {
      const cb = this.onMiss
      this.onTip = this.onMiss = undefined
      cb?.()
      this.walkOut(t)
    }
    if (this.state === 'tipped' && t - this.stateAt > 2.2) this.walkOut(t)
    if (!walking) this.yaw = turnTo(this.yaw, Math.PI / 4, dt * 4)
    // his walk: a waddle; waiting: a happy bounce and a wave of the money bag; tipped: jumping for joy
    const r = this.rig
    const c = this.clock
    let bob = 0
    let sway = 0
    r.legs[0].rotation.x = r.legs[1].rotation.x = 0
    r.arms[0].rotation.set(0, 0, -0.15)
    r.arms[1].rotation.set(0, 0, 0.15)
    if (walking) {
      const w = Math.sin(c * 6)
      r.legs[0].rotation.x = w * 0.45
      r.legs[1].rotation.x = -w * 0.45
      r.arms[0].rotation.x = -w * 0.3
      r.arms[1].rotation.x = w * 0.3
      bob = Math.abs(Math.cos(c * 6)) * 0.06
      sway = Math.sin(c * 6) * 0.08
    } else if (this.state === 'tipped') {
      const j = Math.abs(Math.sin(c * 7))
      bob = j * 0.35
      r.arms[0].rotation.set(0, 0, -2.4 - Math.sin(c * 14) * 0.2)
      r.arms[1].rotation.set(0, 0, 2.4 + Math.sin(c * 14) * 0.2)
      r.legs[0].rotation.x = r.legs[1].rotation.x = -0.3 * j
    } else {
      bob = Math.abs(Math.sin(c * 2.4)) * 0.05
      sway = Math.sin(c * 1.2) * 0.05
      r.arms[1].rotation.set(-0.6 - Math.max(0, Math.sin(c * 3)) * 0.8, 0, 0.5)
    }
    r.root.position.set(this.x, bob, this.z)
    r.root.rotation.set(0, this.yaw, sway)
    const enter = Math.min(1, (t - this.stateAt) * 3)
    const calling = this.clickable
    this.ring.visible = calling
    this.bubble.visible = calling
    if (calling) {
      const pulse = 1 + 0.08 * Math.sin(t * 5)
      this.ring.position.set(this.x, 0.03, this.z)
      this.ring.scale.setScalar(pulse * (this.state === 'wait' ? enter : 1))
      this.bubble.position.set(this.x, 3.95 + Math.sin(t * 3) * 0.1, this.z)
      const s = this.state === 'wait' ? 0.5 + 0.5 * popScale(t - this.stateAt) : 1
      this.bubble.scale.set(1.7 * s, 1.3 * s, 1)
    }
    shadows.put(this.x, 0.012, this.z, 1.1)
  }

  dispose() {
    this.rig.dispose()
    this.ring.geometry.dispose()
    ;(this.ring.material as THREE.Material).dispose()
    ;(this.bubble.material as THREE.Material).dispose()
    bubbleTex?.dispose()
    bubbleTex = null
  }
}
