import { memo, useEffect, useState } from 'react'
import { motion, type MotionValue } from 'framer-motion'

/*
  The climber: a cartoon mountaineer in a red jacket, yellow helmet and goggles, with a pack and a coil of rope, drawn
  side-on facing the way they are going (feet at the origin, about 56 units tall, the stage scales it to the camps'
  spacing).

  Every pose is a set of joint angles worked out from the time (anglesOf): two-part legs hinged at hip and knee,
  two-part arms at shoulder and elbow, the head, the body's lean and bob. Each route moves differently: the Trail is
  a stroll with a trekking pole and swinging arms, the Ridge an edge-along with arms out for balance, the Cliff a
  scramble leaning into the rock with hands reaching up in turn, and the Sheer Wall a roped climb, hands overhead and
  feet on the wall. A pitch giving way starts with a teeter (arms windmilling), then the fall is a flail; a camp
  made is a cheer with both arms up. While a pose moves, a requestAnimationFrame loop advances the time and only this
  small figure re-renders; where it is on the mountain (and its spin in a fall) comes from motion values, so moving
  it re-renders nothing.
*/

export type Pose = 'stand' | 'trail' | 'ridge' | 'cliff' | 'wall' | 'teeter' | 'fall' | 'cheer'

const INK = '#141a2b'
const JACKET = '#ff5a3c'
const JACKET_D = '#c63a24'
const PANTS = '#2e3b62'
const BOOT = '#6e4220'
const SKIN = '#ffd0a6'
const HELMET = '#ffd23f'
const PACK = '#ffae1f'
const GLOVE = '#283049'
const LENS = '#5be3ff'
const STEEL = '#cfd5df'

interface Angles {
  lean: number
  bob: number
  hipF: number
  kneeF: number
  hipB: number
  kneeB: number
  shF: number
  elF: number
  shB: number
  elB: number
  head: number
}

/** the joint angles of a pose at time t (s). Facing right: a negative angle swings a limb forward, a positive one back. */
function anglesOf(pose: Pose, t: number): Angles {
  const c = (f: number) => 2 * Math.PI * f * t
  const pos = (v: number) => Math.max(0, v)
  switch (pose) {
    case 'trail': {
      const a = c(1.7)
      const s = Math.sin(a)
      const k = Math.cos(a)
      return { lean: 5, bob: -Math.abs(k) * 1.6, hipF: -26 * s, kneeF: 6 + 30 * pos(k), hipB: 26 * s, kneeB: 6 + 30 * pos(-k), shF: 22 * s - 4, elF: -22, shB: -22 * s, elB: -14, head: -2 }
    }
    case 'ridge': {
      const a = c(1.05)
      const s = Math.sin(a)
      const k = Math.cos(a)
      const sway = Math.sin(c(0.55))
      return { lean: 3 + 6 * sway, bob: -Math.abs(s) * 0.8, hipF: -14 * s - 4, kneeF: 8 + 12 * pos(k), hipB: 14 * s + 4, kneeB: 8 + 12 * pos(-k), shF: -86 + 12 * Math.sin(c(0.55) + 1), elF: -10, shB: 86 - 12 * Math.sin(c(0.55) + 1), elB: 10, head: 6 - 4 * sway }
    }
    case 'cliff': {
      const s = Math.sin(c(2.1))
      return { lean: 30, bob: -Math.abs(s) * 1.2, hipF: -55 + 28 * s, kneeF: 70 - 25 * s, hipB: -15 - 28 * s, kneeB: 45 + 25 * s, shF: -150 + 32 * s, elF: -20, shB: -115 - 32 * s, elB: -25, head: -12 }
    }
    case 'wall': {
      const s = Math.sin(c(1.15))
      return { lean: -2, bob: s * 1.5, hipF: -60 + 22 * s, kneeF: 85 - 25 * s, hipB: -25 - 22 * s, kneeB: 60 + 25 * s, shF: -168 + 16 * s, elF: -20 - 14 * s, shB: -150 - 16 * s, elB: -30 + 14 * s, head: -16 }
    }
    case 'teeter': {
      const s = Math.sin(c(3.2))
      return { lean: 16 * s, bob: 0, hipF: -12 * s, kneeF: 10, hipB: 12 * s, kneeB: 10, shF: -100 + 75 * Math.sin(c(2.6)), elF: -10, shB: 100 + 75 * Math.sin(c(2.6) + 1.6), elB: 10, head: 12 * s }
    }
    case 'fall': {
      const a = c(4.5)
      return { lean: 0, bob: 0, hipF: -50 + 40 * Math.sin(a + 0.6), kneeF: 50 + 30 * Math.sin(a * 1.1), hipB: 35 + 40 * Math.sin(a + 2.2), kneeB: 40 + 30 * Math.sin(a + 1), shF: -150 + 55 * Math.sin(a), elF: -30 + 30 * Math.sin(a * 1.3), shB: 150 + 55 * Math.sin(a + 1.4), elB: 30, head: 15 * Math.sin(a) }
    }
    case 'cheer': {
      const s = Math.sin(c(2.3))
      return { lean: 0, bob: -Math.abs(s) * 5, hipF: -8, kneeF: 10 + 12 * Math.abs(s), hipB: 8, kneeB: 10 + 12 * Math.abs(s), shF: -160 + 14 * s, elF: -10, shB: 160 - 14 * s, elB: 10, head: -8 }
    }
    default:
      return { lean: 0, bob: 0, hipF: -5, kneeF: 4, hipB: 5, kneeB: 4, shF: -16, elF: -18, shB: 10, elB: -6, head: 0 }
  }
}

