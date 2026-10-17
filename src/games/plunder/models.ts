import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { T, VKit, ellipsePts, surfaceZ, type Ell, type P2, type P3 } from '../../lib/three/toon'
import { C, INK, MOUTH, SHINE, TAU, V, arc, ballEye, blush, capSurf, capsule, curve2, domeEyes, ellSurf, flatShape, happyEyes, inked, joint, lathe, limb, morphTo, mul, openMouth, oval, paint, part, path3, restOf, rope, rrect, shade, slab, smile, smooth, sphere, star, stroke, tint, toRest, tubeR, warp, type Eye, type Surf } from './kit'
import { castMaterial, clothMaterial, haloMaterial, releaseMaterials } from './mats'
import { releaseLabels, wildMaterial } from './labels'
import { releaseShip } from './ship'
import {
  BEAK,
  BEAK_LO,
  BONE,
  BRASS,
  BRASS_D,
  MACAW_B,
  RED,
  ROPE_A,
  ROPE_B,
  TONGUE_C,
  TOOTH_GOLD,
  W_INK,
  along,
  bicorne,
  clothDecal,
  clothGeo,
  facingUp,
  flatDecal,
  frameAt,
  latheSurf,
  macawWing,
  meshAt,
  partAt,
  stripPts,
  waveCloth,
} from './pieces'
import type { Sym } from './rules'
import { SYMBOL_COLOR } from './meta'

/*
  The Plunder Bay cast, Captain Polly and the ship, modelled in code in the site's toon style: flat tones through a
  four-step ramp and a dark ink outline (an inverted hull merged into the same mesh), like Pop Party and Robo Riot.
  Pieces are VKit meshes (colour per vertex), so a symbol draws in 2 to 4 calls and stays under about 5k triangles.
  This module is the one entry point for the scene: everything it needs is exported from here.

  Symbols (grid pieces, in the clipped materials)
  - buildSymbol(sym): a light copy sharing geometry and materials with every other. It fits a 0.9 × 0.9 box centred
    on the origin, faces +z and is about ±0.2 deep. Scale it to the cell (about 1.05 × min(cellW, cellH)); keep it
    uniform, a 7-row reel just gets smaller pieces. userData = { sym, seed }; copies can be cloned again.
  - poseSymbol(o, t, win): call every frame for a piece on show. t is the scene clock (s); win 0..1 blends from the
    idle (sways, blinks, the compass needle hunting, the cork wiggling) to the win dance (the joy face from 0.4: happy
    eyes and an open mouth; wings, claws, fins and tails going, the needle spinning, the cork popping). It resets the
    named parts first, so drive the piece's own root (drop, squash, scale) freely.
  - PARTS[sym]: the named moving parts (each keeps its rest pose in userData.rest; toRest() puts it back).
  - setUnroll(o, t): the treasure map, rolled up (0) to open (1); the X shows once open. One morph target.
  - allMaterials(): the grid materials, to clip to the reel window (castMaterial, clothMaterial, haloMaterial and the
    WILD lettering). symbolMaterials(o): one model's materials.
  - warmUp(): builds every prototype ahead of time (then compileAsync the scene).
  The wild's cloth waves in its shader, out of step from cell to cell (the phase follows its position), so it also
  flutters as it falls. The map glows (a halo sprite); its X pulses.

  The clock: tickModels(t) once per frame with the scene clock (cloth waving, gold shine on the medallion and loot).

  Captain Polly (host.ts): buildHost() → HostRig (origin between her feet, 1 unit tall, faces +z; wingR is the wing on
  the right of the screen); poseHost(rig, t, action, k, phase) runs her idle and the actions 'squawk', 'point',
  'cheer', 'dig', 'spyglass' and 'gasp' blended by k. rig.bubble is the speech bubble's anchor, rig.beakTip the beak.

  The stage (ship.ts, stage materials, never clipped):
  - buildFrame({ w, h, cols }): the carved frame round a w × h reel window centred on the origin (rope, brass
    straps, compass bosses, lantern hooks, sea-blue planks per reel, slats between them) with the ways plaque on top:
    rig.ways.set(ways | text) redraws only on change, rig.plaque to pulse it, rig.perch for Polly's feet, rig.hooks
    for lanterns, rig.size for layout.
  - buildMedallion(): the Treasure Hunt multiplier, a gold doubloon on a MULTIPLIER ribbon: set(n), stamp with
    root.scale, flip coin.rotation.y, glow.material.opacity.
  - buildLantern() + setLanternGlow(v, flicker): every lantern's glass, flame and halo, 0 by day, 1 at night.
  - buildGull() + flapGull(g, t, rate, glide): one mesh, a morph target beats the wings; faces +x.
  - Deck kit: buildDeck(w, d), buildRail(w), buildMast(h) (a billowing sail and a Jolly Roger, both waving),
    buildBarrel(), buildCrate(), buildCannon(), buildChest() (lid hinge, gold loot), buildHelm() (wheel turns),
    buildRopeCoil(), and coinGeometry() for instanced coin showers in goldMaterial().
  - Text: new GoldLabel(w, h, text) is a plane of engraved gold lettering for win amounts and stamps (set(text),
    dispose()); goldText(ctx, ...) draws the same lettering on any canvas of your own.

  Disposal: the scene frees what it built (frame.ways.dispose(), medallion.dispose(), disposeTree() on the frame,
  host, lanterns and deck pieces; never on symbol copies), then releaseModels() frees every cached material,
  texture and prototype geometry here. The prototypes stay built, so the next visit only uploads them again.

  Lighting the cast was tuned under: DirectionalLight('#fff4e0', 2) at (-3, 5, 6), AmbientLight('#d8e8ff', 0.95),
  NeutralToneMapping at 1.05 exposure (as Pop Party). Shines and lamps are flat colours above 1 and bloom.
*/

const mat = () => castMaterial()

/* ---------------- Captain Polly ---------------- */

function buildCaptain() {
  const k = new VKit(INK, W_INK)
  const head: Ell = { c: [0, 0.075, 0], r: [0.165, 0.155, 0.15] }
  const hf = ellSurf(head)
  const body: Ell = { c: [0, -0.165, -0.02], r: [0.15, 0.165, 0.135] }
  k.add(sphere(15, 11), RED, T(head.c, [0, 0, 0], head.r))
  k.add(sphere(12, 10), RED, T(body.c, [0, 0, 0], body.r))
  // a lighter breast
  paint(k, ellSurf(body), oval(0.012, -0.19, 0.088, 0.105), '#ff7a63', 0.003, false, undefined, 2)
  // the folded wing on her left, hanging at her side
  macawWing(k, frameAt([-0.105, -0.065, 0.05], V(-0.22, -1, 0.05), true, -0.55), 0.24, 0.068, 3)
  // tail feathers peeking out below
  limb(k, [0.0, -0.28, -0.07], [0.05, -0.43, -0.06], 0.028, MACAW_B, 0.015)
  limb(k, [0.03, -0.27, -0.05], [0.12, -0.41, -0.04], 0.025, RED, 0.015)
  // feet gripping
  for (const s of [-1, 1]) k.add(new THREE.SphereGeometry(1, 7, 4), '#a693a8', T([s * 0.07, -0.33, 0.07], [0, 0, 0], [0.04, 0.017, 0.034]), 0.012)
  // the white face patches round the eyes, with little feather lines
  for (const s of [-1, 1]) paint(k, hf, oval(s * 0.07, 0.092, 0.07, 0.064, s * 0.2), '#fff2ea', 0.002, false, undefined, 2)
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) stroke(k, hf, [[s * (0.05 + i * 0.022), 0.045 - i * 0.004], [s * (0.055 + i * 0.022), 0.034 - i * 0.004]], 0.006, 0.004, '#e8877a', 0.3, false)
  // the eyepatch and its strap
  paint(k, hf, oval(-0.072, 0.094, 0.055, 0.049, -0.15), INK, 0.004, true, undefined, 2)
  paint(k, hf, oval(-0.088, 0.108, 0.017, 0.01, -0.5), '#51476d', 0.006, true)
  stroke(k, hf, [[-0.035, 0.128], [0.03, 0.165], [0.1, 0.2]], 0.014, 0.004, INK, 0.1)
  stroke(k, hf, [[-0.122, 0.085], [-0.162, 0.072]], 0.014, 0.004, INK, 0.1)
  // the cocky brow over the open eye
  stroke(k, hf, [[0.034, 0.156], [0.076, 0.17], [0.114, 0.156]], 0.017, 0.006, INK, 0.25)
  // the upper beak: a fat hook curling down over the lower one
  const up = tubeR(path3([[0, 0.05, 0.085], [0, 0.065, 0.16], [0, 0.035, 0.205], [0, -0.012, 0.215], [0, -0.048, 0.19]]), (t) => 0.052 * Math.pow(1 - t, 0.7) + 0.004, 10, 9)
  up.applyMatrix4(T([0, 0, 0], [0, 0, 0], [1.08, 1, 1]))
  k.add(up, BEAK)
  k.add(new THREE.SphereGeometry(1, 6, 4), SHINE, T([-0.024, 0.074, 0.168], [0.6, 0.3, 0.25], [0.008, 0.022, 0.004]), 0, true)
  // the hat, at a jaunty tilt
  bicorne(k, T([0.0, 0.198, 0.0], [-0.08, 0, -0.12]))
  const root = new THREE.Group()
  root.add(k.mesh('body', mat()))
  // the open eye
  const e = new VKit(INK, W_INK)
  const eyes: Eye[] = [{ x: 0.072, y: 0.094, rx: 0.047, ry: 0.055, look: [-0.12, 0.02], pupil: 0.62 }]
  root.add(part(e, 'eyes', domeEyes(e, hf, eyes), mat()))
  // the joy face: a happy ^ eye
  const j = new VKit(INK, W_INK)
  happyEyes(j, hf, eyes, 0.008, 0.018)
  const joy = j.mesh('joy', mat())
  joy.visible = false
  root.add(joy)
  // the lower beak, which opens to squawk
  const lo = new VKit(INK, W_INK)
  const lb = tubeR(path3([[0, 0.012, 0.09], [0, -0.016, 0.15], [0, -0.03, 0.172]]), (t) => 0.04 * (1 - t) + 0.01, 8, 9)
  lo.add(lb, BEAK_LO)
  lo.add(new THREE.SphereGeometry(0.022, 8, 6), TONGUE_C, T([0, -0.004, 0.14]), 0)
  root.add(part(lo, 'beak', [0, 0.025, 0.1], mat()))
  // the raised wing, waving
  const w = new VKit(INK, W_INK)
  const sh: P3 = [0.115, -0.085, 0.04]
  macawWing(w, frameAt(sh, V(0.62, 0.78, 0.1), false, 0.2), 0.27, 0.075, 4)
  root.add(part(w, 'wing', sh, mat()))
  root.rotation.y = -0.12
  return root
}

