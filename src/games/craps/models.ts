import * as THREE from 'three'
import { BOJE_B, BOJE_HEX } from '../../art/brand'
import { PIPS, cellOf, releaseDiceGeometry } from '../../lib/dice/mesh'
import { AREAS, FELT_L, FELT_W, MARK_AT, PROPS_BOX, type Area } from './layout'
import { BACK_Z, HALF_W, NEAR_Z, PYR_D, PYR_P, WALL_H } from './physics'
import type { Die } from './rules'

/*
  The craps table and its dice, built in code (no files). Premium and clean: physically based materials lit by a
  generated casino environment (a dark room, the long lamp over the table, warm strips along the walls, far-off
  lights), prefiltered (PMREM) so the dice's gloss, the varnished rail and the leather pick up the same lights.

  - The dice: casino dice, translucent red with flush white pips, the kind used at every craps table (on green felt
    nothing reads better, and they are what a player expects to see). Their depth is drawn by the shader: each point
    of a face looks through the die (refracted, as through acetate) to the face behind, and sees that face's pips
    from the inside, dimmed and reddened by the distance travelled. The atlas holds all six faces (lib/dice/mesh.ts).
  - The felt: deep casino green, a soft pool of light down the middle, its nap, the layout printed in cream and gold
    (layout.ts: the shooter's layout, the centre props, the house's mark in the landing zone), shaded where it meets
    the walls.
  - The tub: felt-covered walls; the backboard at the far end lined with black rubber pyramids, set as diamonds
    (the very geometry the physics throws the dice against); round the top a varnished walnut rail with a chip groove
    and a dark oxblood leather arm rest, over a lacquered apron with a brass bead, the body set back below it.
  - The puck: the dealer's ON / OFF disc, white side ON, black side OFF.
  - The stick: the stickman's long ash rod with its hooked end, which brings the dice back to the shooter.

  Textures, materials and geometry are cached for the next visit; releaseModels() lets go of their GPU copies when the
  scene closes. The environment belongs to its renderer and goes with the scene.
*/

const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'
const SERIF = 'Georgia, "Times New Roman", serif'
/** the corners of the tub and the rail round them, at the walls' face */
export const CORNER_R = 0.32
/** the casino floor, below the felt */
export const FLOOR_Y = -9

/* ---------------- the room ---------------- */

/** the room's lights for reflections: direction (towards the light), half-size across and along, colour, strength */
const PANELS: { dir: [number, number, number]; size: [number, number]; color: [number, number, number]; k: number }[] = [
  // the long lamp over the table, down its length
  { dir: [0, 1, 0.05], size: [0.13, 0.7], color: [1, 0.93, 0.8], k: 2.1 },
  // warm strips high on either side (the room's wall lights)
  { dir: [-1, 0.45, -0.2], size: [0.1, 0.55], color: [1, 0.8, 0.55], k: 1.4 },
  { dir: [1, 0.45, 0.25], size: [0.1, 0.55], color: [1, 0.78, 0.5], k: 1.2 },
  // a soft cool fill from behind the shooter
  { dir: [0.1, 0.35, 1], size: [0.6, 0.22], color: [0.75, 0.85, 1], k: 0.55 },
]