/** a two-part limb hinged at (x, y): drawn twice, its ink outline first and its colour on top */
function Limb({ x, y, a1, a2, l1, l2, w, color, pass, end }: { x: number; y: number; a1: number; a2: number; l1: number; l2: number; w: number; color: string; pass: 'ink' | 'fill'; end?: React.ReactNode }) {
  const sw = pass === 'ink' ? w + 2.8 : w
  const stroke = pass === 'ink' ? INK : color
  return (
    <g transform={`rotate(${a1.toFixed(1)} ${x} ${y})`}>
      <line x1={x} y1={y} x2={x} y2={y + l1} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <g transform={`rotate(${a2.toFixed(1)} ${x} ${y + l1})`}>
        <line x1={x} y1={y + l1} x2={x} y2={y + l1 + l2} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        {end}
      </g>
    </g>
  )
}

const LEG = { l1: 11, l2: 11, w: 6.2 }
const ARM = { l1: 9.5, l2: 9, w: 5.2 }
const HIP = { x: 0, y: -23 }
const SH = { x: 1, y: -38 }

function Boot({ x, y, pass }: { x: number; y: number; pass: 'ink' | 'fill' }) {
  return pass === 'ink' ? <rect x={x - 3.9} y={y - 2.9} width={11.2} height={6.2} rx={2.6} fill={INK} /> : <rect x={x - 2.5} y={y - 1.6} width={8.6} height={3.8} rx={1.7} fill={BOOT} />
}

function Hand({ x, y, pass, tool }: { x: number; y: number; pass: 'ink' | 'fill'; tool?: 'axe' | 'pole' | null }) {
  if (pass === 'ink') {
    return (
      <>
        {tool === 'axe' && <path d={`M${x} ${y - 3}V${y + 12}M${x - 4.5} ${y + 12.5}L${x + 5.5} ${y + 11}`} stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />}
        {tool === 'pole' && <path d={`M${x} ${y - 2}L${x + 1.5} ${y + 21}`} stroke={INK} strokeWidth={3.4} strokeLinecap="round" />}
        <circle cx={x} cy={y} r={4.1} fill={INK} />
      </>
    )
  }
  return (
    <>
      {tool === 'axe' && (
        <>
          <path d={`M${x} ${y - 3}V${y + 12}`} stroke="#8a5a32" strokeWidth={1.8} strokeLinecap="round" />
          <path d={`M${x - 4.5} ${y + 12.5}L${x + 5.5} ${y + 11}`} stroke={STEEL} strokeWidth={2.2} strokeLinecap="round" />
        </>
      )}
      {tool === 'pole' && <path d={`M${x} ${y - 2}L${x + 1.5} ${y + 21}`} stroke={STEEL} strokeWidth={1.5} strokeLinecap="round" />}
      <circle cx={x} cy={y} r={2.7} fill={GLOVE} />
    </>
  )
}

