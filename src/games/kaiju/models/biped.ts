import * as THREE from 'three'
import type { Body } from './rig'
import type { Mo } from './motion'

/*
  The two-legged skeleton five of the kaiju share (Rexor, Gorrath, Titan-X, Lumina, Bedrock), and how the motion
  channels drive it. Joints: root (at the feet: the whole body turns, falls and squashes about it) → hips → spine →
  chest → neck → head → jaw; shoulders → elbows → wrists on the chest; hips → knees → ankles; an optional tail chain off
  the hips. The legs are solved two-bone IK: each foot goes where the channels put it (planted under the hip, stepped,
  lifted), so a crouch bends the knees with the feet kept on the ground. Each kaiju gives its own proportions and a few
  feel settings (how its arms hang at rest, how far it crouches, how much the head keeps its eyes on the foe while the
  body leans), then adds its own extras (wings, antennae, thrusters) on top in its own apply.
*/

export interface Arm {
  sh: THREE.Bone
  el: THREE.Bone
  wr: THREE.Bone
  side: 1 | -1
}
export interface Leg {
  hip: THREE.Bone
  knee: THREE.Bone
  ankle: THREE.Bone
  side: 1 | -1
}
export interface Biped {
  root: THREE.Bone
  hips: THREE.Bone
  spine: THREE.Bone
  chest: THREE.Bone
  neck: THREE.Bone
  head: THREE.Bone
  jaw: THREE.Bone | null
  /** [left (+x), right (-x)] */
  arms: [Arm, Arm]
  legs: [Leg, Leg]
  tail: THREE.Bone[]
}

/** a biped's proportions, world units */
export interface BipedDims {
  /** the ankle's height over the ground */
  footH: number
  thigh: number
  shin: number
  /** half the gap between the hips */
  hipX: number
  /** hips → spine → chest joints, straight up */
  spine: number
  chest: number
  /** chest → neck and neck → head joints: [up, forward] */
  neck: [number, number]
  head: [number, number]
  /** head → the jaw's hinge: [up, forward]; none for a jawless head */
  jaw?: [number, number]
  /** chest → left shoulder: [out, up, forward] */
  shoulder: [number, number, number]
  upper: number
  fore: number
  /** the tail off the hips: where it starts [up, back], and each segment's [length, drop] */
  tail?: { at: [number, number]; seg: [number, number][] }
}

export interface BipedFeel {
  size: number
  /** the arms' resting angles (added to the channels) */
  arm: { up: number; out: number; bend: number }
  /** how far the hips drop at crouch 1 */
  drop: number
  /** how wide the jaw opens at jaw 1 (radians) */
  jawMax: number
  /** how much of the body's lean the head takes back to keep looking ahead (0 to 1) */
  headK: number
  /** breathing depth */
  breath: number
  /** the tail's idle sway */
  tailSway: number
  /** how far a punch stretches the forearm (cartoon stretch, 0.25 = a quarter) */
  stretch: number
}

export function bipedSkeleton(b: Body, d: BipedDims): Biped {
  const hipY = d.footH + d.thigh + d.shin
  const hips = b.joint('hips', null, 0, hipY, 0)
  const spine = b.joint('spine', hips, 0, d.spine, 0)
  const chest = b.joint('chest', spine, 0, d.chest, 0)
  const neck = b.joint('neck', chest, 0, d.neck[0], d.neck[1])
  const head = b.joint('head', neck, 0, d.head[0], d.head[1])
  const jaw = d.jaw ? b.joint('jaw', head, 0, d.jaw[0], d.jaw[1]) : null
  const arms = ([1, -1] as const).map((side) => {
    const sh = b.joint(side > 0 ? 'shL' : 'shR', chest, side * d.shoulder[0], d.shoulder[1], d.shoulder[2])
    const el = b.joint('elbow', sh, 0, -d.upper, 0)
    const wr = b.joint('wrist', el, 0, -d.fore, 0)
    return { sh, el, wr, side }
  }) as [Arm, Arm]
  const legs = ([1, -1] as const).map((side) => {
    const hip = b.joint(side > 0 ? 'hipL' : 'hipR', hips, side * d.hipX, 0, 0)
    const knee = b.joint('knee', hip, 0, -d.thigh, 0)
    const ankle = b.joint('ankle', knee, 0, -d.shin, 0)
    return { hip, knee, ankle, side }
  }) as [Leg, Leg]
  const tail: THREE.Bone[] = []
  if (d.tail) {
    let parent = b.joint('tail0', hips, 0, d.tail.at[0], -d.tail.at[1])
    tail.push(parent)
    d.tail.seg.forEach(([len, drop], i) => {
      parent = b.joint(`tail${i + 1}`, parent, 0, -drop, -len)
      tail.push(parent)
    })
  }
  return { root: b.root, hips, spine, chest, neck, head, jaw, arms, legs, tail }
}

const q = new THREE.Quaternion()
const qi = new THREE.Quaternion()
const e = new THREE.Euler()
const hipJ = new THREE.Vector3()
const foot = new THREE.Vector3()
const rest = (b: THREE.Bone) => b.userData.rest as THREE.Vector3