/* ---------------- Finn the Shark ---------------- */

const SHARK = SYMBOL_COLOR.shark
const SHARK_D = '#2f86e8'
const BELLY = '#eef7ff'
const BANDANA = '#e8344a'

/** a grin's two edges across the face: the top lip and the bottom, both curving down to the middle */
const grinTop = (x: number, w: number, y0: number, d: number) => y0 - d * (1 - (x / w) ** 2)
function buildShark() {
  const k = new VKit(INK, W_INK)
  const body: Ell = { c: [0, -0.03, 0], r: [0.255, 0.215, 0.19] }
  const bf = ellSurf(body)
  k.add(sphere(16, 12), SHARK, T(body.c, [0, 0, 0], body.r))
  // the white jaw and belly
  const jaw: P2[] = [...arc(0, -0.06, 0.2, 0.13, Math.PI * 1.03, Math.PI * 1.97, 16)]
  for (let i = 0; i <= 10; i++) {
    const x = 0.2 - (0.4 * i) / 10
    jaw.push([x, grinTop(x, 0.24, -0.04, 0.035) + 0.012])
  }
  paint(k, bf, jaw, BELLY, 0.003, false, [0, -0.12], 4)
  // the grin: a dark crescent with a row of teeth along the top and two at the bottom
  const W = 0.165
  const top = (x: number) => grinTop(x, W * 1.15, -0.035, 0.04)
  const bot = (x: number) => -0.05 - 0.085 * Math.max(0, 1 - (x / W) ** 2) ** 0.8
  const xs = Array.from({ length: 15 }, (_, i) => -W + (2 * W * i) / 14)
  const mouth: P2[] = [...xs.map((x): P2 => [x, top(x)]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, bot(x)])]
  inked(k, bf, mouth, MOUTH, 0.004, 0.009, true, [0, -0.08])
  paint(k, bf, oval(0.03, -0.115, 0.06, 0.022), TONGUE_C, 0.006, true)
  const nT = 7
  for (let i = 0; i < nT; i++) {
    const x0 = -W * 0.86 + (i * 1.72 * W) / nT
    const x1 = x0 + (1.72 * W) / nT
    const xm = (x0 + x1) / 2
    paint(k, bf, [[x0, top(x0) - 0.002], [xm, top(xm) - 0.034 * (1 - 0.35 * Math.abs(xm / W))], [x1, top(x1) - 0.002]], i === 4 ? TOOTH_GOLD : '#ffffff', 0.007, true, undefined, 1)
  }
  for (const x0 of [-0.07, 0.04]) paint(k, bf, [[x0, bot(x0) + 0.003], [x0 + 0.03, bot(x0 + 0.03) + 0.003], [x0 + 0.015, bot(x0 + 0.015) + 0.028]], '#ffffff', 0.007, true, undefined, 1)
  // gill slits and a shine
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) stroke(k, bf, arc(s * (0.2 + i * 0.016), -0.02, 0.02, 0.045, s < 0 ? -0.6 : Math.PI - 0.6, s < 0 ? 0.6 : Math.PI + 0.6, 5), 0.008, 0.004, '#1d5fb8', 0.3, false)
  paint(k, bf, oval(-0.13, 0.11, 0.05, 0.018, 0.55), SHINE, 0.003, true, undefined, 1)
  // the dorsal fin, poking through the bandana
  const fin: P2[] = [[-0.075, 0], [0.085, 0], [0.05, 0.06], [0.0, 0.13], [-0.045, 0.175], [-0.06, 0.12], [-0.07, 0.06]]
  k.add(slab(fin, 0.05, 0.012, 2), SHARK_D, T([0.0, 0.14, -0.02], [0, -0.55, 0]))
  // the bandana: a red cap over the top of the head, white polka dots, knotted at the side
  const capM = T([0, -0.03, 0], [-0.36, 0, 0.1], [0.266, 0.228, 0.202])
  k.add(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.38), BANDANA, capM)
  const nm = new THREE.Matrix3().getNormalMatrix(capM)
  for (let i = 0; i < 11; i++) {
    const th = 0.2 + 0.85 * ((i * 0.618) % 1) * 0.55
    const ph = Math.PI * (0.18 + (0.64 * i) / 10)
    const u = V(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph))
    const n = u.clone().applyMatrix3(nm).normalize()
    const p = u.applyMatrix4(capM).addScaledVector(n, 0.002)
    if (p.z < 0.03) continue
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n)
    k.add(new THREE.SphereGeometry(1, 6, 4), '#ffffff', new THREE.Matrix4().compose(p, q, V(0.02, 0.02, 0.004)), 0, false)
  }
  // the knot and its two tails, out to the right
  k.add(new THREE.SphereGeometry(1, 8, 6), BANDANA, T([0.235, 0.13, 0.0], [0, 0, 0], [0.04, 0.034, 0.034]), 0.014)
  for (const [a, l] of [
    [-0.35, 0.11],
    [0.25, 0.1],
  ]) {
    const tail: P2[] = [[0, -0.022], [l * 0.55, -0.03], [l, -0.008], [l * 0.92, 0.02], [l * 0.5, 0.026], [0, 0.02]]
    k.add(slab(tail, 0.016, 0.006, 2), BANDANA, T([0.25, 0.13, 0.0], [0, -0.3, a]), 0.014)
  }
  k.add(sphere(10, 8), SHARK_D, T([-0.29, -0.13, 0.04], [0, 0, 0.65], [0.1, 0.042, 0.03]))
  // the brows: cheeky, angled down to the middle
  for (const s of [-1, 1]) stroke(k, bf, [[s * 0.03, 0.1], [s * 0.085, 0.126], [s * 0.13, 0.12]], 0.02, 0.008, INK, 0.25)
  const root = new THREE.Group()
  root.add(k.mesh('body', mat()))
  const eyes: Eye[] = [-1, 1].map((s) => ({ x: s * 0.082, y: 0.052, rx: 0.048, ry: 0.056, look: [0.18, 0.05] as P2, pupil: 0.6 }))
  const e = new VKit(INK, W_INK)
  root.add(part(e, 'eyes', domeEyes(e, bf, eyes), mat()))
  const j = new VKit(INK, W_INK)
  happyEyes(j, bf, eyes, 0.008, 0.019)
  // the big open laugh, over the grin
  const om: P2[] = [...xs.map((x): P2 => [x * 1.06, top(x) + 0.006]), ...xs.slice(1, -1).reverse().map((x): P2 => [x * 1.06, -0.05 - 0.13 * Math.max(0, 1 - (x / W) ** 2) ** 0.7])]
  inked(j, bf, om, MOUTH, 0.012, 0.01, true, [0, -0.1])
  paint(j, bf, oval(0.0, -0.15, 0.075, 0.03), TONGUE_C, 0.014, true)
  for (let i = 0; i < nT; i++) {
    const x0 = -W * 0.9 + (i * 1.8 * W) / nT
    const x1 = x0 + (1.8 * W) / nT
    const xm = (x0 + x1) / 2
    paint(j, bf, [[x0, top(x0) + 0.002], [xm, top(xm) - 0.03], [x1, top(x1) + 0.002]], i === 4 ? TOOTH_GOLD : '#ffffff', 0.015, true, undefined, 1)
  }
  const joy = j.mesh('joy', mat())
  joy.visible = false
  root.add(joy)
  // the tail fin behind, on the left, and a pectoral fin on the right that waves
  const t = new VKit(INK, W_INK)
  const tail: P2[] = [[0, -0.035], [0.08, -0.02], [0.17, -0.11], [0.15, -0.02], [0.2, 0.11], [0.08, 0.03], [0, 0.035]]
  t.add(slab(tail, 0.045, 0.012, 2), SHARK_D, T([-0.2, -0.05, -0.1], [0, 0.4, Math.PI - 0.5]))
  root.add(part(t, 'tail', [-0.2, -0.05, -0.1], mat()))
  const f = new VKit(INK, W_INK)
  f.add(sphere(10, 8), SHARK_D, T([0.29, -0.13, 0.04], [0, 0, -0.65], [0.1, 0.042, 0.03]))
  root.add(part(f, 'fin', [0.22, -0.09, 0.04], mat()))
  root.rotation.y = 0.1
  return root
}