const glslVec = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(4)).join(', ')})`
function panelCode() {
  return PANELS.map((p) => {
    const d = new THREE.Vector3(...p.dir).normalize()
    const hint = Math.abs(d.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0)
    const e1 = new THREE.Vector3().crossVectors(hint, d).normalize()
    const e2 = new THREE.Vector3().crossVectors(d, e1).normalize()
    const tx = Math.tan(p.size[0]).toFixed(4)
    const ty = Math.tan(p.size[1]).toFixed(4)
    const col = glslVec(p.color.map((c) => c * p.k))
    return `  { float z = dot(r, ${glslVec(d.toArray())}); if (z > 0.0) { vec2 q = abs(vec2(dot(r, ${glslVec(e1.toArray())}), dot(r, ${glslVec(e2.toArray())})) / z) / vec2(${tx}, ${ty}); c += ${col} * (1.0 - smoothstep(0.85, 1.0, q.x)) * (1.0 - smoothstep(0.85, 1.0, q.y)); } }`
  }).join('\n')
}

/** `vec3 room(vec3 r)`: the casino round the table, seen in direction r (unit, world): what the background shows */
export const ROOM_GLSL = /* glsl */ `
float roomHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 room(vec3 r) {
  // warm dark: a faint glow at eye level (the room's lights, far off), darker overhead and below
  float h = r.y;
  vec3 c = mix(vec3(0.03, 0.02, 0.016), vec3(0.012, 0.009, 0.008), smoothstep(0.05, 0.75, h));
  c = mix(c, vec3(0.016, 0.012, 0.01), smoothstep(-0.05, -0.6, h));
  c += vec3(0.05, 0.03, 0.015) * exp(-pow((h - 0.08) / 0.16, 2.0));
  // the far-off lights, out of focus: soft discs round the horizon, mostly warm, a few slot machines' colours
  float az = atan(r.x, -r.z);
  vec2 q = vec2(az * 3.4, h * 8.0);
  vec2 cell = floor(q);
  float k = roomHash(cell);
  if (k > 0.45 && abs(h - 0.12) < 0.42) {
    vec2 ctr = cell + 0.5 + (vec2(roomHash(cell + 3.1), roomHash(cell + 7.7)) - 0.5) * 0.55;
    float rad = 0.17 + 0.2 * roomHash(cell + 1.3);
    float dd = length(q - ctr);
    float disc = 1.0 - smoothstep(rad * 0.78, rad, dd);
    float rim = smoothstep(rad * 0.5, rad * 0.92, dd) * disc;
    float pick = roomHash(cell + 5.0);
    vec3 tint = pick < 0.7 ? mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.82, 0.55), roomHash(cell + 2.0)) : pick < 0.85 ? vec3(1.0, 0.3, 0.35) : vec3(0.3, 0.85, 0.75);
    float s = (0.35 + 0.65 * roomHash(cell + 9.0)) * exp(-pow((h - 0.12) / 0.22, 2.0));
    c += tint * (disc * 0.06 + rim * 0.035) * s;
  }
  return c;
}`

/** `vec3 studio(vec3 r)`: the room with its lamps, for what the table's surfaces reflect */
const STUDIO_GLSL = /* glsl */ `
${ROOM_GLSL}
vec3 studio(vec3 r) {
  vec3 c = room(r) * 1.4;
  // the green felt below throws a little colour up
  c += vec3(0.01, 0.05, 0.03) * smoothstep(0.0, -0.6, r.y);
${panelCode()}
  return c;
}`

/**
 * The room as a prefiltered environment for this renderer: a big sphere painted by studio() from inside, captured
 * by PMREMGenerator. The caller owns the render target (its texture is the environment) and disposes it.
 */
export function crapsEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene()
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD;\n${STUDIO_GLSL}\nvoid main() { gl_FragColor = vec4(studio(normalize(vD)), 1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
  })
  const geo = new THREE.SphereGeometry(40, 64, 32)
  scene.add(new THREE.Mesh(geo, mat))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 100)
  pmrem.dispose()
  geo.dispose()
  mat.dispose()
  return rt
}

/* ---------------- the dice ---------------- */

/** the size of a face in the dice atlas for this device */
const faceSize = () => (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700 ? 256 : 512)
const PIP_R = 0.17

let diceTex: { map: THREE.CanvasTexture; size: number } | null = null
let diceMat: THREE.MeshPhysicalMaterial | null = null

/**
 * Paints the atlas: the red body (its colour comes mostly from the shader's look through the die, so the face itself
 * is a deep red) and the pips, drilled and filled flush with white paint, a hairline of shadow round each.
 */
function paintDice(S: number) {
  const c = document.createElement('canvas')
  c.width = S * 3
  c.height = S * 2
  const g = c.getContext('2d')!
  g.fillStyle = '#6a0a14'
  g.fillRect(0, 0, c.width, c.height)
  for (const f of [1, 2, 3, 4, 5, 6] as Die[]) {
    const [cx, cy] = cellOf(f)
    const ox = cx * S
    const oy = cy * S
    for (const [px, py] of PIPS[f]) {
      const x = ox + ((px + 1) / 2) * S
      const y = oy + ((1 - py) / 2) * S
      const r = (PIP_R / 2) * S
      // the drill's edge, then the paint
      g.fillStyle = 'rgba(30, 0, 4, 0.55)'
      g.beginPath()
      g.arc(x, y, r * 1.12, 0, Math.PI * 2)
      g.fill()
      const paint = g.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r)
      paint.addColorStop(0, '#ffffff')
      paint.addColorStop(0.75, '#f6f1e6')
      paint.addColorStop(1, '#e2d9c8')
      g.fillStyle = paint
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  return { map, size: S }
}

/** what the look through a die picks up (linear colours) and how the acetate swallows light per unit travelled */
interface DiceUniforms {
  /** light scattered inside the body, seen through it */
  uGlow: { value: THREE.Color }
  /** the inside of a pip's paint, seen through the body */
  uPipBack: { value: THREE.Color }
  uSigma: { value: THREE.Vector3 }
}

const diceUniforms: DiceUniforms = {
  uGlow: { value: new THREE.Color(0.95, 0.07, 0.06) },
  uPipBack: { value: new THREE.Color(1.6, 1.25, 1.15) },
  uSigma: { value: new THREE.Vector3(0.55, 3.2, 3.0) },
}

const DICE_VERT_PARS = /* glsl */ `
varying vec3 vDieP;
varying vec3 vDieN;
varying vec3 vDieCam;
`
const DICE_VERT = /* glsl */ `
vDieP = position;
vDieN = normal;
// the camera in the die's own frame (its matrix is a turn and a move: the inverse is the turn's transpose)
vDieCam = (cameraPosition - modelMatrix[3].xyz) * mat3(modelMatrix);
`
const DICE_FRAG_PARS = /* glsl */ `
varying vec3 vDieP;
varying vec3 vDieN;
varying vec3 vDieCam;
uniform vec3 uGlow;
uniform vec3 uPipBack;
uniform vec3 uSigma;
`
/**
 * The look through the die: from this point of its surface, refracted in, to where the ray leaves the inner cube by
 * another face; that face's atlas cell says whether it leaves through a pip (the paint's back, bright) or the body
 * (the scattered glow), and the distance travelled dims and reddens it. A pip on this face's surface hides it all.
 */
const DICE_FRAG = /* glsl */ `
{
  vec3 V = normalize(vDieP - vDieCam);
  vec3 T = refract(V, normalize(vDieN), 1.0 / 1.5);
  vec3 sg = sign(T) + step(abs(T), vec3(1e-4));
  vec3 tt = (sg * 0.5 - vDieP) / (T + sg * 1e-4);
  float tx = max(0.0, min(min(tt.x, tt.y), tt.z));
  vec3 E = vDieP + T * tx;
  vec2 fuv;
  vec2 cell;
  if (tt.y <= tt.x && tt.y <= tt.z) {
    if (T.y > 0.0) { fuv = vec2(E.x, -E.z); cell = vec2(0.0, 0.0); } else { fuv = vec2(E.x, E.z); cell = vec2(2.0, 1.0); }
  } else if (tt.z <= tt.x) {
    if (T.z > 0.0) { fuv = vec2(E.x, E.y); cell = vec2(1.0, 0.0); } else { fuv = vec2(-E.x, E.y); cell = vec2(1.0, 1.0); }
  } else {
    if (T.x > 0.0) { fuv = vec2(-E.z, E.y); cell = vec2(2.0, 0.0); } else { fuv = vec2(E.z, E.y); cell = vec2(0.0, 1.0); }
  }
  vec2 auv = vec2((cell.x + clamp(fuv.x + 0.5, 0.01, 0.99)) / 3.0, 1.0 - (cell.y + 0.5 - clamp(fuv.y, -0.49, 0.49)) / 2.0);
  float backPip = smoothstep(0.25, 0.6, texture2D(map, auv).g);
  float frontPip = smoothstep(0.2, 0.55, diffuseColor.g);
  vec3 through = mix(uGlow, uPipBack, backPip) * exp(-uSigma * tx);
  outgoingLight += through * (1.0 - frontPip);
}
`

/** the dice's material: translucent red acetate under a hard gloss, white pips */
export function crapsDiceMaterial() {
  const S = faceSize()
  if (!diceTex || diceTex.size !== S) {
    diceTex?.map.dispose()
    diceTex = paintDice(S)
    diceMat?.dispose()
    diceMat = null
  }
  if (diceMat) return diceMat
  const m = new THREE.MeshPhysicalMaterial({
    map: diceTex.map,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.15,
  })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, diceUniforms)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${DICE_VERT_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${DICE_VERT}`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${DICE_FRAG_PARS}`)
      .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n${DICE_FRAG}`)
  }
  m.customProgramCacheKey = () => 'craps-dice'
  diceMat = m
  return m
}