/** two-bone IK in the leg's plane: puts the ankle at (dx, dy, dz) from the hip joint, in the hips' frame */
function legIK(l: Leg, d: BipedDims, dx: number, dy: number, dz: number, footPitch: number) {
  const L1 = d.thigh
  const L2 = d.shin
  const roll = Math.atan2(dx, -dy)
  const down = Math.hypot(dx, dy)
  const dist = Math.min(Math.hypot(down, dz), (L1 + L2) * 0.999)
  const a = Math.atan2(dz, down)
  const cosK = (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2)
  const bend = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosK)))
  const cosB = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * Math.max(1e-4, dist))
  const b = Math.acos(Math.min(1, Math.max(-1, cosB)))
  l.hip.rotation.set(-(a + b), 0, roll, 'ZXY')
  l.knee.rotation.set(bend, 0, 0)
  l.ankle.rotation.set(a + b - bend + footPitch, 0, -roll * 0.8)
}

/** sets a biped's joints from the channels */
export function applyBiped(j: Biped, d: BipedDims, f: BipedFeel, m: Mo, time: number) {
  const S = f.size
  const r = j.root
  r.position.set(m.x + m.shake * 0.05 * S * Math.sin(time * 53), m.y, m.z)
  r.rotation.set(m.pitch, m.yaw, m.roll, 'YXZ')
  r.scale.set(1 + m.squash * 0.6, 1 - m.squash, 1 + m.squash * 0.6)

  const breathe = Math.sin(time * 1.7) * m.breath
  const hr = rest(j.hips)
  j.hips.position.set(hr.x, hr.y - m.crouch * f.drop + breathe * 0.03 * S, hr.z)
  j.hips.rotation.set(m.lean * 0.15, m.twist * 0.2, m.bend * 0.3)
  j.spine.rotation.set(m.lean * 0.4, m.twist * 0.4, m.bend * 0.45)
  j.chest.rotation.set(m.lean * 0.35 + breathe * 0.012, m.twist * 0.6, m.bend * 0.35)
  j.chest.scale.set(1 + 0.02 * breathe * f.breath, 1 + 0.01 * breathe * f.breath, 1 + 0.028 * breathe * f.breath)

  // the head takes back part of the lean, so it keeps its eyes on the foe
  const counter = m.lean * 0.9 * f.headK
  const life = m.breath
  j.neck.rotation.set(m.nod * 0.35 - counter * 0.4, m.look * 0.45, 0)
  j.head.rotation.set(m.nod * 0.65 - counter * 0.6 + 0.025 * Math.sin(time * 0.9) * life, m.look * 0.55 + m.shake * 0.07 * Math.sin(time * 41), 0.035 * Math.sin(time * 0.6) * life)
  if (j.jaw) j.jaw.rotation.x = m.jaw * f.jawMax

  for (const a of j.arms) {
    const L = a.side > 0
    const up = (L ? m.lUp : m.rUp) + f.arm.up
    const out = (L ? m.lOut : m.rOut) + f.arm.out
    const bend = (L ? m.lBend : m.rBend) + f.arm.bend
    const tw = L ? m.lTwist : m.rTwist
    const ext = L ? m.lExt : m.rExt
    a.sh.rotation.set(-up, tw * a.side, out * a.side)
    const sr = rest(a.sh)
    a.sh.position.set(sr.x, sr.y + breathe * 0.035 * S * f.breath, sr.z)
    a.el.rotation.set(-bend, 0, 0)
    const st = 1 + ext * f.stretch
    a.el.scale.set(1, st, 1)
    a.wr.scale.set(1, 1 / st, 1)
    a.wr.rotation.set(-0.15 * m.grip, 0, 0)
  }

  // the feet: planted under the hips unless stepped or lifted, found in the hips' frame
  q.setFromEuler(j.hips.rotation)
  qi.copy(q).invert()
  const legLen = d.thigh + d.shin
  for (const l of j.legs) {
    const L = l.side > 0
    const step = L ? m.lStep : m.rStep
    const lift = L ? m.lLift : m.rLift
    hipJ.copy(rest(l.hip)).applyQuaternion(q).add(j.hips.position)
    foot.set(l.side * (d.hipX + m.spread * S), d.footH + lift * legLen * 0.55, step * legLen)
    foot.sub(hipJ).applyQuaternion(qi)
    legIK(l, d, foot.x, foot.y, foot.z, -lift * 0.35 - j.hips.rotation.x)
  }

  const n = j.tail.length
  j.tail.forEach((b, i) => {
    const k = (i + 1) / n
    const sway = m.sway * f.tailSway * Math.sin(time * 1.25 - i * 0.55) * (0.3 + k)
    const wave = m.tWave * 0.3 * Math.sin(time * 7 - i * 0.9)
    e.set((m.tLift / n) * 1.4 + 0.025 * Math.sin(time * 0.8 - i * 0.5) * m.sway, (m.tSide / n) * 1.6 + sway * 0.12 + wave, 0)
    b.rotation.copy(e)
  })
}