/* ---------------- Coco the Monkey ---------------- */

const FUR = SYMBOL_COLOR.monkey
const FUR_D = '#9c6233'
const SKIN = '#f8d2a4'
const NAVY = '#24346e'

function buildMonkey() {
  const k = new VKit(INK, W_INK)
  const head: Ell = { c: [0, 0.1, 0], r: [0.15, 0.138, 0.13] }
  const hf = ellSurf(head)
  k.add(sphere(13, 10), FUR, T(head.c, [0, 0, 0], head.r))
  // big round ears, pink-peach inside
  for (const s of [-1, 1]) {
    const ear: Ell = { c: [s * 0.162, 0.12, -0.015], r: [0.066, 0.066, 0.032] }
    k.add(sphere(9, 6), FUR, T(ear.c, [0, s * 0.35, 0], ear.r))
    paint(k, (x, y) => surfaceZ(ear, x, y) + 0.004, oval(s * 0.165, 0.12, 0.042, 0.044), '#f2b68a', 0.002, false, undefined, 2)
  }
  // the face mask: round around the eyes, wide over the muzzle
  for (const s of [-1, 1]) paint(k, hf, oval(s * 0.052, 0.128, 0.062, 0.066, s * 0.15), SKIN, 0.002, false, undefined, 2)
  paint(k, hf, oval(0, 0.06, 0.1, 0.062), SKIN, 0.002, false, undefined, 2)
  const muz: Ell = { c: [0, 0.048, 0.085], r: [0.088, 0.058, 0.062] }
  const mf = ellSurf(muz)
  k.add(sphere(11, 8), SKIN, T(muz.c, [0, 0, 0], muz.r))
  for (const s of [-1, 1]) paint(k, mf, oval(s * 0.016, 0.07, 0.008, 0.006, s * 0.4), FUR_D, 0.003, true, undefined, 1)
  // the cheeky lopsided grin, one tooth showing
  smile(k, mf, { x: 0.008, y: 0.04, w: 0.05, h: 0.022 }, 0.004, 0.011)
  paint(k, mf, [[0.0, 0.019], [0.022, 0.019], [0.02, 0.003], [0.002, 0.003]], '#ffffff', 0.005, true, undefined, 1)
  stroke(k, mf, [[0.05, 0.05], [0.064, 0.058]], 0.009, 0.004)
  blush(k, hf, [[-0.1, 0.06], [0.1, 0.06]], 0.024, 0.014, '#ff9a8a')
  // the hair tuft
  for (const [x, a, l] of [
    [-0.03, 0.5, 0.06],
    [0.0, 0.1, 0.075],
    [0.03, -0.35, 0.06],
  ])
    limb(k, [x, 0.22, 0.0], [x - Math.sin(a) * l, 0.22 + Math.cos(a) * l, 0.01], 0.016, FUR_D, 0.013)
  // the sailor shirt: navy and white rings
  // navy and white rings, each exactly two rows of the sphere, so the stripes stay straight
  const shirt = tint(new THREE.SphereGeometry(1, 10, 12), (_x, y) => (Math.floor((Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * 6) % 2 ? C(NAVY) : C('#ffffff')))
  k.add(shirt, '#ffffff', T([0, -0.16, -0.005], [0, 0, 0], [0.125, 0.13, 0.105]))
  // the red neckerchief
  k.add(slab([[-0.06, 0.0], [0.06, 0.0], [0.0, -0.06]], 0.016, 0.008, 2), '#ef3b3b', T([0, -0.05, 0.09], [-0.3, 0, 0]), 0.012)
  // legs and feet
  for (const s of [-1, 1]) {
    limb(k, [s * 0.06, -0.24, 0.0], [s * 0.075, -0.32, 0.02], 0.034, FUR)
    k.add(sphere(7, 4), SKIN, T([s * 0.085, -0.345, 0.05], [0, 0, 0], [0.042, 0.022, 0.05]), 0.014)
  }
  // the left arm, on the hip
  limb(k, [-0.1, -0.1, 0.0], [-0.17, -0.18, 0.03], 0.03, FUR)
  limb(k, [-0.17, -0.18, 0.03], [-0.11, -0.23, 0.07], 0.028, FUR)
  k.add(sphere(7, 5), SKIN, T([-0.1, -0.235, 0.08], [0, 0, 0], 0.03), 0.014)
  const root = new THREE.Group()
  root.add(k.mesh('body', mat()))
  const eyes: Eye[] = [-1, 1].map((s) => ({ x: s * 0.052, y: 0.13, rx: 0.039, ry: 0.047, look: [0.25, 0.08] as P2, pupil: 0.62 }))
  const e = new VKit(INK, W_INK)
  root.add(part(e, 'eyes', domeEyes(e, hf, eyes), mat()))
  const j = new VKit(INK, W_INK)
  happyEyes(j, hf, eyes, 0.008, 0.016)
  openMouth(j, mf, { x: 0.005, y: 0.045, w: 0.05, h: 0.045 }, 0.008, true)
  const joy = j.mesh('joy', mat())
  joy.visible = false
  root.add(joy)
  // the right arm, up, waving a banana
  const a = new VKit(INK, W_INK)
  const sh: P3 = [0.1, -0.09, 0.0]
  limb(a, sh, [0.2, -0.02, 0.04], 0.03, FUR)
  limb(a, [0.2, -0.02, 0.04], [0.24, 0.09, 0.05], 0.028, FUR)
  a.add(sphere(7, 5), SKIN, T([0.245, 0.11, 0.05], [0, 0, 0], 0.032), 0.014)
  const ban = tubeR(path3([[0.2, 0.1, 0.07], [0.25, 0.17, 0.08], [0.33, 0.2, 0.08], [0.39, 0.17, 0.07]]), (t) => 0.026 * Math.sin(Math.PI * (0.08 + t * 0.84)) ** 0.6 + 0.004, 10, 7)
  a.add(ban, '#ffe14d')
  a.add(new THREE.SphereGeometry(0.009, 5, 3), '#6b4a1f', T([0.392, 0.168, 0.07]), 0.006)
  limb(a, [0.195, 0.095, 0.07], [0.18, 0.075, 0.07], 0.008, '#8a6a2a', 0.006)
  root.add(part(a, 'arm', sh, mat()))
  // the curly tail, behind
  const t = new VKit(INK, W_INK)
  const tp: P3[] = []
  for (let i = 0; i <= 14; i++) {
    const u = i / 14
    if (u < 0.55) tp.push([-0.08 - u * 0.36, -0.25 + u * 0.16, -0.09])
    else {
      const a2 = ((u - 0.55) / 0.45) * Math.PI * 1.6
      tp.push([-0.29 - Math.sin(a2) * 0.05, -0.16 + (1 - Math.cos(a2)) * 0.05, -0.09])
    }
  }
  t.add(tubeR(path3(tp), (u) => 0.022 - 0.008 * u, 14, 6), FUR)
  root.add(part(t, 'tail', [-0.08, -0.25, -0.09], mat()))
  root.rotation.y = -0.1
  return root
}

/* ---------------- Pinch the Crab ---------------- */

const CRAB = SYMBOL_COLOR.crab
const CRAB_D = '#e8642a'
const CRAB_L = '#ffb47a'
const CRAB_TIP = '#a83a22'

/**
 * A big pincer claw on c, opening upwards like a C: a fat round palm and two thick curved fingers whose darker tips
 * nearly meet at the top. `s` mirrors it; `gap` opens it.
 */
function claw(k: VKit, c: P3, s: number, gap = 0.035) {
  const palm: Ell = { c, r: [0.088, 0.078, 0.062] }
  k.add(sphere(9, 7), CRAB, T(c, [0, 0, s * 0.2], palm.r))
  const tipC = C(CRAB_TIP)
  for (const sd of [-1, 1]) {
    const x0 = c[0] + sd * 0.045
    const y0 = c[1] + 0.035
    const fat = sd === s ? 1 : 0.85
    const pts: P3[] = [
      [x0, y0, c[2]],
      [c[0] + sd * 0.075, c[1] + 0.1, c[2] + 0.005],
      [c[0] + sd * 0.05, c[1] + 0.165, c[2] + 0.01],
      [c[0] + sd * (gap * 0.5), c[1] + 0.185, c[2] + 0.01],
    ]
    const g = tubeR(path3(pts), (t) => (0.042 * Math.pow(1 - t, 0.8) + 0.007) * fat, 7, 6)
    const base = C(sd === s ? CRAB : CRAB_D)
    k.add(tint(g, (_x, y) => (y > c[1] + 0.15 ? tipC : base)), '#ffffff')
  }
  paint(k, ellSurf(palm), oval(c[0] - 0.03, c[1] + 0.02, 0.018, 0.034, -0.3), SHINE, 0.003, true, undefined, 1)
}

function buildCrab() {
  const k = new VKit(INK, W_INK)
  const body: Ell = { c: [0, -0.1, 0], r: [0.235, 0.14, 0.15] }
  const bf = ellSurf(body)
  k.add(sphere(14, 10), CRAB, T(body.c, [0, 0, 0], body.r))
  for (const [x, y, r] of [
    [-0.15, -0.04, 0.02],
    [0.13, -0.02, 0.024],
    [-0.06, 0.005, 0.015],
    [0.17, -0.1, 0.016],
  ])
    paint(k, bf, oval(x, y, r, r * 0.8), CRAB_L, 0.002, false, undefined, 1)
  paint(k, bf, oval(-0.1, -0.0, 0.05, 0.018, 0.3), SHINE, 0.003, true, undefined, 1)
  // the mouth: a little grin, and cheeks
  smile(k, bf, { x: 0, y: -0.07, w: 0.05, h: 0.024 }, 0.004, 0.012)
  blush(k, bf, [[-0.1, -0.09], [0.1, -0.09]], 0.026, 0.015, '#ff5a6a')
  // legs: three a side, each one bent tube that tapers to a point
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      // front leg lowest, the back ones higher and further out, so all three read
      const z = 0.04 - i * 0.05
      const pts: P3[] = [
        [s * (0.12 + i * 0.045), -0.15 + i * 0.02, z],
        [s * (0.23 + i * 0.06), -0.15 + i * 0.045, z],
        [s * (0.29 + i * 0.07), -0.22 + i * 0.055, z],
        [s * (0.27 + i * 0.085), -0.33 + i * 0.07, z],
      ]
      k.add(tubeR(path3(pts), (t) => 0.027 * (1 - t) + 0.007, 6, 6), i === 1 ? CRAB : CRAB_D, undefined, 0.014)
    }
  // the eye stalks
  for (const s of [-1, 1]) limb(k, [s * 0.06, -0.0, 0.03], [s * 0.085, 0.12, 0.03], 0.02, CRAB)
  const root = new THREE.Group()
  root.add(k.mesh('body', mat()))
  // the eyes on their stalks; the joy face is the same balls with happy arcs
  const e = new VKit(INK, W_INK)
  for (const s of [-1, 1]) ballEye(e, [s * 0.088, 0.165, 0.035], 0.058, [0.12, -0.05], 0.6)
  root.add(part(e, 'eyes', [0, 0.165, 0.035], mat()))
  const j = new VKit(INK, W_INK)
  for (const s of [-1, 1]) {
    j.add(new THREE.SphereGeometry(1, 10, 7), '#ffffff', T([s * 0.088, 0.165, 0.035], [0, 0, 0], 0.058), 0.009)
    happyEyes(j, ellSurf({ c: [s * 0.088, 0.165, 0.035], r: [0.058, 0.058, 0.058] }), [{ x: s * 0.088, y: 0.165, rx: 0.036, ry: 0.04 }], 0.003, 0.014)
  }
  openMouth(j, bf, { x: 0, y: -0.066, w: 0.055, h: 0.05 }, 0.008)
  const joy = j.mesh('joy', mat())
  joy.visible = false
  root.add(joy)
  // claws: arms up, the right one gripping a tiny cutlass
  for (const s of [-1, 1]) {
    const c = new VKit(INK, W_INK)
    const sh: P3 = [s * 0.19, -0.08, 0.02]
    const elbow: P3 = [s * 0.28, -0.04, 0.05]
    limb(c, sh, elbow, 0.029, CRAB_D)
    limb(c, elbow, [s * 0.29, 0.03, 0.06], 0.026, CRAB_D)
    const cc: P3 = [s * 0.29, 0.09, 0.06]
    claw(c, cc, s, s > 0 ? 0.05 : 0.03)
    if (s > 0) {
      // the cutlass: a broad curved silver blade rising out of the pincer, a gold knuckle bow and a brown grip
      const blade: P2[] = [[-0.016, 0], [0.016, 0], [0.038, 0.09], [0.046, 0.18], [0.03, 0.25], [0.012, 0.19], [-0.002, 0.09]]
      const m = T([0.3, 0.21, 0.09], [0, 0, -0.42])
      c.add(slab(blade, 0.012, 0.005, 2), '#eef3fb', m, 0.013)
      c.add(flatShape(stripPts([[0.008, 0.03], [0.024, 0.17]], 0.008), 0.0125), SHINE, m, 0, true)
      c.add(flatShape(stripPts([[-0.008, 0.02], [0.004, 0.12]], 0.005), 0.0125), '#9fb0cc', m, 0, true)
      c.add(new THREE.TorusGeometry(0.032, 0.009, 5, 10, Math.PI), TOOTH_GOLD, mul(m, T([0.0, -0.006, 0], [0, 0, Math.PI])), 0.011)
      c.add(capsule(0.013, 0.05), '#7a4524', mul(m, T([0, -0.04, 0])), 0.011)
      c.add(new THREE.SphereGeometry(0.017, 6, 4), TOOTH_GOLD, mul(m, T([0, -0.076, 0])), 0.011)
    }
    root.add(part(c, s < 0 ? 'clawL' : 'clawR', sh, mat()))
  }
  return root
}