/* ---------------- the felt ---------------- */

let feltTex: THREE.CanvasTexture | null = null
let feltMat: THREE.MeshPhysicalMaterial | null = null
let feltGeo: THREE.BufferGeometry | null = null

const CREAM = '#f1e6c8'
const GOLD = '#e6bd62'
const RED = '#e0473f'

/** a small square of fine noise, tiled over the felt for its nap */
function napTile(n: number) {
  const c = document.createElement('canvas')
  c.width = c.height = n
  const g = c.getContext('2d')!
  const img = g.createImageData(n, n)
  for (let i = 0; i < n * n; i++) {
    const v = 128 + (Math.random() - 0.5) * 70 + (Math.random() < 0.03 ? 40 : 0)
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}

/** a die drawn flat on the felt (a pictogram): a rounded cream square with dark pips */
function feltDie(g: CanvasRenderingContext2D, x: number, y: number, s: number, f: Die) {
  const r = s * 0.18
  g.save()
  g.fillStyle = CREAM
  g.beginPath()
  g.roundRect(x - s / 2, y - s / 2, s, s, r)
  g.fill()
  g.fillStyle = '#0d3b2a'
  for (const [px, py] of PIPS[f]) {
    g.beginPath()
    g.arc(x + px * s * 0.32, y - py * s * 0.32, Math.max(1, s * 0.085), 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

/**
 * Paints the felt at K texels per unit: the green with its pool of light and its nap, a pinstripe round it, the
 * layout, the props, the house's mark, and the shade along the walls.
 */
function paintFelt(K: number) {
  const W = Math.round(FELT_W * K)
  const H = Math.round(FELT_L * K)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  // the green, brightest down the middle under the lamp
  const base = g.createRadialGradient(W / 2, H * 0.47, 0, W / 2, H * 0.47, H * 0.62)
  base.addColorStop(0, '#117a4f')
  base.addColorStop(0.55, '#0c6340')
  base.addColorStop(1, '#073f29')
  g.fillStyle = base
  g.fillRect(0, 0, W, H)
  // the nap
  g.save()
  g.globalAlpha = 0.16
  g.globalCompositeOperation = 'overlay'
  g.fillStyle = g.createPattern(napTile(256), 'repeat')!
  g.fillRect(0, 0, W, H)
  g.restore()

  const U = (u: number) => u * K
  const line = (w: number, color = CREAM) => {
    g.strokeStyle = color
    g.lineWidth = w * K
  }
  const box = (a: { u: number; v: number; w: number; h: number }, r = 0.18) => {
    g.beginPath()
    g.roundRect(U(a.u), U(a.v), U(a.w), U(a.h), U(r))
    g.stroke()
  }
  const text = (s: string, u: number, v: number, size: number, o: { font?: string; weight?: string; color?: string; spacing?: number; italic?: boolean } = {}) => {
    g.save()
    g.fillStyle = o.color ?? CREAM
    g.font = `${o.italic ? 'italic ' : ''}${o.weight ?? '700'} ${size * K}px ${o.font ?? SERIF}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (o.spacing) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.spacing * K}px`
    g.fillText(s, U(u), U(v))
    g.restore()
  }
  const mid = (a: Area) => ({ u: a.u + a.w / 2, v: a.v + a.h / 2 })
  const area = (k: string) => AREAS.find((a) => a.key === k)!

  // the pinstripe round the felt
  line(0.035, GOLD)
  g.globalAlpha = 0.7
  g.beginPath()
  g.roundRect(U(0.16), U(0.16), U(FELT_W - 0.32), U(FELT_L - 0.32), U(0.3))
  g.stroke()
  g.globalAlpha = 1

  // the shooter's layout: the number boxes and the Don't Come bar
  line(0.05)
  for (const n of ['dontCome', 'place4', 'place5', 'place6', 'place8', 'place9', 'place10']) box(area(n), 0.12)
  const dc = area('dontCome')
  text("DON'T", mid(dc).u, dc.v + 0.36, 0.3, { font: FONT, weight: '800', spacing: 0.02 })
  text('COME', mid(dc).u, dc.v + 0.68, 0.3, { font: FONT, weight: '800', spacing: 0.02 })
  text('BAR', mid(dc).u - 0.4, dc.v + 1.02, 0.26, { font: FONT, weight: '800' })
  feltDie(g, U(mid(dc).u + 0.2), U(dc.v + 1.02), U(0.28), 6)
  feltDie(g, U(mid(dc).u + 0.54), U(dc.v + 1.02), U(0.28), 6)
  const labels: Record<string, string> = { place4: '4', place5: '5', place6: 'SIX', place8: '8', place9: 'NINE', place10: '10' }
  for (const [k, s] of Object.entries(labels)) {
    const a = area(k)
    const word = s.length > 2
    text(s, mid(a).u, a.v + a.h * 0.58, word ? 0.44 : 0.95, { color: k === 'place6' || k === 'place8' ? GOLD : CREAM })
    // the place bet's pay, small under the number
    text(k === 'place4' || k === 'place10' ? '9 TO 5' : k === 'place5' || k === 'place9' ? '7 TO 5' : '7 TO 6', mid(a).u, a.v + a.h - 0.32, 0.2, { font: FONT, weight: '700', color: 'rgba(241,230,200,0.7)' })
  }
  // Come
  const come = area('come')
  box(come)
  text('COME', mid(come).u, mid(come).v + 0.06, 1.25, { color: RED, spacing: 0.22 })
  // the Field: its numbers, the 2 and the 12 ringed (they pay double and triple)
  const field = area('field')
  box(field)
  text('FIELD', field.u + 1.25, mid(field).v + 0.04, 0.52, { italic: true, color: GOLD })
  const nums = ['2', '3', '4', '9', '10', '11', '12']
  const fx0 = field.u + 3.05
  const fx1 = field.u + field.w - 0.6
  nums.forEach((s, i) => {
    const u = fx0 + ((fx1 - fx0) * i) / (nums.length - 1)
    const v = mid(field).v - 0.18
    const ringed = s === '2' || s === '12'
    text(s, u, v, 0.66, { color: ringed ? GOLD : CREAM })
    if (ringed) {
      line(0.04, GOLD)
      g.beginPath()
      g.arc(U(u), U(v), U(0.46), 0, Math.PI * 2)
      g.stroke()
      text(s === '2' ? 'PAYS DOUBLE' : 'PAYS TRIPLE', u, v + 0.7, 0.17, { font: FONT, weight: '800', color: GOLD })
    } else if (i < nums.length - 1) text('•', u + (fx1 - fx0) / (nums.length - 1) / 2, v, 0.3, { color: 'rgba(241,230,200,0.5)' })
  })
  line(0.05)
  // Don't Pass bar
  const dp = area('dontPass')
  box(dp, 0.14)
  text("DON'T PASS BAR", mid(dp).u - 0.45, mid(dp).v + 0.03, 0.5, { spacing: 0.05 })
  feltDie(g, U(mid(dp).u + 2.75), U(mid(dp).v), U(0.38), 6)
  feltDie(g, U(mid(dp).u + 3.2), U(mid(dp).v), U(0.38), 6)
  // Pass Line, along the rail
  const pass = area('pass')
  box(pass)
  // (to the left: the stickman leaves the dice for the shooter on the right)
  text('PASS LINE', mid(pass).u - 0.85, mid(pass).v + 0.05, 0.95, { spacing: 0.14 })

  // the centre props, in their own box
  line(0.045, GOLD)
  g.globalAlpha = 0.85
  box(PROPS_BOX, 0.3)
  g.globalAlpha = 1
  line(0.04)
  const a7 = area('any7')
  box(a7, 0.12)
  text('SEVEN', mid(a7).u - 0.9, mid(a7).v + 0.03, 0.56, { color: RED, spacing: 0.08 })
  text('4 TO 1', mid(a7).u + 1.75, mid(a7).v + 0.02, 0.28, { font: FONT, weight: '800' })
  const pays: Record<string, [string, Die, Die]> = {
    hard4: ['7 TO 1', 2, 2],
    hard6: ['9 TO 1', 3, 3],
    hard8: ['9 TO 1', 4, 4],
    hard10: ['7 TO 1', 5, 5],
    aces: ['30 TO 1', 1, 1],
    aceDeuce: ['15 TO 1', 1, 2],
    yo: ['15 TO 1', 5, 6],
    boxcars: ['30 TO 1', 6, 6],
  }
  for (const [k, [pay, d1, d2]] of Object.entries(pays)) {
    const a = area(k)
    box(a, 0.1)
    const hard = k.startsWith('hard')
    const dv = a.v + (hard ? 0.5 : 0.42)
    const ds = hard ? 0.42 : 0.36
    feltDie(g, U(mid(a).u - ds * 0.6), U(dv), U(ds), d1)
    feltDie(g, U(mid(a).u + ds * 0.6), U(dv), U(ds), d2)
    text(pay, mid(a).u, a.v + a.h - (hard ? 0.27 : 0.22), 0.2, { font: FONT, weight: '800', color: GOLD })
  }
  const ac = area('anyCraps')
  box(ac, 0.12)
  text('ANY CRAPS', mid(ac).u - 0.75, mid(ac).v + 0.03, 0.44, { color: RED, spacing: 0.06 })
  text('7 TO 1', mid(ac).u + 1.85, mid(ac).v + 0.02, 0.26, { font: FONT, weight: '800' })

  // the house's mark in the landing zone: the Boje gem and the word, faint gold
  g.save()
  g.globalAlpha = 0.13
  g.translate(U(MARK_AT.u), U(MARK_AT.v - 0.5))
  const k = U(1.9) / 32
  g.scale(k, k)
  g.translate(-16, -16)
  g.strokeStyle = GOLD
  g.lineWidth = 1.1
  g.stroke(new Path2D(BOJE_HEX))
  g.fillStyle = GOLD
  g.fill(new Path2D(BOJE_B))
  g.restore()
  g.globalAlpha = 0.16
  text('BOJE  CASINO', MARK_AT.u, MARK_AT.v + 1.0, 0.36, { font: FONT, weight: '800', color: GOLD, spacing: 0.3 })
  g.globalAlpha = 1

  // shade where the felt meets the walls
  const shade = (x0: number, y0: number, x1: number, y1: number) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1)
    gr.addColorStop(0, 'rgba(0, 12, 6, 0.55)')
    gr.addColorStop(1, 'rgba(0, 12, 6, 0)')
    g.fillStyle = gr
    g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || W, Math.abs(y1 - y0) || H)
  }
  const sw = U(0.55)
  shade(0, 0, sw, 0)
  shade(W, 0, W - sw, 0)
  shade(0, 0, 0, sw)
  shade(0, H, 0, H - sw)

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** the felt, its layout printed, filling the tub's floor */
export function felt() {
  feltTex ??= paintFelt(faceSize() >= 512 ? 128 : 80)
  feltMat ??= new THREE.MeshPhysicalMaterial({ map: feltTex, roughness: 0.92, sheen: 0.5, sheenRoughness: 0.75, sheenColor: new THREE.Color('#5fd39b'), envMapIntensity: 0.45 })
  feltGeo ??= new THREE.PlaneGeometry(FELT_W, FELT_L).rotateX(-Math.PI / 2)
  const m = new THREE.Mesh(feltGeo, feltMat)
  m.receiveShadow = true
  return m
}

/** waits (a moment at most, and never fails) for the house font the felt's print is lettered in */
export async function feltFonts() {
  if (document.fonts.check(`800 20px ${FONT}`)) return
  await Promise.race([document.fonts.load(`800 20px ${FONT}`).catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
}

/* ---------------- the tub and the rail ---------------- */

/**
 * The rounded rectangle the tub's walls follow, offset `d` outwards: points round it (anticlockwise seen from above,
 * starting mid-way along the near wall) with their outward normals and the distance along.
 */
function outline(d: number, arcSeg = 10) {
  const pts: { x: number; z: number; nx: number; nz: number; s: number }[] = []
  const r = CORNER_R + d
  const hx = HALF_W - CORNER_R
  const hz = NEAR_Z - CORNER_R
  // corner centres, in order round the tub, and the angle each corner's arc starts at
  const corners: [number, number, number][] = [
    [hx, hz, Math.PI / 2],
    [hx, -hz, 0],
    [-hx, -hz, -Math.PI / 2],
    [-hx, hz, Math.PI],
  ]
  pts.push({ x: 0, z: NEAR_Z + d, nx: 0, nz: 1, s: 0 })
  for (const [cx, cz, a0] of corners)
    for (let k = 0; k <= arcSeg; k++) {
      const a = a0 - (k / arcSeg) * (Math.PI / 2)
      const nx = Math.cos(a)
      const nz = Math.sin(a)
      pts.push({ x: cx + nx * r, z: cz + nz * r, nx, nz, s: 0 })
    }
  pts.push({ x: 0, z: NEAR_Z + d, nx: 0, nz: 1, s: 0 })
  for (let i = 1; i < pts.length; i++) pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return pts
}

/**
 * A surface swept round the tub: `profile` is a list of (d, y) points across it (d outwards from the walls' face, y
 * up), the side it shows to the right of the way it is traced (traced inwards across a top, it faces up; traced
 * down a wall, it faces into the tub); smooth along the sweep and across the profile.
 */
function sweep(profile: readonly [number, number][]) {
  const M = profile.length
  // the profile's normals in its own plane (d, y), averaged at the joints
  const pn: [number, number][] = profile.map((_, i) => {
    const a = profile[Math.max(0, i - 1)]
    const b = profile[Math.min(M - 1, i + 1)]
    const td = b[0] - a[0]
    const ty = b[1] - a[1]
    const l = Math.hypot(td, ty) || 1
    return [ty / l, -td / l]
  })
  const rings = profile.map(([d]) => outline(d))
  const L = rings[0].length
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let along = 0
  for (let j = 0; j < M; j++) {
    const [, y] = profile[j]
    if (j) along += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1])
    for (const p of rings[j]) {
      pos.push(p.x, y, p.z)
      nor.push(p.nx * pn[j][0], pn[j][1], p.nz * pn[j][0])
      uv.push(p.s, along)
    }
  }
  // the triangles wound to face the way the normals do (the profile may be traced either way round)
  const P = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2])
  const face = new THREE.Vector3().subVectors(P(L), P(0)).cross(new THREE.Vector3().subVectors(P(1), P(0)))
  const flip = face.dot(new THREE.Vector3(nor[0] + nor[3], nor[1] + nor[4], nor[2] + nor[5])) < 0
  for (let j = 0; j < M - 1; j++)
    for (let i = 0; i < L - 1; i++) {
      const a = j * L + i
      const b = a + L
      if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b)
      else idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** a soft streaky grain along u (for the wood), as a tiling texture */
function grainTexture(light: string, dark: string) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = light
  g.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * c.height
    g.strokeStyle = dark
    g.globalAlpha = 0.05 + Math.random() * 0.14
    g.lineWidth = 0.6 + Math.random() * 2.4
    g.beginPath()
    g.moveTo(0, y)
    for (let x = 0; x <= c.width; x += 32) g.lineTo(x, y + Math.sin(x * 0.006 + i) * 3 + (Math.random() - 0.5) * 1.5)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / 6, 2)
  t.anisotropy = 8
  return t
}

