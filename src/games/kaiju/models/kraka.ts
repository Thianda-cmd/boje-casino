import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { E, both, clipsFor, keyed, set, sweepClip, type Clip, type Mo, type Style } from './motion'
import { COLORS } from './palette'
import { Body, TAU, makeRig, oval, sphere, tube, type Quality } from './rig'
import type { Ell, P3 } from '../../../lib/three/toon'

/*
  Kraka, Terror of the Deep: a kraken that rears up out of the bay on a mass of tentacles. A big purple mantle tilted
  back over a head with two huge eyes (pale, with glowing violet irises and a bar of a pupil) and a dark beak; eight
  thick tentacles splayed round it on the ground, curling at the tips, pink suckers underneath; two long striking
  tentacles with clubbed tips held up in front like a boxer's fists. Bioluminescent spots glow violet all over it.

  Every tentacle is one tube skinned along a chain of five or six joints, so it bends in a smooth curve. The channels
  map: the arms are the two striking tentacles (up 0 hangs, about 1.6 points ahead; bend curls them; grip wraps the
  club; ext straightens and stretches them), crouch lowers the mantle and rearing (crouch below 0) raises it, lean and
  nod tip it, the legs ripple the eight in two alternating groups, the tail channels swish the back pair, curl curls
  every tip, and the idle sway keeps them all slowly writhing. The beak is the jaw. Its special is the Ink Cyclone:
  it rears up high, flings its tentacles wide and whirls.
*/

const C = COLORS.kraka
const SKIN = C.body
const BELLY = C.accent
const DEEP = C.dark

const MANTLE_Y = 4.0
/** the eight leg tentacles round the base, by angle (0 is straight ahead), the front left open for the strikers */
const LEG_ANGLES = [0.85, 1.55, 2.25, 2.85, -2.85, -2.25, -1.55, -0.85]
/** a leg tentacle's joints in its own frame (+z outward): out and down to the ground, the tip curling up */
const LEG_PTS: [number, number][] = [[0, 0], [1.35, -1.3], [2.6, -2.55], [3.8, -3.35], [4.9, -3.6]]
const ARM_SEG = 1.15
const ARM_N = 6