/* ---------------- low symbols ---------------- */

// a light, bright steel so the anchor stands out on the navy reels (even dimmed behind a win), with brass fittings
const STEEL = '#cfe0f5'
const STEEL_D = '#93a9cc'

/** Anchor: a chunky bright-steel anchor with a brass ring, collar and stock ends, a rope looped through its ring, and
 *  a face on the shank */
function buildAnchor() {
  const k = new VKit(INK, W_INK)
  // the shank, wide enough for a face
  const SX = 1.3
  k.add(capsule(0.06, 0.44), STEEL, T([0, 0.03, 0], [0, 0, 0], [SX, 1, 0.9]))
  const sf = capSurf([0, 0.25, 0], [0, -0.19, 0], 0.06)
  const face: Surf = (x, y) => sf(x / SX, y) * 0.9
  // a darker steel edge down each side of the shank, so it reads as round
  for (const s of [-1, 1]) stroke(k, face, [[s * 0.066, 0.24], [s * 0.07, 0.03], [s * 0.066, -0.17]], 0.014, 0.003, STEEL_D, 0.3, false)
  // the brass ring at the top and a brass collar under the stock
  k.add(new THREE.TorusGeometry(0.064, 0.022, 6, 14), BRASS, T([0, 0.35, 0], [0, 0.35, 0]))
  k.add(new THREE.CylinderGeometry(0.084, 0.084, 0.04, 14), BRASS, T([0, 0.155, 0], [0, 0, 0], [1, 1, 0.75]), 0.014)
  // the stock: a crossbar with brass ball ends
  k.add(capsule(0.03, 0.32), STEEL_D, T([0, 0.205, 0.0], [0, 0, Math.PI / 2]))
  for (const s of [-1, 1]) k.add(sphere(9, 6), TOOTH_GOLD, T([s * 0.19, 0.205, 0], [0, 0, 0], 0.043))
  // the arms: a curve from fluke to fluke under the crown, arrowhead flukes at the ends
  const R = 0.25
  const cy = 0.02
  k.add(new THREE.TorusGeometry(R, 0.044, 7, 18, Math.PI * 0.8), STEEL, T([0, cy, 0], [0, 0, Math.PI * 1.1]))
  for (const s of [-1, 1]) {
    const a = Math.PI * 1.5 + s * Math.PI * 0.4
    const p: P3 = [Math.cos(a) * R, cy + Math.sin(a) * R, 0]
    const dir = s > 0 ? [-Math.sin(a), Math.cos(a)] : [Math.sin(a), -Math.cos(a)]
    const fl: P2[] = [[-0.065, -0.035], [0.0, 0.095], [0.065, -0.035], [0.0, -0.01]]
    k.add(slab(fl, 0.05, 0.012, 2), STEEL, T(p, [0, 0, Math.atan2(dir[1], dir[0]) - Math.PI / 2]), W_INK)
  }
  k.add(sphere(12, 9), STEEL, T([0, -0.235, 0], [0, 0, 0], 0.06))
  // the rope: through the ring, down the right over the stock, across the shank under the face, off the left arm
  const r = path3([
    [-0.01, 0.36, 0.0],
    [0.07, 0.32, 0.04],
    [0.12, 0.24, 0.06],
    [0.14, 0.1, 0.07],
    [0.09, -0.04, 0.09],
    [0.0, -0.085, 0.1],
    [-0.1, -0.075, 0.09],
    [-0.15, -0.14, 0.08],
    [-0.16, -0.25, 0.08],
  ])
  k.add(rope(r, 0.017, ROPE_A, ROPE_B, 10, 36, 5), '#ffffff')
  k.add(new THREE.SphereGeometry(0.019, 6, 4), ROPE_B, T([-0.16, -0.255, 0.08]), 0.012)
  // shine and cheeks on the shank
  stroke(k, face, [[-0.052, 0.25], [-0.058, 0.15]], 0.016, 0.004, SHINE)
  blush(k, face, [[-0.05, 0.035], [0.05, 0.035]], 0.019, 0.011, '#ff8fa8')
  smile(k, face, { x: 0, y: 0.035, w: 0.028, h: 0.015 }, 0.005, 0.011)
  const swing = new THREE.Group()
  swing.add(k.mesh('body', mat()))
  const eyes: Eye[] = [-1, 1].map((s) => ({ x: s * 0.036, y: 0.09, rx: 0.03, ry: 0.036, look: [0.0, 0.1] as P2, pupil: 0.62 }))
  const e = new VKit(INK, W_INK)
  swing.add(part(e, 'eyes', domeEyes(e, face, eyes), mat()))
  const j = new VKit(INK, W_INK)
  happyEyes(j, face, eyes, 0.007, 0.013)
  openMouth(j, face, { x: 0, y: 0.04, w: 0.032, h: 0.032 }, 0.009)
  const joy = j.mesh('joy', mat())
  joy.visible = false
  swing.add(joy)
  const root = new THREE.Group()
  root.add(joint('swing', [0, 0.35, 0], swing))
  return root
}

