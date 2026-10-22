import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { applyBiped, bipedSkeleton, type BipedDims, type BipedFeel } from './biped'
import { E, arm, both, clipsFor, keyed, set, sweepClip, type Clip, type Style } from './motion'
import { COLORS } from './palette'
import { Body, T, TAU, makeRig, oval, rbox, sphere, type Quality } from './rig'
import type { Ell } from '../../../lib/three/toon'

/*
  Titan-X, the Iron Sentinel: a blocky fighting mecha. Steel-blue armour plates over a dark gunmetal frame: a broad
  box chest with a red reactor core, huge shoulder plates with yellow hazard trim, a small helmeted head with a dark
  visor and one red eye, a mechanical waist of stacked rings, piston arms ending in square fists, and stout legs on
  big flat feet. Two thrusters on its back glow red. Its forearms are pistons: a punch fires the fist out on a chrome
  rod (the apply below slides the wrist down the forearm instead of stretching it like the living kaiju). It moves
  stiffly, with little breathing, and its special is the Eye Lasers: it braces, levels its head and sweeps the red
  beam from the visor (the mouth object sits on the eye).
*/

const C = COLORS.titan
const STEEL = C.body
const FRAME = C.accent
const CHROME = '#d8e2ee'
const HAZARD = C.extra
const RED = C.glow

const D: BipedDims = {
  footH: 0.75,
  thigh: 2.0,
  shin: 2.0,
  hipX: 1.15,
  spine: 1.15,
  chest: 1.55,
  neck: [1.55, 0.15],
  head: [0.45, 0.1],
  shoulder: [2.05, 0.95, 0],
  upper: 1.75,
  fore: 1.9,
}