let tubGeos: THREE.BufferGeometry[] | null = null
let woodTex: THREE.CanvasTexture | null = null
let tubMats: THREE.Material[] | null = null

/**
 * The walls, the rail and the body: wall felt, varnished walnut (lip and chip groove), the leather arm rest, the
 * lacquered apron with its brass bead, and the dark body below
 */
export function tub() {
  const H = WALL_H
  tubGeos ??= [
    // the walls' face, felt-covered, from the felt up to the rail
    sweep([
      [0, H + 0.02],
      [0, 0],
    ]),
    // the walnut: a rounded lip over the wall, the chip groove, up to the arm rest
    sweep([
      [0.16, H + 0.26],
      [0.05, H + 0.24],
      [-0.01, H + 0.16],
      [-0.02, H + 0.02],
      [0.02, H - 0.02],
    ]),
    sweep([
      [1.12, H + 0.28],
      [1.02, H + 0.26],
      [0.98, H + 0.12],
      [0.92, H + 0.08],
      [0.32, H + 0.08],
      [0.26, H + 0.12],
      [0.22, H + 0.26],
      [0.16, H + 0.26],
    ]),
    // the leather arm rest, padded round
    sweep([
      [2.06, H - 0.1],
      [2.2, H + 0.14],
      [2.18, H + 0.42],
      [2.0, H + 0.66],
      [1.7, H + 0.78],
      [1.4, H + 0.72],
      [1.2, H + 0.52],
      [1.12, H + 0.3],
    ]),
    // the apron under the rail: a lacquered band, a brass bead along its top
    sweep([
      [1.86, H - 1.9],
      [2.02, H - 1.72],
      [2.04, H - 0.27],
    ]),
    sweep([
      [2.04, H - 0.27],
      [2.1, H - 0.23],
      [2.12, H - 0.17],
      [2.09, H - 0.11],
      [2.03, H - 0.09],
    ]),
    // and the table's body below, set back, down to the floor
    sweep([
      [1.55, FLOOR_Y],
      [1.55, H - 2.05],
      [1.86, H - 1.9],
    ]),
  ]
  woodTex ??= grainTexture('#7a4426', '#2b1208')
  tubMats ??= [
    new THREE.MeshStandardMaterial({ color: '#0a4a31', roughness: 0.95, envMapIntensity: 0.35 }),
    new THREE.MeshPhysicalMaterial({ map: woodTex, color: '#b8805a', roughness: 0.42, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 0.9 }),
    new THREE.MeshPhysicalMaterial({ color: '#2a0d10', roughness: 0.46, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.35, sheenRoughness: 0.45, sheenColor: new THREE.Color('#a35a5e'), envMapIntensity: 0.9 }),
    new THREE.MeshPhysicalMaterial({ color: '#2c140b', roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 0.8 }),
    new THREE.MeshStandardMaterial({ color: '#e4bf6e', metalness: 1, roughness: 0.3, envMapIntensity: 1.1 }),
    new THREE.MeshStandardMaterial({ color: '#0d0705', roughness: 0.7, envMapIntensity: 0.3 }),
  ]
  const [wallM, woodM, leatherM, apronM, brassM, bodyM] = tubMats
  const meshes = [wallM, woodM, woodM, leatherM, apronM, brassM, bodyM].map((m, i) => new THREE.Mesh(tubGeos![i], m))
  meshes[0].receiveShadow = true
  return meshes
}