const DIAL = '#fff3d6'

/** Compass: a round brass pocket compass with a ring on top, a red needle that turns, and a face on the dial */
function buildCompass() {
  const k = new VKit(INK, W_INK)
  const R = 0.27
  const zf = 0.05
  k.add(new THREE.CylinderGeometry(R, R * 0.97, 0.09, 28), BRASS_D, T([0, -0.01, 0], [Math.PI / 2, 0, 0]))
  k.add(new THREE.TorusGeometry(R - 0.012, 0.032, 8, 32), BRASS, T([0, -0.01, zf - 0.012]))
  k.add(new THREE.TorusGeometry(0.046, 0.017, 6, 14), BRASS, T([0, 0.315, 0]))
  k.add(new THREE.CylinderGeometry(0.034, 0.04, 0.05, 10), BRASS_D, T([0, 0.268, 0]))
  // the dial: cream, a ring of ticks, a faint rose and a red N marker
  const fz: Surf = () => 0.046
  const cy = -0.01
  paint(k, fz, ellipsePts(0, cy, R - 0.03, R - 0.03, 32), DIAL, 0.001, false, [0, cy], 1, Infinity)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU
    const r0 = R - 0.045
    const r1 = i % 4 ? R - 0.062 : R - 0.078
    stroke(k, fz, [[Math.cos(a) * r0, cy + Math.sin(a) * r0], [Math.cos(a) * r1, cy + Math.sin(a) * r1]], i % 4 ? 0.007 : 0.011, 0.003, i % 4 ? '#c9a46a' : '#8a6a3a', 0)
  }
  paint(k, fz, star(0, cy, 0.17, 0.035, 4), '#f1dfb4', 0.002, true, [0, cy], 1, Infinity)
  paint(k, fz, star(0, cy, 0.11, 0.025, 4, Math.PI / 4), '#ead3a0', 0.0025, true, [0, cy], 1, Infinity)
  paint(k, fz, [[0, cy + R - 0.045], [-0.025, cy + R - 0.1], [0.025, cy + R - 0.1]], '#e8343c', 0.004, true, undefined, 1, Infinity)
  // the glass glint
  stroke(k, fz, arc(0, cy, R - 0.06, R - 0.06, Math.PI * 0.62, Math.PI * 0.86, 8), 0.022, 0.012, C('#ffffff', 1.3))
  for (const s of [-1, 1]) paint(k, fz, oval(s * 0.12, cy - 0.04, 0.028, 0.016, 0, 14), '#ffb0a0', 0.004, false, undefined, 1, Infinity)
  smile(k, fz, { x: 0, y: cy - 0.085, w: 0.04, h: 0.02 }, 0.005, 0.012)
  const root = new THREE.Group()
  root.add(k.mesh('body', mat()))
  const face: Surf = () => 0.058
  const eyes: Eye[] = [-1, 1].map((s) => ({ x: s * 0.088, y: cy + 0.055, rx: 0.036, ry: 0.044, look: [0.0, 0.05] as P2, pupil: 0.6 }))
  const e = new VKit(INK, W_INK)
  root.add(part(e, 'eyes', domeEyes(e, face, eyes), mat()))
  const j = new VKit(INK, W_INK)
  happyEyes(j, face, eyes, 0.008, 0.015)
  openMouth(j, fz, { x: 0, y: cy - 0.075, w: 0.045, h: 0.04 }, 0.007)
  const joy = j.mesh('joy', mat())
  joy.visible = false
  root.add(joy)
  // the needle: red north, silver south, on a brass cap; it turns about the middle of the dial
  const n = new VKit(INK, 0.012)
  const L = 0.2
  n.add(slab([[0, L], [-0.026, 0], [0.026, 0]], 0.012, 0.004, 2), '#ff4a4a', T([0, cy, zf + 0.012]))
  n.add(slab([[0, -L * 0.8], [0.026, 0], [-0.026, 0]], 0.012, 0.004, 2), '#e9eefa', T([0, cy, zf + 0.012]))
  n.add(new THREE.SphereGeometry(1, 10, 6), BRASS, T([0, cy, zf + 0.02], [0, 0, 0], [0.024, 0.024, 0.014]), 0.01)
  const needle = part(n, 'needle', [0, cy, zf], mat())
  needle.rotation.z = -0.45
  needle.userData.rest = restOf(needle)
  root.add(needle)
  return root
}

const LEATHER = SYMBOL_COLOR.spyglass
const SPY_D = new THREE.Vector3(0.58, 0.4, 0.71).normalize()
const SPY_S = 1.3

/** Spyglass: a brass telescope in purple leather, pointing out at you, with a big eye looking out through the lens */
function buildSpyglass() {
  const M = along(SPY_D, [-0.01, -0.035, 0]).multiply(T([0, 0, 0], [0, 0, 0], SPY_S))
  const k = new VKit(INK, W_INK)
  // the barrel: purple leather, two brass bands, a flared brass hood round the lens
  k.add(lathe([[0.0, 0.0], [0.086, 0.0], [0.088, 0.12], [0.092, 0.25]], 16), LEATHER, undefined, W_INK)
  for (const y of [0.045, 0.2]) k.add(new THREE.TorusGeometry(0.091, 0.016, 6, 18), BRASS, T([0, y, 0], [Math.PI / 2, 0, 0]))
  k.add(lathe([[0.0, 0.236], [0.094, 0.236], [0.112, 0.29], [0.118, 0.31], [0.104, 0.315], [0.0, 0.315]], 16), BRASS)
  const lens = new VKit(INK, W_INK)
  const lensAt = (z: number): Surf => (x, y) => z + 0.02 * Math.max(0, 1 - (x * x + y * y) / 0.0098)
  paint(lens, lensAt(0), ellipsePts(0, 0, 0.098, 0.098, 20), '#cdeeff', 0.001, true, [0, 0], 1)
  const root = new THREE.Group()
  // the lens and the big eye looking out of it
  const LP = V(0, 0.316, 0).applyMatrix4(M)
  const LM = facingUp(SPY_D, LP.toArray() as P3).multiply(T([0, 0, 0], [0, 0, 0], SPY_S))
  const bg = k.geometry().applyMatrix4(M)
  const lg = lens.geometry().applyMatrix4(LM)
  const body = new THREE.Mesh(mergeGeometries([bg, lg]), mat())
  bg.dispose()
  lg.dispose()
  body.name = 'body'
  root.add(body)
  const e = new VKit(INK, 0.012)
  const eyes: Eye[] = [{ x: 0, y: 0, rx: 0.074, ry: 0.08, look: [-0.18, -0.06], pupil: 0.4 }]
  domeEyes(e, lensAt(0.024), eyes, 0.008)
  e.decal({ c: [0, 0, 0.0265], r: [0.074, 0.08, 0.0459] }, ellipsePts(-0.0133, -0.008, 0.046, 0.05, 18), '#8c55e8', 0.0015, 0)
  root.add(partAt(e, 'eyes', LM, LP.toArray() as P3))
  const j = new VKit(INK, 0.012)
  j.add(new THREE.SphereGeometry(1, 12, 5, 0, TAU, 0, Math.PI / 2), '#ffffff', T([0, 0, 0.0], [Math.PI / 2, 0, 0], [0.074, 0.046, 0.08]), 0.008)
  happyEyes(j, lensAt(0.046), [{ x: 0, y: 0.0, rx: 0.06, ry: 0.06 }], 0.004, 0.02)
  const joy = meshAt(j, 'joy', LM)
  joy.visible = false
  root.add(joy)
  // the draw tubes and eyepiece, which slide out
  const t = new VKit(INK, W_INK)
  t.add(lathe([[0.0, -0.17], [0.064, -0.17], [0.064, 0.03], [0.0, 0.03]], 14), BRASS)
  t.add(new THREE.TorusGeometry(0.066, 0.012, 5, 16), BRASS_D, T([0, -0.15, 0], [Math.PI / 2, 0, 0]))
  t.add(lathe([[0.0, -0.31], [0.048, -0.31], [0.048, -0.15], [0.0, -0.15]], 12), BRASS_D)
  t.add(lathe([[0.0, -0.37], [0.03, -0.37], [0.042, -0.355], [0.042, -0.3], [0.0, -0.3]], 12), '#5b3a1e')
  root.add(partAt(t, 'tube', M, V(0, -0.1, 0).applyMatrix4(M).toArray() as P3))
  return root
}