function Figure({ A, pose }: { A: Angles; pose: Pose }) {
  const tool = pose === 'trail' || pose === 'stand' ? 'pole' : pose === 'wall' || pose === 'cheer' ? null : 'axe'
  const harness = pose === 'wall' || pose === 'cliff'
  const scared = pose === 'teeter' || pose === 'fall'
  const legB = (pass: 'ink' | 'fill') => <Limb {...HIP} a1={A.hipB} a2={A.kneeB} {...LEG} color={PANTS} pass={pass} end={<Boot x={HIP.x} y={HIP.y + LEG.l1 + LEG.l2} pass={pass} />} />
  const legF = (pass: 'ink' | 'fill') => <Limb {...HIP} a1={A.hipF} a2={A.kneeF} {...LEG} color={PANTS} pass={pass} end={<Boot x={HIP.x} y={HIP.y + LEG.l1 + LEG.l2} pass={pass} />} />
  const armB = (pass: 'ink' | 'fill') => <Limb {...SH} a1={A.shB} a2={A.elB} {...ARM} color={JACKET_D} pass={pass} end={<Hand x={SH.x} y={SH.y + ARM.l1 + ARM.l2} pass={pass} />} />
  const armF = (pass: 'ink' | 'fill') => <Limb {...SH} a1={A.shF} a2={A.elF} {...ARM} color={JACKET} pass={pass} end={<Hand x={SH.x} y={SH.y + ARM.l1 + ARM.l2} pass={pass} tool={tool} />} />
  return (
    <g transform={`translate(0 ${A.bob.toFixed(2)}) rotate(${A.lean.toFixed(1)} 0 0)`}>
      {/* the pack and its rope */}
      <rect x={-13.4} y={-41.5} width={8.8} height={17.5} rx={3.2} fill={PACK} stroke={INK} strokeWidth={1.5} />
      <ellipse cx={-9} cy={-29.5} rx={3.4} ry={2.5} fill="none" stroke="#f3ecd9" strokeWidth={1.6} />
      {armB('ink')}
      {armB('fill')}
      {legB('ink')}
      {legB('fill')}
      {/* the jacket */}
      <path d="M-6 -40.5C-8 -33 -7 -26 -5.5 -21L6 -21C7.5 -26 8 -33 6.5 -40.5Q.5 -43.5 -6 -40.5Z" fill={JACKET} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M1.6 -40V-22.5" stroke={JACKET_D} strokeWidth={1.1} />
      <path d="M-5.6 -33.5Q.5 -31.8 6.9 -33.5" stroke="#ff8a6b" strokeWidth={1.2} fill="none" opacity={0.8} />
      {harness && <path d="M-5.8 -24.4H6.4" stroke="#1c2340" strokeWidth={2.6} strokeLinecap="round" />}
      {legF('ink')}
      {legF('fill')}
      {/* the head: helmet, goggles, a face that says how it is going */}
      <g transform={`rotate(${A.head.toFixed(1)} 1.5 -42)`}>
        <circle cx={2.5} cy={-48} r={6.5} fill={SKIN} stroke={INK} strokeWidth={1.5} />
        <path d="M-4.3 -49.4A6.9 6.9 0 0 1 9.5 -49.4L10.5 -48.3H-4.7Z" fill={HELMET} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M-3.4 -48.6H8.6" stroke={GLOVE} strokeWidth={2.2} />
        <circle cx={7.2} cy={-47.4} r={2.4} fill={LENS} stroke={INK} strokeWidth={1.1} />
        <circle cx={7.9} cy={-48.1} r={0.7} fill="#fff" />
        {scared ? <ellipse cx={6.4} cy={-43.6} rx={1.2} ry={1.5} fill="#7a2230" /> : pose === 'cheer' ? <path d="M4.6 -44.6Q6.6 -42.2 8.4 -44.6Z" fill="#7a2230" /> : <path d="M5 -44.2Q6.6 -43.2 8 -44.4" stroke={INK} strokeWidth={1} fill="none" strokeLinecap="round" />}
      </g>
      {armF('ink')}
      {armF('fill')}
    </g>
  )
}

export const Climber = memo(function Climber({ x, y, spin, fade, pose, face, scale }: { x: MotionValue<number>; y: MotionValue<number>; spin: MotionValue<number>; fade: MotionValue<number>; pose: Pose; face: 1 | -1; scale: number }) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (pose === 'stand') return
    let raf = 0
    const t0 = performance.now()
    const loop = (now: number) => {
      setT((now - t0) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [pose])
  const A = anglesOf(pose, pose === 'stand' ? 0 : t)
  return (
    <motion.g style={{ x, y, opacity: fade }}>
      {pose !== 'fall' && pose !== 'wall' && <ellipse cx={0} cy={0.5} rx={10 * scale} ry={2.4 * scale} fill="#000" opacity={0.22} />}
      <motion.g style={{ rotate: spin, originX: '50%', originY: '50%' }}>
        <g transform={`scale(${(face * scale).toFixed(3)} ${scale.toFixed(3)})`}>
          <Figure A={A} pose={pose} />
        </g>
      </motion.g>
    </motion.g>
  )
})