export function buildKraka(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.095, q)
  const mantle = b.joint('mantle', null, 0, MANTLE_Y, 0)

  /* ---- the head, the mantle, the eyes and the beak ---- */
  const headE: Ell = { c: [0, 0.55, 0.25], r: [2.05, 1.55, 1.85] }
  b.ell(mantle, headE.c, headE.r, SKIN, [0, 0, 0], undefined, [24, 16])
  b.ell(mantle, [0, 2.55, -1.05], [1.95, 2.55, 1.85], SKIN, [-0.42, 0, 0], undefined, [24, 18])
  b.ell(mantle, [0, -0.35, 0.3], [1.85, 0.75, 1.65], BELLY, [0, 0, 0], { ink: 0 })
  // fins at the top of the mantle
  for (const s of [1, -1]) b.ell(mantle, [s * 1.55, 4.0, -2.0], [1.0, 0.65, 0.22], DEEP, [0.5, s * 0.5, s * 0.6])
  // ridges over the eyes, the eyes: pale, a glowing iris, a bar of a pupil
  for (const s of [1, -1]) {
    b.ell(mantle, [s * 1.1, 1.62, 1.42], [0.95, 0.34, 0.62], DEEP, [0.2, 0, s * -0.35])
    const eye: Ell = { c: [s * 1.12, 0.92, 1.5], r: [0.8, 0.8, 0.62] }
    b.ell(mantle, eye.c, eye.r, '#f6ecd0', [0, s * 0.4, 0], { ink: 0.08 })
    b.paint(mantle, eye, oval(s * 1.2, 0.92, 0.48, 0.48, 0, 20), C.glow, 0.02, { glow: 1 })
    b.paint(mantle, eye, oval(s * 1.22, 0.92, 0.4, 0.1, 0, 14), '#12061c', 0.04)
    b.paint(mantle, eye, oval(s * 1.02, 1.12, 0.1, 0.1, 0, 8), '#ffffff', 0.05, { flat: true })
  }
  // the glowing spots, scattered over the front and sides of the mantle, set on its surface (they light first)
  const bulb = new THREE.Matrix4().compose(new THREE.Vector3(0, 2.55, -1.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.42, 0, 0)), new THREE.Vector3(1.95, 2.55, 1.85))
  const spots: [number, number, number][] = [[0.15, 0.55, 0.3], [-0.25, 0.4, 0.26], [0.55, 0.2, 0.24], [-0.6, 0.15, 0.26], [0.0, 0.85, 0.22], [0.9, -0.25, 0.2], [-0.95, -0.2, 0.2], [0.2, -0.05, 0.28], [-0.35, 0.7, 0.2], [0.75, 0.6, 0.2]]
  for (const [lon, lat, r] of spots) {
    const n = new THREE.Vector3(Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat))
    const at = n.clone().applyMatrix4(bulb)
    const out = new THREE.Vector3(n.x / 1.95, n.y / 2.55, n.z / 1.85).applyMatrix4(new THREE.Matrix4().extractRotation(bulb)).normalize()
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out), new THREE.Vector3(r, r, r * 0.35))
    b.add(mantle, sphere(q, 10, 8), C.glow, m, { glow: 0.12 + (lat + 0.3) * 0.2 })
  }
  const beak = b.joint('beak', mantle, 0, -0.35, 1.75)
  b.spike(mantle, [0, -0.15, 1.65], [0, -0.55, 2.25], 0.35, '#2a1630', { ink: 0.06 }, 0.3)
  b.spike(beak, [0, -0.1, -0.05], [0, -0.05, 0.5], 0.28, '#3a2040', { ink: 0.06 }, 0.3)
  b.ell(mantle, [0, -0.35, 1.5], [0.42, 0.28, 0.3], '#3a0d2a', [0, 0, 0], { ink: 0, flat: true })

  /* ---- a tentacle: a tube along a chain, suckers underneath, glowing spots on top ---- */
  const tentacle = (chain: THREE.Bone[], r0: number, r1: number, tipOut: number, club: number, order: number) => {
    const pts = chain.map((c) => b.at(c, [0, 0, 0]))
    const a = pts[pts.length - 1]
    const p = pts[pts.length - 2]
    const tip: P3 = [a[0] + (a[0] - p[0]) * tipOut, a[1] + (a[1] - p[1]) * tipOut + 0.15, a[2] + (a[2] - p[2]) * tipOut]
    const radius = (u: number) => r0 + (r1 - r0) * u + club * Math.max(0, Math.sin(((u - 0.72) / 0.28) * Math.PI))
    const t = tube([...pts, tip], radius, q, 30, 12)
    b.bend(chain, t.geo, SKIN)
    b.bend(chain, t.ends[0], SKIN)
    b.bend(chain, t.ends[1], SKIN)
    const v = new THREE.Vector3()
    const tg = new THREE.Vector3()
    const side = new THREE.Vector3()
    const down = new THREE.Vector3()
    const n = q === 'low' ? 5 : 9
    for (let i = 0; i < n; i++) {
      const u = 0.12 + (i / (n - 1)) * 0.8
      t.curve.getPointAt(u, v)
      t.curve.getTangentAt(u, tg)
      side.set(0, 1, 0).cross(tg).normalize()
      down.crossVectors(tg, side).normalize()
      if (down.y > 0) down.negate()
      const r = radius(u)
      const at = v.clone().addScaledVector(down, r * 0.82)
      const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), down.clone().negate()), new THREE.Vector3(r * 0.42, r * 0.18, r * 0.42))
      b.bend(chain, sphere(q, 10, 6), BELLY, m, { ink: 0.04 })
      if (i % 2 === 0) {
        const top = v.clone().addScaledVector(down, -r * 0.9)
        b.bend(chain, sphere(q, 8, 6), C.glow, new THREE.Matrix4().compose(top, new THREE.Quaternion(), new THREE.Vector3(r * 0.3, r * 0.18, r * 0.3)), { glow: order + u * 0.1 })
      }
    }
    return t
  }

  /* ---- eight leg tentacles round the base ---- */
  const legs = LEG_ANGLES.map((angle, i) => {
    const root = b.joint(`leg${i}`, mantle, Math.sin(angle) * 1.55, -0.55, Math.cos(angle) * 1.4)
    root.rotation.set(0, angle, 0, 'YXZ')
    const chain = [root]
    for (let k = 1; k < LEG_PTS.length; k++) {
      const [dz, dy] = [LEG_PTS[k][0] - LEG_PTS[k - 1][0], LEG_PTS[k][1] - LEG_PTS[k - 1][1]]
      chain.push(b.joint(`leg${i}.${k}`, chain[k - 1], 0, dy, dz))
    }
    tentacle(chain, 0.82, 0.16, 0.7, 0, 0.3)
    return { chain, angle, group: i % 2 ? 'b' : 'a', back: Math.abs(angle) > 2.5 }
  })

  /* ---- two striking tentacles in front, clubbed: hanging straight down at rest, like arms ---- */
  const arms = ([1, -1] as const).map((s) => {
    const root = b.joint(s > 0 ? 'armL' : 'armR', mantle, s * 1.1, -0.25, 1.35)
    const chain = [root]
    for (let k = 1; k < ARM_N; k++) chain.push(b.joint(`arm${k}`, chain[k - 1], 0, -ARM_SEG, 0))
    tentacle(chain, 0.62, 0.22, 0.75, 0.42, 0.5)
    const tip = new THREE.Object3D()
    tip.position.set(0, -0.9, 0)
    chain[chain.length - 1].add(tip)
    return { chain, s, tip }
  })

  /* ---- strikers ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, -0.3, 2.3)
  mantle.add(mouth)
  const strikers = [arms[0].tip, arms[1].tip, mouth]

  /* ---- how it moves ---- */
  const g = { crouch: -0.18, lean: 0.12, lUp: 1.35, lOut: 0.38, lBend: 1.7, rUp: 1.35, rOut: 0.38, rBend: 1.7, grip: 0.3, curl: 0.35, nod: 0 }
  const style: Style = { size: 1, mass: 0.55, lead: 'l', guard: g, lieH: 2.2, sinkY: -3.6, mid: 4.2 }
  const base = clipsFor(style)
  const c = g.crouch
  // the heavy: both striking tentacles flung up and slammed down together
  const heavy = keyed(g, [
    [0, {}],
    [0.38, { ...both(3.0, 0.35, 0.9), crouch: -0.45, lean: -0.25, glow: 0.4, curl: 0.7, squash: -0.05 }],
    [0.55, { ...both(1.25, 0.1, -0.35, 1), grip: 0.6, crouch: c + 0.3, lean: 0.45, z: 0.9, squash: 0.1, shake: 0.7, curl: 0.2 }, E.in],
    [0.72, { ...both(1.0, 0.15, -0.2, 0.6), crouch: c + 0.3, lean: 0.4, z: 0.8 }, E.out],
    [1, {}],
  ])
  // the Ink Cyclone: rears up high, flings everything wide and whirls a turn and a half
  const beam = keyed(g, [
    [0, {}],
    [0.28, { crouch: -0.75, lean: -0.2, ...both(2.6, 1.0, 0.7), curl: 1, jaw: 0.6, glow: 1, yaw: -0.4, spread: 0.3, shake: 0.3 }],
    [0.38, { crouch: -0.8, lean: 0.05, ...both(2.2, 1.2, 0.4, 0.4), curl: 1.2, jaw: 1, glow: 1, yaw: 0.6, spread: 0.45, tWave: 1, shake: 0.6 }, E.in],
    [0.86, { crouch: -0.8, lean: 0.05, ...both(2.2, 1.2, 0.4, 0.4), curl: 1.2, jaw: 1, glow: 1, yaw: 1.5 * TAU - 0.3, spread: 0.45, tWave: 1, shake: 0.6 }, E.lin],
    [1, { yaw: 1.5 * TAU }, E.out],
  ])
  const victory: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.crouch = -0.55 + 0.1 * Math.sin(p * 2)
    m.lUp = 2.7 + 0.35 * Math.sin(p * 2)
    m.rUp = 2.7 - 0.35 * Math.sin(p * 2)
    m.lOut = 0.8
    m.rOut = 0.8
    m.lBend = 0.9 + 0.5 * Math.sin(p * 2 + 1)
    m.rBend = 0.9 - 0.5 * Math.sin(p * 2 + 1)
    m.curl = 0.8
    m.jaw = 0.5 + 0.5 * Math.max(0, Math.sin(p))
    m.lean = -0.15
    m.glow = 0.6 + 0.4 * Math.max(0, Math.sin(p))
    m.tWave = 0.8
  }
  const clips = { ...base, heavy, beam, victory, tail: sweepClip(style) }

  /* ---- the channels on the kraken ---- */
  const mantleRest = (mantle.userData.rest as THREE.Vector3).clone()
  const armRest = arms.map((a) => a.chain.map((j) => (j.userData.rest as THREE.Vector3).clone()))
  const apply = (m: Mo, time: number) => {
    const r = b.root
    r.position.set(m.x + m.shake * 0.05 * Math.sin(time * 53), m.y, m.z)
    r.rotation.set(m.pitch, m.yaw, m.roll, 'YXZ')
    r.scale.set(1 + m.squash * 0.6, 1 - m.squash, 1 + m.squash * 0.6)
    const breathe = Math.sin(time * 1.4) * m.breath
    const drop = m.crouch * 1.5
    mantle.position.set(mantleRest.x, mantleRest.y - drop + breathe * 0.06, mantleRest.z)
    mantle.rotation.set(m.lean * 0.6 + m.nod * 0.45, m.twist * 0.6 + m.look * 0.45 + m.shake * 0.05 * Math.sin(time * 41), m.bend * 0.45, 'YXZ')
    mantle.scale.set(1 + breathe * 0.025, 1 + breathe * 0.035, 1 + breathe * 0.025)
    beak.rotation.set(m.jaw * 0.7, 0, 0)
    // the leg tentacles: lifted and swung in two groups, curled at the tips, always slowly writhing
    for (const [i, l] of legs.entries()) {
      const A = l.group === 'a'
      const step = A ? m.lStep : m.rStep
      const lift = A ? m.lLift : m.rLift
      const tail = l.back ? 1 : 0
      const sway = m.sway * Math.sin(time * 1.3 + i * 0.8)
      const wave = tail * m.tWave * Math.sin(time * 6 - i)
      // the base: lifted as the mantle drops (so the tips stay down), raised further to step or splay
      const pitch = -0.1 - m.crouch * 0.42 - lift * 0.5 - m.spread * 0.5 - tail * m.tLift * 0.4 + 0.04 * sway
      l.chain[0].rotation.set(pitch, l.angle + step * 0.35 + tail * m.tSide * 0.2 + 0.05 * sway + wave * 0.15, 0, 'YXZ')
      for (let k = 1; k < l.chain.length; k++) {
        const kk = k / (l.chain.length - 1)
        // positive bends a joint down: the crouch keeps the tentacle flat, the curl lifts the tip off the ground
        const curl = -m.curl * 0.32 * kk * kk + m.crouch * 0.18 * (k === 1 ? 1 : 0) + lift * 0.25 * kk
        l.chain[k].rotation.set(curl + 0.07 * m.sway * Math.sin(time * 1.7 + i + k * 0.9), 0.08 * m.sway * Math.sin(time * 1.1 + i * 1.3 + k * 0.7) + wave * 0.12, 0)
      }
    }
    // the striking tentacles, like arms: up raises the root, bend curls the chain, grip wraps the club
    arms.forEach((a, ai) => {
      const L = a.s > 0
      const up = L ? m.lUp : m.rUp
      const out = L ? m.lOut : m.rOut
      const bend = L ? m.lBend : m.rBend
      const ext = Math.max(0, L ? m.lExt : m.rExt)
      const tw = L ? m.lTwist : m.rTwist
      a.chain[0].rotation.set(-up, tw * a.s, a.s * (out + 0.1))
      const n = a.chain.length - 1
      for (let k = 1; k <= n; k++) {
        const kk = k / n
        const writhe = m.sway * 0.06 * Math.sin(time * 2.1 + k * 0.8 + ai * 2)
        const wrap = k >= n - 1 ? m.grip * 0.55 : 0
        a.chain[k].rotation.set(-(bend / n) * (1 - ext * 0.8) - wrap + writhe, 0.05 * Math.sin(time * 1.6 + k + ai), 0)
        const rest = armRest[ai][k]
        a.chain[k].position.set(rest.x, rest.y * (1 + ext * 0.22) * (1 - 0.03 * kk), rest.z)
      }
    })
  }

  return makeRig({
    id: 'kraka',
    body: b,
    scale: 1.08,
    height: 10,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 1, tail: 1, charge: 2, grab: 0, throw: 1, stomp: 1 },
    glow: { pulse: 1.8, depth: 0.35, crackle: 0.15, base: 1 },
    clips,
    apply,
  })
}