const GLASS = SYMBOL_COLOR.bottle
const GLASS_L = '#8ff0c8'
const CORK = '#d9a066'
const BOTTLE_PROF: P2[] = [
  [0.0, -0.3],
  [0.115, -0.3],
  [0.142, -0.28],
  [0.15, -0.24],
  [0.15, 0.0],
  [0.14, 0.06],
  [0.1, 0.13],
  [0.062, 0.165],
  [0.054, 0.19],
  [0.054, 0.255],
  [0.066, 0.262],
  [0.068, 0.285],
  [0.056, 0.292],
  [0.0, 0.292],
]
const BOTTLE_M = T([0.0, -0.01, 0], [0, 0, -0.78], 1.08)

/** Message in a bottle: green glass with a rolled-up note inside, a cork that pops, and a face on the glass */
function buildBottle() {
  const k = new VKit(INK, W_INK)
  const f = latheSurf(BOTTLE_PROF)
  k.add(lathe(BOTTLE_PROF, 18), GLASS)
  // the note inside, seen through the glass: a cream roll with darker ends and a red ribbon
  paint(k, f, rrect(0, 0.055, 0.105, 0.15, 0.03), '#e9f4c4', 0.002, false)
  for (const y of [-0.012, 0.122]) paint(k, f, oval(0, y, 0.054, 0.015), '#cfe0a2', 0.003, false, undefined, 1)
  paint(k, f, rrect(0, 0.055, 0.108, 0.026, 0.006), '#ef4b43', 0.004, false)
  paint(k, f, oval(0.0, 0.055, 0.016, 0.016), '#c22a2a', 0.005, false, undefined, 1)
  // a lighter rim of glass down one side, and the shine
  paint(k, f, [[0.1, -0.26], [0.13, -0.24], [0.13, 0.0], [0.1, 0.0]], GLASS_L, 0.002, false, undefined, 1)
  stroke(k, f, [[-0.1, -0.2], [-0.105, -0.08], [-0.098, 0.02]], 0.026, 0.006, SHINE)
  paint(k, f, ellipsePts(-0.098, 0.065, 0.012, 0.012, 8), SHINE, 0.006, true, undefined, 1)
  smile(k, f, { x: 0.0, y: -0.2, w: 0.035, h: 0.016 }, 0.006, 0.011)
  blush(k, f, [[-0.075, -0.19], [0.075, -0.19]], 0.02, 0.012, '#ff8fa8', 0.005)
  const root = new THREE.Group()
  root.add(meshAt(k, 'body', BOTTLE_M))
  const eyes: Eye[] = [-1, 1].map((s) => ({ x: s * 0.046, y: -0.14, rx: 0.032, ry: 0.038, look: [0.0, 0.08] as P2, pupil: 0.62 }))
  const e = new VKit(INK, W_INK)
  const ec = domeEyes(e, f, eyes)
  root.add(partAt(e, 'eyes', BOTTLE_M, V(...ec).applyMatrix4(BOTTLE_M).toArray() as P3))
  const j = new VKit(INK, W_INK)
  happyEyes(j, f, eyes, 0.008, 0.014)
  openMouth(j, f, { x: 0, y: -0.195, w: 0.036, h: 0.035 }, 0.009)
  const joy = meshAt(j, 'joy', BOTTLE_M)
  joy.visible = false
  root.add(joy)
  // the cork, which pops out along the neck
  const c = new VKit(INK, W_INK)
  c.add(lathe([[0.0, 0.27], [0.046, 0.27], [0.05, 0.33], [0.046, 0.345], [0.0, 0.345]], 12), CORK)
  c.add(flatShape(ellipsePts(0, 0, 0.03, 0.03, 10), 0), '#b8834a', T([0, 0.3452, 0], [-Math.PI / 2, 0, 0]), 0, false)
  root.add(partAt(c, 'cork', BOTTLE_M, V(0, 0.3, 0).applyMatrix4(BOTTLE_M).toArray() as P3))
  return root
}

/* ---------------- the wild: the Jolly Roger ---------------- */

const FLAG = '#262b3f'
const POLE = '#8a5a34'
/** the cloth's extent: from the pole (x0) out to the fly (x1), y0 to y1 */
const CLOTH = { x0: -0.28, x1: 0.35, y0: -0.07, y1: 0.37 }
const WAVE = { amp: 0.045, freq: 8 }

/** a VKit of cloth decals as a waving mesh */
function clothMesh(k: VKit, name: string) {
  const { x0, x1 } = CLOTH
  const m = new THREE.Mesh(waveCloth(k.geometry(), x0, x1 - x0, WAVE.amp, WAVE.freq), clothMaterial())
  m.name = name
  return m
}

/** Jolly Roger: a black flag with a grinning skull and crossbones that waves on its pole, over a gold WILD ribbon */
function buildFlag() {
  const { x0, x1, y0, y1 } = CLOTH
  const c = new VKit(INK, W_INK)
  c.add(clothGeo(x0, x1, y0, y1, 0.014, 18, 3), FLAG)
  // a darker hem down the hoist, and a few lighter creases
  clothDecal(c, [[x0, y0], [x0 + 0.03, y0], [x0 + 0.03, y1], [x0, y1]], '#1a1e2e', 0.0085)
  const cx = 0.035
  const cy = 0.155
  const z = 0.009
  // crossbones behind the skull
  for (const d of [-1, 1]) {
    const a: P2 = [cx - 0.19, cy - 0.12 * d - 0.045]
    const b: P2 = [cx + 0.19, cy + 0.12 * d - 0.045]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nx = -(b[1] - a[1]) / l
    const ny = (b[0] - a[0]) / l
    clothDecal(c, stripPts([a, b], 0.05), INK, z)
    for (const e of [a, b]) for (const sd of [-1, 1]) clothDecal(c, ellipsePts(e[0] + nx * 0.022 * sd, e[1] + ny * 0.022 * sd, 0.034, 0.034, 10), INK, z)
    clothDecal(c, stripPts([a, b], 0.034), BONE, z + 0.0015)
    for (const e of [a, b]) for (const sd of [-1, 1]) clothDecal(c, ellipsePts(e[0] + nx * 0.022 * sd, e[1] + ny * 0.022 * sd, 0.025, 0.025, 10), BONE, z + 0.0015)
  }
  // the skull: a round crown and a jaw with teeth
  clothDecal(c, ellipsePts(cx, cy + 0.035, 0.122, 0.108, 22), INK, z + 0.003)
  clothDecal(c, rrect(cx, cy - 0.05, 0.13, 0.08, 0.024), INK, z + 0.003)
  clothDecal(c, ellipsePts(cx, cy + 0.035, 0.11, 0.096, 22), BONE, z + 0.0045)
  clothDecal(c, rrect(cx, cy - 0.05, 0.116, 0.066, 0.02), BONE, z + 0.0045)
  for (let i = -1; i <= 1; i++) clothDecal(c, stripPts([[cx + i * 0.028, cy - 0.034], [cx + i * 0.028, cy - 0.078]], 0.008), '#a69a84', z + 0.006)
  clothDecal(c, [[cx, cy + 0.0], [cx - 0.017, cy - 0.026], [cx + 0.017, cy - 0.026]], INK, z + 0.006)
  clothDecal(c, ellipsePts(cx - 0.05, cy + 0.095, 0.022, 0.012, 10), C('#ffffff', 1.25), z + 0.006)
  const root = new THREE.Group()
  root.add(clothMesh(c, 'cloth'))
  // the sockets, with a glint of life in them, and their happy version
  const e = new VKit(INK, W_INK)
  for (const s of [-1, 1]) {
    clothDecal(e, ellipsePts(cx + s * 0.044, cy + 0.035, 0.033, 0.037, 14), INK, z + 0.0075)
    clothDecal(e, ellipsePts(cx + s * 0.044 - 0.01, cy + 0.048, 0.011, 0.012, 8), C('#ffffff', 1.3), z + 0.009)
  }
  root.add(clothMesh(e, 'sockets'))
  const j = new VKit(INK, W_INK)
  // happy ^ ^ eyes: each arc laid segment by segment (slices only follow convex pieces)
  for (const s of [-1, 1]) {
    const a = arc(cx + s * 0.044, cy + 0.022, 0.032, 0.03, Math.PI * 0.95, Math.PI * 0.05, 8)
    const st = stripPts(a, 0.02)
    const n = a.length
    for (let i = 0; i < n - 1; i++) clothDecal(j, [st[i], st[i + 1], st[2 * n - 2 - i], st[2 * n - 1 - i]], INK, z + 0.0075)
    for (const p of [a[0], a[a.length - 1]]) clothDecal(j, ellipsePts(p[0], p[1], 0.01, 0.01, 8), INK, z + 0.0075)
  }
  clothDecal(j, rrect(cx, cy - 0.052, 0.08, 0.04, 0.016), MOUTH, z + 0.0075)
  const joy = clothMesh(j, 'joy')
  joy.visible = false
  root.add(joy)
  // the pole, its gold finial, and the gold WILD ribbon across the foot of the flag
  const p = new VKit(INK, W_INK)
  p.add(new THREE.CylinderGeometry(0.024, 0.026, 0.8, 10), POLE, T([x0 - 0.024, -0.02, 0]))
  p.add(sphere(10, 8), TOOTH_GOLD, T([x0 - 0.024, 0.41, 0], [0, 0, 0], 0.044))
  for (const y of [0.34, -0.05]) p.add(new THREE.TorusGeometry(0.027, 0.008, 5, 10), '#5e3a1f', T([x0 - 0.024, y, 0], [Math.PI / 2, 0, 0]), 0.008)
  const rib: P2[] = [[-0.3, -0.045], [-0.34, -0.1], [-0.3, -0.16], [0.3, -0.16], [0.34, -0.1], [0.3, -0.045]]
  const ribM = T([0.02, -0.2, 0.06], [0, 0, 0.06])
  p.add(slab(rib, 0.03, 0.01, 2), '#ffc63d', ribM)
  for (const s of [-1, 1]) p.add(slab([[0, 0.03], [s * 0.1, 0.035], [s * 0.075, 0], [s * 0.1, -0.035], [0, -0.03]], 0.024, 0.008, 2), '#e09a1e', mul(ribM, T([s * 0.3, -0.1, -0.03])), W_INK)
  flatDecal(p, ribM, stripPts([[-0.28, -0.058], [0.28, -0.058]], 0.008), C('#fff1b0', 1.15), 0.0262)
  root.add(p.mesh('pole', mat()))
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.156), wildMaterial())
  label.name = 'label'
  label.position.set(0.02, -0.3, 0.088)
  label.rotation.z = 0.06
  label.renderOrder = 2
  root.add(label)
  return root
}