/* ---------------- the floor ---------------- */

/**
 * The casino's carpet round the table: deep burgundy with gold medallions, lit by the lamp's spill near the table and
 * fading into the dark, with the table's own soft shadow at its foot. Worked out in its shader (no texture).
 */
const FLOOR_FRAG = /* glsl */ `
varying vec3 vW;
void main() {
  vec2 p = vW.xz;
  // the pattern: medallions on a square grid, smaller lozenges between (its lines eased over a pixel, so the
  // carpet doesn't shimmer far off)
  vec2 g = p / 2.2;
  vec2 c = fract(g) - 0.5;
  float d = length(c);
  float aa = fwidth(d) * 1.2;
  float ring = 1.0 - smoothstep(0.02 - aa, 0.02 + aa, abs(d - 0.3));
  float petals = 1.0 - smoothstep(0.03 - aa, 0.03 + aa, abs(d - 0.16 - 0.045 * cos(atan(c.y, c.x) * 8.0)));
  vec2 e = abs(fract(g + 0.5) - 0.5);
  float ea = fwidth(e.x + e.y) * 1.2;
  float loz = 1.0 - smoothstep(0.02 - ea, 0.02 + ea, abs(e.x + e.y - 0.11));
  vec3 col = vec3(0.034, 0.009, 0.011);
  col = mix(col, vec3(0.12, 0.08, 0.035), (ring * 0.8 + petals * 0.5) * 0.28);
  col = mix(col, vec3(0.025, 0.06, 0.055), loz * 0.2);
  // the lamp's spill round the table, and the table's shadow at its foot
  float r = length(max(abs(p) - vec2(7.9, 14.4), 0.0));
  col *= (0.08 + 0.92 * exp(-r * 0.12)) * (0.35 + 0.65 * smoothstep(0.0, 3.5, r));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

let floorGeo: THREE.BufferGeometry | null = null
let floorMat: THREE.ShaderMaterial | null = null
export function floor() {
  floorGeo ??= new THREE.CircleGeometry(160, 64).rotateX(-Math.PI / 2).translate(0, FLOOR_Y, 0)
  floorMat ??= new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: FLOOR_FRAG,
  })
  return new THREE.Mesh(floorGeo, floorMat)
}

/* ---------------- the backboard ---------------- */

let pyrGeo: THREE.BufferGeometry | null = null
let rubberMat: THREE.MeshStandardMaterial | null = null

/** clips a polygon (x, y, z points) to x0 <= x <= x1, y0 <= y <= y1 (Sutherland-Hodgman) */
function clipRect(poly: THREE.Vector3[], x0: number, x1: number, y0: number, y1: number) {
  const edges: [(p: THREE.Vector3) => number][] = [[(p) => p.x - x0], [(p) => x1 - p.x], [(p) => p.y - y0], [(p) => y1 - p.y]]
  let out = poly
  for (const [f] of edges) {
    const inp = out
    out = []
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i]
      const b = inp[(i + 1) % inp.length]
      const fa = f(a)
      const fb = f(b)
      if (fa >= 0) out.push(a)
      if (fa >= 0 !== fb >= 0) out.push(a.clone().lerp(b, fa / (fa - fb)))
    }
    if (!out.length) break
  }
  return out
}

/** the rubber pyramids on the backboard: the physics' lattice, each facet flat, clipped to the board */
export function backboard() {
  if (!pyrGeo) {
    const pos: number[] = []
    const lat = (u: number, v: number, z: number) => new THREE.Vector3((PYR_P * (u + v)) / 2, (PYR_P * (u - v)) / 2, z)
    const x0 = -HALF_W + CORNER_R * 0.6
    const x1 = HALF_W - CORNER_R * 0.6
    const span = Math.ceil((HALF_W + WALL_H) / PYR_P) + 2
    for (let iu = -span; iu <= span; iu++)
      for (let iv = -span; iv <= span; iv++) {
        const tip = lat(iu + 0.5, iv + 0.5, BACK_Z + PYR_D)
        if (tip.y < -PYR_P || tip.y > WALL_H + PYR_P || Math.abs(tip.x) > HALF_W + PYR_P) continue
        const c = [lat(iu, iv, BACK_Z), lat(iu + 1, iv, BACK_Z), lat(iu + 1, iv + 1, BACK_Z), lat(iu, iv + 1, BACK_Z)]
        for (let k = 0; k < 4; k++) {
          // tip, then the base corners in the order that faces the facet out (towards +z)
          const poly = clipRect([tip, c[(k + 1) % 4], c[k]], x0, x1, 0, WALL_H)
          if (poly.length < 3) continue
          const n = new THREE.Vector3().subVectors(poly[1], poly[0]).cross(new THREE.Vector3().subVectors(poly[2], poly[0]))
          const flip = n.z < 0
          for (let i = 1; i < poly.length - 1; i++) {
            const tri = flip ? [poly[0], poly[i + 1], poly[i]] : [poly[0], poly[i], poly[i + 1]]
            for (const p of tri) pos.push(p.x, p.y, p.z)
          }
        }
      }
    pyrGeo = new THREE.BufferGeometry()
    pyrGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    pyrGeo.computeVertexNormals()
  }
  rubberMat ??= new THREE.MeshStandardMaterial({ color: '#1b1719', roughness: 0.48, envMapIntensity: 1.1, flatShading: true })
  const m = new THREE.Mesh(pyrGeo, rubberMat)
  m.receiveShadow = true
  return m
}

/* ---------------- the stick ---------------- */

/** the hook at the stick's end: half its width (it holds both dice, gathered side by side) */
export const HOOK_R = 1.3
let stickGeos: THREE.BufferGeometry[] | null = null
let stickMat: THREE.MeshPhysicalMaterial | null = null

/**
 * The stickman's stick: a long, thin rod of varnished ash (a unit long along +y from its foot: the scene stretches
 * it from the hook to the stickman's hand) and the hook it ends in, a flat half loop lying on the felt, opening
 * towards +z (it gathers the dice and pushes them that way), the rod meeting it at +x.
 */
export function stick() {
  stickGeos ??= [
    new THREE.CylinderGeometry(0.05, 0.06, 1, 10, 1).translate(0, 0.5, 0),
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => new THREE.Vector3(Math.cos((i / 8) * Math.PI) * HOOK_R, 0, -Math.sin((i / 8) * Math.PI) * HOOK_R * 0.8))),
      32,
      0.055,
      8,
    ),
  ]
  stickMat ??= new THREE.MeshPhysicalMaterial({ color: '#d6a46a', roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.9 })
  const rod = new THREE.Mesh(stickGeos[0], stickMat)
  const hook = new THREE.Mesh(stickGeos[1], stickMat)
  rod.castShadow = hook.castShadow = true
  return { rod, hook }
}

/* ---------------- the puck ---------------- */

export const PUCK_R = 0.5
export const PUCK_T = 0.16
let puckGeos: THREE.BufferGeometry[] | null = null
let puckMats: THREE.Material[] | null = null

/** one side of the puck: a disc with its word, ON (black on white) or OFF (white on black) */
function puckFace(on: boolean) {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  g.fillStyle = on ? '#f4f1ea' : '#141214'
  g.fillRect(0, 0, S, S)
  g.strokeStyle = on ? '#141214' : '#f4f1ea'
  g.lineWidth = 7
  g.beginPath()
  g.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = on ? '#141214' : '#f4f1ea'
  g.font = `800 ${on ? 104 : 88}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(on ? 'ON' : 'OFF', S / 2, S / 2 + 6)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** the puck: a thick disc, ON face up (+y) and OFF face down; turn it over for OFF */