export function buildTitan(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.1, q)
  const j = bipedSkeleton(b, D)
  const box = (bone: THREE.Bone, c: [number, number, number], s: [number, number, number], color: string, rot: [number, number, number] = [0, 0, 0], r = 0.18, ink?: number) =>
    b.add(bone, rbox(s[0], s[1], s[2], r, q), color, T(c, rot), ink === undefined ? undefined : { ink })
  const cyl = (bone: THREE.Bone, c: [number, number, number], r: number, h: number, color: string, rot: [number, number, number] = [0, 0, 0], ink?: number) =>
    b.add(bone, new THREE.CylinderGeometry(r, r, h, q === 'low' ? 10 : 18), color, T(c, rot), ink === undefined ? undefined : { ink })
  const lamp = (bone: THREE.Bone, c: [number, number, number], r: number, order: number, rot: [number, number, number] = [0, 0, 0]) => b.add(bone, sphere(q, 12, 8), RED, T(c, rot, [r, r, r * 0.4]), { glow: order })

  /* ---- legs: thigh and shin armour, knee plates with a lamp, big flat feet ---- */
  for (const l of j.legs) {
    const s = l.side
    b.ell(l.hip, [0, 0, 0], [0.62, 0.62, 0.62], FRAME)
    box(l.hip, [s * 0.05, -1.0, 0.05], [1.15, 1.8, 1.25], STEEL, [0, 0, 0], 0.22)
    box(l.hip, [s * 0.6, -1.0, 0.0], [0.15, 1.3, 0.9], FRAME, [0, 0, 0], 0.06, 0.05)
    cyl(l.knee, [0, 0, 0], 0.5, 0.9, FRAME, [0, 0, Math.PI / 2])
    box(l.knee, [0, -1.05, 0.05], [1.2, 1.85, 1.3], STEEL, [0, 0, 0], 0.22)
    box(l.knee, [0, 0.05, 0.6], [0.95, 0.8, 0.35], FRAME, [-0.15, 0, 0], 0.12)
    lamp(l.knee, [0, 0.05, 0.8], 0.16, 0.35)
    // hazard stripes down the shin
    for (const y of [-0.6, -1.0, -1.4]) box(l.knee, [0, y, 0.68], [0.9, 0.12, 0.06], HAZARD, [0.3, 0, 0], 0.02, 0)
    b.ell(l.ankle, [0, 0, 0], [0.45, 0.45, 0.45], FRAME)
    box(l.ankle, [0, -0.45, 0.45], [1.35, 0.6, 2.2], STEEL, [0, 0, 0], 0.2)
    box(l.ankle, [0, -0.62, 1.45], [1.25, 0.4, 0.5], FRAME, [0, 0, 0], 0.12)
    box(l.ankle, [0, -0.62, -0.55], [1.0, 0.36, 0.45], FRAME, [0, 0, 0], 0.12)
  }

  /* ---- pelvis, ringed waist, the box chest with its reactor, vents, hazard collar and thrusters ---- */
  box(j.hips, [0, 0, -0.05], [2.6, 1.0, 1.6], FRAME, [0, 0, 0], 0.25)
  box(j.hips, [0, 0.0, 0.75], [1.2, 0.8, 0.3], STEEL, [0, 0, 0], 0.12)
  for (const y of [0.3, 0.7, 1.05]) b.add(j.spine, new THREE.TorusGeometry(0.95 - y * 0.05, 0.22, q === 'low' ? 6 : 10, q === 'low' ? 14 : 24), FRAME, T([0, y, 0], [Math.PI / 2, 0, 0]))
  cyl(j.spine, [0, 0.6, 0], 0.85, 1.4, '#2a3340')
  box(j.chest, [0, 0.55, 0], [3.3, 2.4, 2.2], STEEL, [0, 0, 0], 0.35)
  box(j.chest, [0, 0.5, 1.05], [2.4, 1.7, 0.3], STEEL, [0, 0, 0], 0.15)
  box(j.chest, [0, -0.55, 0.3], [2.6, 0.7, 1.8], FRAME, [0, 0, 0], 0.2)
  // the reactor: a ring with a red core
  b.add(j.chest, new THREE.TorusGeometry(0.5, 0.13, 8, q === 'low' ? 16 : 28), FRAME, T([0, 0.55, 1.22]))
  b.add(j.chest, new THREE.CircleGeometry(0.42, q === 'low' ? 14 : 24), RED, T([0, 0.55, 1.23]), { glow: 0.6 })
  b.add(j.chest, new THREE.CircleGeometry(0.2, 16), '#ffffff', T([0, 0.55, 1.235]), { glow: 0.65 })
  // vents either side of the core, and the hazard collar
  for (const s of [1, -1]) {
    for (const y of [0.15, 0.4, 0.65, 0.9]) box(j.chest, [s * 0.95, y, 1.22], [0.55, 0.1, 0.06], '#1b222c', [0, 0, 0], 0.03, 0)
    box(j.chest, [s * 0.9, 1.6, 0.6], [1.1, 0.35, 0.7], HAZARD, [0.3, 0, s * -0.2], 0.1)
    for (const k of [0, 1, 2]) box(j.chest, [s * (0.55 + k * 0.32), 1.62, 0.96], [0.12, 0.3, 0.05], '#1b222c', [0.3, 0, s * -0.2 - 0.5], 0.02, 0)
  }
  // the backpack and its two thrusters
  box(j.chest, [0, 0.5, -1.25], [2.3, 2.0, 0.8], FRAME, [0, 0, 0], 0.22)
  for (const s of [1, -1]) {
    b.add(j.chest, new THREE.CylinderGeometry(0.42, 0.6, 1.0, q === 'low' ? 10 : 18, 1, true), '#2a3340', T([s * 0.65, -0.1, -1.6], [0.25, 0, 0]))
    b.add(j.chest, new THREE.CircleGeometry(0.45, 18), RED, T([s * 0.65, -0.58, -1.47], [Math.PI / 2 + 0.25, 0, 0]), { glow: 0.3 })
  }

  /* ---- neck and head: helmet, dark visor with one red eye, antenna and fins ---- */
  cyl(j.neck, [0, -0.2, 0], 0.55, 0.9, FRAME)
  box(j.head, [0, 0.45, 0], [1.3, 1.0, 1.2], STEEL, [0, 0, 0], 0.28)
  box(j.head, [0, 0.95, -0.1], [0.4, 0.3, 1.1], FRAME, [0, 0, 0], 0.1)
  const helm: Ell = { c: [0, 0.45, 0.0], r: [0.68, 0.52, 0.64] }
  b.add(j.head, rbox(1.12, 0.32, 0.2, 0.08, q), '#0d1219', T([0, 0.5, 0.58]), { ink: 0.04 })
  b.paint(j.head, helm, oval(0, 0.5, 0.42, 0.07, 0, 16), RED, 0.03, { glow: 1 })
  b.paint(j.head, helm, oval(0.12, 0.5, 0.12, 0.09, 0, 12), '#ffffff', 0.045, { glow: 1 })
  box(j.head, [0, 0.05, 0.42], [0.9, 0.3, 0.45], FRAME, [0, 0, 0], 0.1)
  for (const s of [1, -1]) {
    box(j.head, [s * 0.72, 0.5, -0.1], [0.18, 0.55, 0.8], FRAME, [0, 0, 0], 0.06)
    box(j.head, [s * 0.72, 0.85, -0.45], [0.14, 0.6, 0.35], HAZARD, [-0.5, 0, s * 0.15], 0.05)
  }
  cyl(j.head, [0.45, 1.4, -0.25], 0.05, 1.0, CHROME, [0, 0, 0], 0.03)
  lamp(j.head, [0.45, 1.92, -0.25], 0.1, 0.9)

  /* ---- arms: shoulder plates, frame upper arms, piston forearms, square fists ---- */
  for (const a of j.arms) {
    const s = a.side
    b.ell(a.sh, [0, 0, 0], [0.62, 0.62, 0.62], FRAME)
    box(a.sh, [s * 0.25, 0.35, 0], [1.75, 1.0, 1.85], STEEL, [0, 0, s * -0.25], 0.3)
    box(a.sh, [s * 0.35, 0.82, 0], [1.4, 0.18, 1.5], HAZARD, [0, 0, s * -0.25], 0.06)
    lamp(a.sh, [s * 0.9, 0.42, 0.93], 0.13, 0.45)
    cyl(a.sh, [0, -D.upper / 2, 0], 0.42, D.upper - 0.3, FRAME)
    box(a.sh, [0, -D.upper / 2, 0], [0.95, 1.1, 0.95], STEEL, [0, 0, 0], 0.2)
    cyl(a.el, [0, 0, 0], 0.42, 0.85, FRAME, [0, 0, Math.PI / 2])
    box(a.el, [0, -0.85, 0.05], [1.15, 1.55, 1.15], STEEL, [0, 0, 0], 0.22)
    box(a.el, [s * 0.6, -0.85, 0.05], [0.14, 1.1, 0.7], FRAME, [0, 0, 0], 0.05, 0.05)
    for (const y of [-0.45, -0.85, -1.25]) box(a.el, [0, y, 0.62], [0.7, 0.1, 0.06], HAZARD, [0, 0, 0], 0.02, 0)
    // the piston rod rides with the fist and reaches up into the forearm, so it shows when the fist fires out
    cyl(a.wr, [0, 0.75, 0], 0.26, 1.6, CHROME, [0, 0, 0], 0.05)
    box(a.wr, [0, -0.5, 0.05], [1.2, 1.1, 1.2], STEEL, [0, 0, 0], 0.25)
    box(a.wr, [0, -0.85, 0.6], [1.1, 0.35, 0.3], FRAME, [0, 0, 0], 0.1)
    box(a.wr, [0, -0.15, 0.0], [1.3, 0.25, 1.3], FRAME, [0, 0, 0], 0.08)
  }

  /* ---- strikers ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, 0.5, 0.75)
  j.head.add(mouth)
  const fist = (a: (typeof j.arms)[number]) => {
    const o = new THREE.Object3D()
    o.position.set(0, -1.0, 0.3)
    a.wr.add(o)
    return o
  }
  const foot = new THREE.Object3D()
  foot.position.set(0, -0.7, 0.9)
  j.legs[1].ankle.add(foot)
  const strikers = [fist(j.arms[0]), fist(j.arms[1]), foot]

  /* ---- how it moves ---- */
  const g = { crouch: 0.12, lean: 0.06, lUp: 0.75, lOut: 0.18, lBend: 1.35, rUp: 0.75, rOut: 0.18, rBend: 1.35, nod: 0 }
  const style: Style = { size: 1, mass: 0.8, lead: 'l', guard: g, lieH: 1.25, sinkY: -5.2, mid: 5.5 }
  const feel: BipedFeel = { size: 1, arm: { up: 0.08, out: 0.16, bend: 0.15 }, drop: 1.5, jawMax: 0, headK: 0.85, breath: 0.25, tailSway: 0, stretch: 0 }
  const base = clipsFor(style)
  const c = g.crouch
  // a rocket punch: it draws back, the thrusters flare, and the fist fires out on its piston
  const heavy = keyed(g, [
    [0, {}],
    [0.38, { twist: -0.65, ...arm('r', 1.2, 0.2, 2.0), ...arm('l', 1.1, 0.2, 1.3), lean: -0.15, crouch: c + 0.22, glow: 0.6, squash: -0.04 }],
    [0.55, { twist: 0.6, ...arm('r', 1.6, 0.0, 0.0, 1), ...arm('l', 0.6, 0.35, 1.4), lean: 0.35, crouch: c + 0.3, z: 1.5, glow: 1, squash: 0.08, shake: 0.6 }, E.in],
    [0.72, { twist: 0.55, ...arm('r', 1.55, 0.0, 0.05, 0.8), lean: 0.32, crouch: c + 0.28, z: 1.4, glow: 0.6 }, E.out],
    [1, {}],
  ])
  // the Eye Lasers: it braces, levels its head and sweeps the beam a little side to side
  const beamK = keyed(g, [
    [0, {}],
    [0.28, { crouch: c + 0.3, lean: -0.08, ...both(0.4, 0.55, 1.1), nod: -0.12, glow: 1, squash: -0.02, shake: 0.2 }],
    [0.38, { crouch: c + 0.34, lean: 0.12, ...both(0.35, 0.6, 1.0), nod: 0.04, glow: 1, z: -0.2, shake: 0.5 }, E.out],
    [0.86, { crouch: c + 0.34, lean: 0.12, ...both(0.35, 0.6, 1.0), nod: 0.04, glow: 1, z: -0.1, shake: 0.5 }, E.lin],
    [1, {}],
  ])
  const beam: Clip = (m, t) => {
    beamK(m, t)
    if (t > 0.38 && t < 0.86) m.look = 0.16 * Math.sin(((t - 0.38) / 0.48) * TAU)
  }
  // the taunt: a double flex, the reactor pulsing
  const taunt = keyed(g, [
    [0, {}],
    [0.2, { ...both(0.25, 1.35, 1.9), lTwist: -1.2, rTwist: -1.2, lean: -0.08, crouch: c + 0.1, nod: -0.1, look: 0.25, glow: 0.8 }],
    [0.45, { ...both(0.3, 1.4, 2.1), lTwist: -1.3, rTwist: -1.3, lean: -0.1, crouch: c + 0.14, nod: -0.15, look: -0.25, glow: 0.4, squash: 0.03 }],
    [0.7, { ...both(0.25, 1.35, 1.9), lTwist: -1.2, rTwist: -1.2, lean: -0.08, crouch: c + 0.1, nod: -0.1, look: 0.2, glow: 1 }],
    [1, {}],
  ])
  // the win: both fists pumping, the thrusters lifting it off the ground in little hops
  const victory: Clip = (m, t) => {
    base.victory(m, t)
    const p = t * TAU
    m.y = 0.45 + 0.35 * Math.sin(p * 2)
    m.glow = 0.7 + 0.3 * Math.sin(p * 2)
    m.jaw = 0
    m.nod = -0.25
    m.lExt = 0.5 + 0.5 * Math.max(0, Math.sin(p * 2))
    m.rExt = 0.5 + 0.5 * Math.max(0, -Math.sin(p * 2))
  }
  // stiff, mechanical steps
  const walk: Clip = (m, t) => {
    base.walk(m, t)
    m.bend *= 0.3
    m.twist *= 0.5
    m.lUp = g.lUp + (m.lUp - g.lUp) * 0.5
    m.rUp = g.rUp + (m.rUp - g.rUp) * 0.5
  }
  const idle: Clip = (m, t) => {
    set(m, g)
    // a servo's settle every few seconds instead of breathing
    const p = t * TAU
    m.look = 0.12 * Math.sign(Math.sin(p)) * Math.min(1, Math.abs(Math.sin(p)) * 4)
    m.crouch += 0.02 * Math.sin(p * 2)
    m.lUp += 0.04 * Math.sin(p)
    m.rUp -= 0.04 * Math.sin(p)
  }
  const clips = { ...base, idle, walk, heavy, beam, taunt, victory, tail: sweepClip(style) }

  // the piston: punches slide the wrist down the forearm rather than stretching it
  const wristRest = j.arms.map((a) => (a.wr.userData.rest as THREE.Vector3).clone())
  const apply = (m: Parameters<typeof applyBiped>[3], time: number) => {
    applyBiped(j, D, feel, m, time)
    j.arms.forEach((a, i) => {
      const ext = a.side > 0 ? m.lExt : m.rExt
      a.el.scale.set(1, 1, 1)
      a.wr.scale.set(1, 1, 1)
      a.wr.position.set(wristRest[i].x, wristRest[i].y - Math.max(0, ext) * 1.15, wristRest[i].z)
    })
  }

  return makeRig({
    id: 'titan',
    body: b,
    scale: 1.12,
    height: 12.5,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 1, tail: 1, charge: 0, grab: 0, throw: 1, stomp: 2 },
    glow: { pulse: 3.2, depth: 0.12, crackle: 0, base: 1 },
    clips,
    apply,
  })
}