/* ---------------- the scatter: the treasure map ---------------- */

const PARCH = SYMBOL_COLOR.map
const PARCH_D = '#d9a85f'
const MAP_W = 0.34
const MAP_H = 0.25
const ROLL_R = 0.05
/** how far in the rolls come when the map is rolled up (setUnroll 0) */
const ROLL_IN = 0.085

/** the parchment sheet's gentle curl (z) across x */
const curl = (x: number) => 0.016 * Math.sin(x * 9 + 0.4)

/**
 * Treasure map: a parchment sheet between two rolls, an island with a palm, a dotted trail and a big red X. One mesh
 * with a morph target that rolls it up (setUnroll), the X on its own so it can pulse, and a gold glow behind.
 */
function buildMap() {
  const s = new VKit(INK, W_INK)
  const sheet = new THREE.BoxGeometry(MAP_W * 2, MAP_H * 2, 0.012, 22, 3, 1)
  warp(sheet, (v) => void (v.z += curl(v.x)))
  const edgeC = C(PARCH_D)
  const midC = C(PARCH)
  s.add(shade(smooth(sheet), (x, y) => midC.clone().lerp(edgeC, Math.max(Math.abs(y) / MAP_H, 0.6 * (Math.abs(x) / MAP_W)) ** 3)), '#ffffff')
  const f: Surf = (x) => curl(x) + 0.0065
  // the sea: wave marks
  for (const [x, y] of [
    [-0.24, 0.16],
    [0.22, -0.17],
    [-0.05, -0.18],
    [0.26, 0.04],
  ])
    stroke(s, f, arc(x, y, 0.022, 0.012, Math.PI * 0.1, Math.PI * 0.9, 6).concat(arc(x + 0.044, y, 0.022, 0.012, Math.PI * 0.1, Math.PI * 0.9, 6)), 0.009, 0.002, '#4f8fc9', 0.2, true)
  // the island, sandy, with a green middle and a palm
  const isl: P2[] = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * TAU
    const r = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 5)
    return [-0.13 + Math.cos(a) * 0.12 * r, -0.02 + Math.sin(a) * 0.085 * r]
  })
  inked(s, f, isl, '#f2c87e', 0.002, 0.008, false)
  paint(s, f, oval(-0.14, -0.01, 0.06, 0.04, 0.2), '#7cc66a', 0.003, false, undefined, 1)
  stroke(s, f, curve2([[-0.15, -0.02], [-0.155, 0.03], [-0.14, 0.075]], 6), 0.012, 0.004, '#8a5a34', 0.1, false)
  for (const a of [0.3, 1.2, 2.1, 2.9]) stroke(s, f, curve2([[-0.14, 0.075], [-0.14 + Math.cos(a) * 0.035, 0.075 + Math.sin(a) * 0.03 + 0.008], [-0.14 + Math.cos(a) * 0.06, 0.075 + Math.sin(a) * 0.025 - 0.012]], 5), 0.016, 0.005, '#3faa55', 0.4, false)
  // the trail, dashed, from the island out to where the X will be
  const trail = curve2([[-0.04, 0.0], [0.02, 0.07], [0.09, 0.08], [0.12, 0.02], [0.15, -0.02]], 18)
  for (let i = 0; i < trail.length - 2; i += 3) stroke(s, f, [trail[i], trail[i + 1]], 0.011, 0.003, '#a0402c', 0.15, true)
  // a little compass star and a skull in the corners
  paint(s, f, star(0.25, 0.15, 0.045, 0.012, 4), '#7a4a26', 0.003, true, [0.25, 0.15], 1)
  paint(s, f, star(-0.26, -0.15, 0.022, 0.011, 5), '#a0402c', 0.003, true, [-0.26, -0.15], 1)
  // the rolls at each end: parchment wound round, a brown spiral on top
  const r = new VKit(INK, W_INK)
  for (const sd of [-1, 1]) {
    const x = sd * MAP_W
    r.add(smooth(new THREE.CylinderGeometry(ROLL_R, ROLL_R, MAP_H * 2 + 0.05, 14, 1)), '#ecc888', T([x, 0, curl(x) + 0.01]))
    const top = (y: number) => T([x, y, curl(x) + 0.01], [y > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0])
    for (const y of [MAP_H + 0.025, -MAP_H - 0.025]) {
      const sp: P2[] = Array.from({ length: 16 }, (_, i) => {
        const a = (i / 15) * Math.PI * 3.2
        const rr = 0.008 + (i / 15) * 0.036
        return [Math.cos(a) * rr, Math.sin(a) * rr]
      })
      r.add(flatShape(stripPts(sp, 0.006), 0.001), '#a2703c', top(y), 0, true)
    }
    r.add(new THREE.SphereGeometry(1, 6, 4), SHINE, T([x - 0.022, 0.1, curl(x) + 0.01 + ROLL_R * 0.9], [0, 0, 0], [0.007, 0.12, 0.004]), 0, true)
  }
  const sg = s.geometry()
  morphTo(sg, (v) => {
    if (Math.abs(v.x) > ROLL_IN) v.x = Math.sign(v.x) * ROLL_IN
  })
  const rg = r.geometry()
  morphTo(rg, (v) => void (v.x -= Math.sign(v.x) * (MAP_W - ROLL_IN)))
  const geo = mergeGeometries([sg, rg])
  sg.dispose()
  rg.dispose()
  geo.morphTargetsRelative = false
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(geo, mat())
  mesh.name = 'map'
  root.add(mesh)
  // the X marks the spot
  const x = new VKit(INK, W_INK)
  const XC: P2 = [0.165, -0.04]
  for (const d of [-1, 1]) {
    const a: P2 = [XC[0] - 0.045, XC[1] - 0.045 * d]
    const b: P2 = [XC[0] + 0.045, XC[1] + 0.045 * d]
    x.add(flatShape(stripPts([a, b], 0.042), 0), INK, T([0, 0, curl(XC[0]) + 0.0075]), 0, true)
  }
  for (const d of [-1, 1]) {
    const a: P2 = [XC[0] - 0.04, XC[1] - 0.04 * d]
    const b: P2 = [XC[0] + 0.04, XC[1] + 0.04 * d]
    x.add(flatShape(stripPts([a, b], 0.026), 0), '#e8343c', T([0, 0, curl(XC[0]) + 0.0085 + (d > 0 ? 0.0005 : 0)]), 0, true)
  }
  root.add(part(x, 'x', [XC[0], XC[1], curl(XC[0]) + 0.008], mat()))
  const h = new THREE.Sprite(haloMaterial())
  h.name = 'halo'
  h.scale.set(1.25, 1.0, 1)
  h.position.z = -0.25
  h.userData.rest = restOf(h)
  root.add(h)
  return root
}

/** rolls the treasure map up (0) or opens it (1); the X shows only once it is open */
export function setUnroll(o: THREE.Object3D, t: number) {
  const m = o.getObjectByName('map') as THREE.Mesh | undefined
  if (m?.morphTargetInfluences) m.morphTargetInfluences[0] = 1 - Math.min(1, Math.max(0, t))
  const x = o.getObjectByName('x')
  if (x) x.visible = t > 0.9
}

/* ---------------- poses ---------------- */

type Parts = Record<string, THREE.Object3D>
type Pose = (p: Parts, t: number, w: number, seed: number) => void

/** a blink now and then: 1 open, down to 0.1 shut */
function blinkAt(t: number, seed: number) {
  const ph = (t + seed * 17) % (3.1 + seed * 2.2)
  return ph < 0.13 ? 0.1 + 0.9 * Math.abs(ph / 0.065 - 1) : 1
}

const BOTTLE_AXIS = new THREE.Vector3(0, 1, 0).transformDirection(BOTTLE_M)
/** a bouncy 0..1..0 pulse, `rate` per second */
const bounce = (t: number, rate: number) => Math.abs(Math.sin(t * rate))