export function puck() {
  puckGeos ??= [new THREE.CylinderGeometry(PUCK_R, PUCK_R, PUCK_T, 48, 1, true), new THREE.CircleGeometry(PUCK_R, 48).rotateX(-Math.PI / 2).translate(0, PUCK_T / 2, 0), new THREE.CircleGeometry(PUCK_R, 48).rotateX(Math.PI / 2).translate(0, -PUCK_T / 2, 0)]
  puckMats ??= [
    new THREE.MeshPhysicalMaterial({ color: '#2a2628', roughness: 0.35, clearcoat: 0.6 }),
    new THREE.MeshPhysicalMaterial({ map: puckFace(true), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
    new THREE.MeshPhysicalMaterial({ map: puckFace(false), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
  ]
  const g = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(puckGeos[i], puckMats[i])
    m.castShadow = true
    g.add(m)
  }
  return g
}

/**
 * Lets go of a renderer that is closing: every cached material, texture and geometry holds a 'dispose' listener from
 * each renderer that drew it, and through it the whole renderer. Disposing them drops those listeners and the GPU
 * copies; the objects stay cached for the next visit.
 */
export function releaseModels() {
  releaseDiceGeometry()
  diceTex?.map.dispose()
  diceMat?.dispose()
  feltTex?.dispose()
  feltMat?.dispose()
  feltGeo?.dispose()
  for (const g of tubGeos ?? []) g.dispose()
  woodTex?.dispose()
  for (const m of tubMats ?? []) m.dispose()
  pyrGeo?.dispose()
  rubberMat?.dispose()
  floorGeo?.dispose()
  floorMat?.dispose()
  for (const g of stickGeos ?? []) g.dispose()
  stickMat?.dispose()
  for (const g of puckGeos ?? []) g.dispose()
  for (const m of puckMats ?? []) {
    ;(m as THREE.MeshPhysicalMaterial).map?.dispose()
    m.dispose()
  }
}