const POSE: Partial<Record<Sym, Pose>> = {
  captain: (p, t, w, seed) => {
    if (p.wing) p.wing.rotation.z += (1 - w) * 0.1 * Math.sin(t * 2.1 + seed * 6) + w * (-0.05 + 0.32 * Math.sin(t * 11))
    if (p.beak) p.beak.rotation.x += w * (0.3 + 0.25 * Math.sin(t * 14)) + (1 - w) * 0.04 * Math.max(0, Math.sin(t * 1.3 + seed * 9))
  },
  shark: (p, t, w, seed) => {
    if (p.tail) p.tail.rotation.y += (1 - w) * 0.25 * Math.sin(t * 2.6 + seed * 6) + w * 0.5 * Math.sin(t * 14)
    if (p.fin) p.fin.rotation.z += (1 - w) * 0.12 * Math.sin(t * 2.2 + seed * 4) + w * (0.25 + 0.4 * Math.sin(t * 12))
  },
  monkey: (p, t, w, seed) => {
    if (p.arm) p.arm.rotation.z += (1 - w) * 0.12 * Math.sin(t * 2.4 + seed * 5) + w * (-0.1 + 0.42 * Math.sin(t * 10))
    if (p.tail) p.tail.rotation.z += (1 - w) * 0.16 * Math.sin(t * 1.7 + seed * 3) + w * 0.3 * Math.sin(t * 8)
  },
  crab: (p, t, w, seed) => {
    for (const [n, s] of [
      ['clawL', -1],
      ['clawR', 1],
    ] as const) {
      const c = p[n]
      if (c) c.rotation.z += (1 - w) * s * 0.07 * Math.sin(t * 2 + seed * 5 + s) + w * s * (0.12 + 0.24 * Math.sin(t * 12 + (s > 0 ? Math.PI : 0)))
    }
  },
  anchor: (p, t, w, seed) => {
    if (p.swing) p.swing.rotation.z += (1 - w) * 0.05 * Math.sin(t * 1.6 + seed * 6) + w * 0.2 * Math.sin(t * 7)
  },
  compass: (p, t, w, seed) => {
    if (p.needle) p.needle.rotation.z += (1 - w) * (0.22 * Math.sin(t * 1.3 + seed * 6) + 0.08 * Math.sin(t * 3.7 + seed)) - w * t * 14
  },
  spyglass: (p, t, w, seed) => {
    if (p.tube) p.tube.position.addScaledVector(SPY_D, -SPY_S * (w * 0.09 * (0.7 + 0.3 * Math.sin(t * 8)) + (1 - w) * 0.012 * (1 + Math.sin(t * 1.1 + seed * 7))))
  },
  bottle: (p, t, w, seed) => {
    if (p.cork) {
      p.cork.position.addScaledVector(BOTTLE_AXIS, w * 0.1 * bounce(t, 5) + (1 - w) * 0.006 * Math.max(0, Math.sin(t * 3 + seed * 8)))
      p.cork.rotation.z += w * 0.5 * Math.sin(t * 9) + (1 - w) * 0.06 * Math.sin(t * 7 + seed * 3)
    }
  },
  flag: (p, _t, w) => {
    if (p.sockets) p.sockets.visible = w <= 0.4
  },
  map: (p, t, w, seed) => {
    if (p.x) p.x.scale.multiplyScalar(1 + (1 - w) * 0.05 * Math.sin(t * 3 + seed * 6) + w * 0.28 * bounce(t, 6))
    if (p.halo) p.halo.scale.multiplyScalar(1 + (1 - w) * 0.05 * Math.sin(t * 2 + seed * 5) + w * 0.35)
  },
}

/**
 * Poses a symbol for this frame: idle sway on its moving parts (t = scene clock, s), and the win celebration as w
 * goes 0 to 1 (the joy face shows from w > 0.4, the eyes blink on their own while idle).
 */
export function poseSymbol(o: THREE.Object3D, t: number, win = 0) {
  const parts = partsOf.get(o) ?? indexParts(o)
  for (const x of Object.values(parts)) toRest(x)
  const seed = (o.userData.seed as number) ?? 0
  const sym = o.userData.sym as Sym
  POSE[sym]?.(parts, t, win, seed)
  const joy = parts.joy
  const eyes = parts.eyes
  if (joy) joy.visible = win > 0.4
  if (eyes) {
    eyes.visible = !(joy && win > 0.4)
    eyes.scale.y *= win > 0.4 ? 1 : blinkAt(t, seed)
  }
}

/** each copy's moving parts by name (kept out of userData, which three copies as JSON on clone) */
const partsOf = new WeakMap<THREE.Object3D, Parts>()
function indexParts(o: THREE.Object3D) {
  const parts: Parts = {}
  o.traverse((x) => {
    if (x !== o && x.name && !parts[x.name]) parts[x.name] = x
  })
  partsOf.set(o, parts)
  return parts
}

/* ---------------- API ---------------- */

const BUILD: Partial<Record<Sym, () => THREE.Group>> = {
  captain: buildCaptain,
  shark: buildShark,
  monkey: buildMonkey,
  crab: buildCrab,
  anchor: buildAnchor,
  compass: buildCompass,
  spyglass: buildSpyglass,
  bottle: buildBottle,
  flag: buildFlag,
  map: buildMap,
}

/** symbols drawn a little bigger than built, so each fills its cell like the rest */
const FIT: Partial<Record<Sym, number>> = { monkey: 1.1 }

const protos = new Map<string, THREE.Group>()
function proto(key: string, make: () => THREE.Group) {
  let p = protos.get(key)
  if (!p) protos.set(key, (p = make()))
  return p
}

/** a fresh copy of a symbol, sharing geometry and materials with every other copy */
export function buildSymbol(sym: Sym): THREE.Group {
  const g = proto(sym, () => {
    const m = BUILD[sym]!()
    const f = FIT[sym]
    if (!f) return m
    const fit = new THREE.Group()
    fit.add(...m.children)
    fit.scale.setScalar(f)
    m.add(fit)
    return m
  }).clone()
  g.userData = { sym, seed: Math.random() }
  indexParts(g)
  return g
}

/**
 * A treasure map for the stage (Polly's big map when the maps start Treasure Hunt): a copy of the symbol in the
 * unclipped stage materials, so it can leave the reel window. Pose it with poseSymbol and setUnroll like a symbol.
 */
export function buildStageMap(): THREE.Group {
  const g = buildSymbol('map')
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material === castMaterial()) o.material = castMaterial(true)
    if (o instanceof THREE.Sprite) o.material = haloMaterial(true)
  })
  return g
}

/** builds every symbol prototype ahead of time */
export function warmUp() {
  for (const s of Object.keys(BUILD) as Sym[]) buildSymbol(s)
}

/** the named moving parts of each symbol (poseSymbol drives them; each keeps userData.rest) */
export const PARTS: Record<Sym, readonly string[]> = {
  captain: ['eyes', 'joy', 'beak', 'wing'],
  shark: ['eyes', 'joy', 'tail', 'fin'],
  monkey: ['eyes', 'joy', 'arm', 'tail'],
  crab: ['eyes', 'joy', 'clawL', 'clawR'],
  anchor: ['swing', 'eyes', 'joy'],
  compass: ['eyes', 'joy', 'needle'],
  spyglass: ['eyes', 'joy', 'tube'],
  bottle: ['eyes', 'joy', 'cork'],
  flag: ['sockets', 'joy'],
  map: ['x', 'halo'],
}

/** every material the grid pieces use, for the scene to clip to the reel window (the stage copies are left out) */
export function allMaterials(): THREE.Material[] {
  return [castMaterial(), clothMaterial(), haloMaterial(), wildMaterial()]
}

/** the materials of one model */
export function symbolMaterials(o: THREE.Object3D) {
  const out = new Set<THREE.Material>()
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) out.add(x.material as THREE.Material)
  })
  return [...out]
}

/**
 * Lets go of a renderer that is closing: disposes every material, texture and prototype geometry cached here (and
 * the shared toon ramp, glow texture and sprite quad), which drops each renderer's listeners and GPU copies. The
 * objects stay built, so the next scene uploads them again without rebuilding a model.
 */
export function releaseModels() {
  for (const p of protos.values())
    p.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  releaseMaterials()
  releaseLabels()
  releaseShip()
  // three's sprites all share one quad
  new THREE.Sprite().geometry.dispose()
}

export { buildHost, poseHost, type HostAction, type HostRig } from './host'
export {
  WaysBoard,
  buildBarrel,
  buildCannon,
  buildChest,
  buildCrate,
  buildDeck,
  buildFrame,
  buildGull,
  buildHelm,
  buildLantern,
  buildMast,
  buildMedallion,
  buildRail,
  buildRopeCoil,
  coinGeometry,
  disposeTree,
  flapGull,
  formatWays,
  type ChestRig,
  type FrameOptions,
  type FrameRig,
  type HelmRig,
  type MastRig,
  type MedallionRig,
} from './ship'
export { castMaterial, clothMaterial, goldMaterial, setLanternGlow, tickModels } from './mats'
export { GoldLabel, goldText } from './labels'
export { INK, toRest } from './kit'

