import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { glowTexture } from '../../lib/three/fx'
import { T, VKit } from '../../lib/three/toon'
import { INK, toonMaterial } from './models'

/*
  The stadium at night, built in code: a striped pitch with its markings (a shader, so the lines stay crisp at any
  size), the goal with posts outlined in ink and a net that bulges and ripples where the ball hits it (displaced in
  the vertex shader), LED boards behind the goal line, a stand rising behind them packed with an instanced crowd that
  bobs, jumps, throws its arms up and does the wave (all in the vertex shader, one draw call), flags waving in the
  crowd, floodlights on towers and along the roof, and a starry sky.
  The goal line is z = 0 with the goal centred on x = 0, the posts at x = ±3.66 and the bar 2.44 up; the pitch runs
  towards +z, where the striker stands.
*/

export const GOAL = { hw: 3.66, h: 2.44, post: 0.07 }
/** the net: its roof slopes back to TOP_BACK, its back wall down to BOTTOM_BACK */
export const NET = { topBackZ: -1.05, topBackY: 2.28, bottomBackZ: -2.0 }
export const BOARD_Z = -4.4
const STAND_Z = -6.2
const STAND_Y = 1.45
const ROW_D = 0.8
const ROW_H = 0.42
export const ROWS = 11
export const STAND_HW = 31
/** the front edge of the stand's roof, where the floodlights hang */
export const ROOF = { y: 8.9, z: -9.4 }

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

export interface Stadium {
  root: THREE.Group
  net: THREE.ShaderMaterial
  pitch: THREE.ShaderMaterial
  crowd: THREE.ShaderMaterial
  flags: THREE.ShaderMaterial
  sky: THREE.ShaderMaterial
  boards: {
    mat: THREE.MeshBasicMaterial
    normal: THREE.CanvasTexture
    goal: THREE.CanvasTexture
    saved: THREE.CanvasTexture
    perfect: THREE.CanvasTexture
    /** a message of our own, written with `write` */
    custom: THREE.CanvasTexture
    write: (text: string) => void
  }
  /** the lamp heads, flashed in a party, and their beams */
  lamps: THREE.MeshBasicMaterial
  beams: THREE.ShaderMaterial
  glare: THREE.SpriteMaterial[]
  /** seats where a camera flash can go off (world positions) */
  seats: THREE.Vector3[]
  own: { dispose: () => void }[]
}

/* ------------------------------------------------------------------ */
/*  Shaders                                                             */
/* ------------------------------------------------------------------ */

const PITCH_VERT = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`

const PITCH_FRAG = /* glsl */ `
varying vec3 vW;
uniform float uTime;
uniform float uFlash;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lineX(float v, float w) { float f = fwidth(v); return 1.0 - smoothstep(w - f, w + f, abs(v)); }
float seg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * h);
  float f = fwidth(d);
  return 1.0 - smoothstep(w - f, w + f, d);
}
void main() {
  vec2 p = vW.xz;
  // mown stripes across the pitch, every 4.5 m, and a finer checker the other way
  float band = mod(floor((p.y + 40.0) / 4.5), 2.0);
  float cross = mod(floor((p.x + 60.0) / 9.0), 2.0);
  vec3 a = vec3(0.16, 0.56, 0.22);
  vec3 b = vec3(0.13, 0.47, 0.19);
  vec3 col = mix(a, b, band);
  col *= 0.96 + 0.05 * cross;
  // grass grain
  float g = hash(floor(p * 9.0));
  col *= 0.94 + 0.08 * g;
  // the goal mouth and the spot are worn
  vec2 w0 = (p - vec2(0.0, 0.6)) * vec2(0.28, 0.75);
  vec2 w1 = (p - vec2(0.0, 11.0)) / 0.9;
  float wear = exp(-dot(w0, w0)) * 0.55 + exp(-dot(w1, w1)) * 0.6;
  col = mix(col, vec3(0.45, 0.42, 0.2), wear * 0.55);
  // markings
  float w = 0.06;
  float m = 0.0;
  m = max(m, seg(p, vec2(-34.0, 0.0), vec2(34.0, 0.0), w));
  m = max(m, seg(p, vec2(-9.16, 0.0), vec2(-9.16, 5.5), w));
  m = max(m, seg(p, vec2(9.16, 0.0), vec2(9.16, 5.5), w));
  m = max(m, seg(p, vec2(-9.16, 5.5), vec2(9.16, 5.5), w));
  m = max(m, seg(p, vec2(-20.16, 0.0), vec2(-20.16, 16.5), w));
  m = max(m, seg(p, vec2(20.16, 0.0), vec2(20.16, 16.5), w));
  m = max(m, seg(p, vec2(-20.16, 16.5), vec2(20.16, 16.5), w));
  // the penalty spot and the arc outside the box
  float spot = length(p - vec2(0.0, 11.0));
  m = max(m, 1.0 - smoothstep(0.14, 0.14 + fwidth(spot) * 1.5, spot));
  float arcD = abs(length(p - vec2(0.0, 11.0)) - 9.15);
  m = max(m, (1.0 - smoothstep(w - fwidth(arcD), w + fwidth(arcD), arcD)) * step(16.5, p.y));
  col = mix(col, vec3(0.95, 0.97, 0.93), m * 0.92);
  // floodlight pools and the dark beyond them
  vec2 pl = (p - vec2(0.0, 6.0)) * vec2(0.045, 0.06);
  float pool = exp(-dot(pl, pl));
  col *= 0.55 + 0.6 * pool;
  col *= 1.0 + uFlash * 0.25;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

const NET_VERT = /* glsl */ `
attribute vec3 aOut;
attribute vec2 aGrid;
attribute float aPin;
uniform vec3 uHit;
uniform float uAmp;
uniform float uT;
uniform float uTime;
varying vec2 vGrid;
varying float vShade;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float d = length(w.xyz - uHit);
  // a push that peaks fast and springs back, and a ring rippling out from it
  float env = uT < 0.0 ? 0.0 : (1.0 - exp(-uT * 40.0)) * exp(-uT * 3.2) * (0.75 + 0.25 * cos(uT * 15.0));
  float bulge = uAmp * exp(-d * d / 0.75) * env;
  float ripple = uT < 0.0 ? 0.0 : uAmp * 0.3 * sin(d * 6.5 - uT * 18.0) * exp(-uT * 2.0) * exp(-d * 0.7) * step(d, uT * 3.2 + 0.3);
  // a breath of wind
  float breeze = 0.012 * sin(uTime * 1.3 + w.x * 0.8 + w.y * 1.1);
  // the mesh is drawn in towards the pocket (along the net, not just away from us), so its lines visibly bend
  vec3 toHit = uHit - w.xyz;
  vec3 inPlane = toHit - aOut * dot(toHit, aOut);
  float pinch = clamp(bulge * 1.3, 0.0, 0.7);
  w.xyz += (aOut * (bulge + ripple + breeze) + inPlane * pinch) * aPin;
  vGrid = aGrid;
  // the pocket falls into shadow, its rim catches the light
  float pocket = clamp(bulge * 2.2, 0.0, 1.0);
  vShade = 0.92 - 0.55 * pocket + 0.3 * clamp(abs(ripple) * 6.0, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const NET_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec2 vGrid;
varying float vShade;
void main() {
  // a diamond mesh: lines along both diagonals of the grid, each a distance to the nearest whole number
  vec2 g = vec2(vGrid.x + vGrid.y, vGrid.x - vGrid.y) * 0.7071;
  vec2 d = abs(fract(g + 0.5) - 0.5);
  vec2 fw = fwidth(g);
  vec2 l = 1.0 - smoothstep(vec2(0.06) - fw, vec2(0.06) + fw, d);
  float a = max(l.x, l.y);
  // where the mesh is too fine to draw it fades to an even veil instead of shimmering
  float fine = clamp(max(fw.x, fw.y) * 2.2 - 0.25, 0.0, 1.0);
  a = mix(a, 0.3, fine) * uAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.96, 0.97, 1.0) * vShade, a);
}`

const CROWD_VERT = /* glsl */ `
attribute float aFlat;
attribute float aPart;
attribute vec3 iPos;
attribute vec3 iShirt;
attribute vec3 iSkin;
attribute vec4 iSeed;
uniform float uTime;
uniform float uCheer;
uniform float uGroan;
uniform float uWaveX;
uniform float uWaveAmp;
varying vec3 vCol;
varying float vFlat;
varying float vLight;
void main() {
  vec3 p = position * iSeed.w;
  vec3 n = normal;
  float ph = iSeed.x * 6.2831;
  float e = iSeed.y;
  float wx = (iPos.x - uWaveX) / 3.2;
  float w = uWaveAmp * exp(-wx * wx);
  float cheer = clamp(uCheer * e, 0.0, 1.0);
  float jump = cheer * 0.34 * abs(sin(uTime * (6.0 + e * 1.5) + ph)) + w * 0.6 + 0.02 * sin(uTime * 1.6 + ph);
  float groan = clamp(uGroan * e, 0.0, 1.0);
  float armA = 0.15 + 0.05 * sin(uTime * 0.9 + ph) + cheer * (2.45 + 0.35 * sin(uTime * 8.0 + ph)) + w * 2.75 + groan * 2.55;
  if (aPart > 1.5 && aPart < 3.5) {
    float s = aPart < 2.5 ? 1.0 : -1.0;
    vec2 sh = vec2(s * 0.19, 0.6) * iSeed.w;
    vec2 q = p.xy - sh;
    float a = s * armA;
    float c = cos(a), si = sin(a);
    p.xy = sh + vec2(q.x * c - q.y * si, q.x * si + q.y * c);
    n.xy = vec2(n.x * c - n.y * si, n.x * si + n.y * c);
    // hands on heads when they groan: the forearm folds in
    p.x -= s * groan * 0.1 * smoothstep(0.3, 0.6, -q.y);
  }
  p.y += jump - groan * 0.05;
  vec3 world = iPos + p;
  vec3 tintc = aPart > 0.5 && aPart < 1.5 ? iSkin : (aPart > 3.5 ? iSkin * 0.3 + vec3(0.04) : iShirt);
  vCol = aFlat > 0.5 ? color : color * tintc;
  vFlat = aFlat;
  vec3 L = normalize(vec3(0.25, 0.7, 0.65));
  float d = dot(normalize(n), L);
  // the stand is in the roof's shade: darker than the floodlit pitch, the back rows darkest
  float shade = 0.72 - clamp((iPos.y - 1.4) / 5.0, 0.0, 1.0) * 0.16;
  vLight = (d > 0.45 ? 1.0 : d > 0.0 ? 0.8 : 0.6) * shade;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

const CROWD_FRAG = /* glsl */ `
uniform float uFlash;
varying vec3 vCol;
varying float vFlat;
varying float vLight;
void main() {
  vec3 c = vFlat > 0.5 ? vCol : vCol * vLight * (0.95 + uFlash * 0.4);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`

const FLAG_VERT = /* glsl */ `
attribute vec4 iFlag;
uniform float uTime;
uniform float uCheer;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  vec3 p = position;
  // the cloth waves out from the pole, more when the crowd goes wild
  float wild = 0.35 + uCheer * 0.65;
  float t = uTime * (3.0 + wild * 3.0) + iFlag.x * 6.2831;
  float k = max(0.0, uv.x);
  float wave = sin(k * 5.0 - t) * 0.16 * k * wild + sin(k * 9.0 - t * 1.3) * 0.05 * k;
  p.z += wave;
  p.y += sin(k * 3.0 - t * 0.7) * 0.05 * k;
  vShade = 0.82 + 0.25 * cos(k * 5.0 - t);
  // the whole flag swings on its pole
  float sw = sin(uTime * (1.5 + wild * 2.0) + iFlag.x * 9.0) * (0.25 + wild * 0.45);
  float c = cos(sw), s = sin(sw);
  vec2 xy = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  p.xy = xy;
  vec3 world = p + iFlag.yzw;
  world.y += uCheer * 0.25 * abs(sin(uTime * 6.0 + iFlag.x * 5.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

const FLAG_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vShade;
void main() {
  vec4 c = vUv.x < -0.5 ? vec4(0.62, 0.64, 0.7, 1.0) : texture2D(uMap, vUv);
  gl_FragColor = vec4(c.rgb * (vUv.x < -0.5 ? 0.8 : vShade) * 0.85, 1.0);
  #include <colorspace_fragment>
}`

const SKY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform float uFlash;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y);
  // deep night blue, glowing towards the horizon where the stadium lights catch the haze
  vec3 col = mix(vec3(0.05, 0.07, 0.2), vec3(0.01, 0.015, 0.06), smoothstep(0.35, 1.0, uv.y));
  float hz = (uv.y - 0.3) * 3.2;
  col += vec3(0.18, 0.2, 0.42) * exp(-hz * hz) * 0.6;
  // stars
  vec2 g = p * 70.0;
  vec2 id = floor(g);
  float h = hash(id);
  vec2 f = fract(g) - 0.5 - (vec2(hash(id + 1.7), hash(id + 3.1)) - 0.5) * 0.6;
  float star = step(0.965, h) * smoothstep(0.08, 0.0, length(f)) * (0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0));
  col += vec3(0.9, 0.92, 1.0) * star * smoothstep(0.35, 0.7, uv.y);
  col *= 1.0 + uFlash * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`

/* ------------------------------------------------------------------ */
/*  Builders                                                            */
/* ------------------------------------------------------------------ */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}
const FONT = 'Manrope, ui-rounded, system-ui, sans-serif'

/** the LED boards: a long strip of adverts, or a flashing message; `custom` is redrawn with drawBoard */
function boardTexture(kind: 'normal' | 'goal' | 'saved' | 'perfect' | 'custom') {
  const [c, g] = canvas(2048, 96)
  if (kind === 'custom') {
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.RepeatWrapping
    t.anisotropy = 4
    drawBoard(t, '')
    return t
  }
  const blocks: [string, string, string][] =
    kind === 'normal'
      ? [
          ['#0b1640', '#5cc8ff', 'BOJE CASINO'],
          ['#ff3b4e', '#ffffff', 'PENALTY SHOOTOUT'],
          ['#111018', '#ffd23f', '★ PLAY MONEY ★'],
          ['#2ef08c', '#062814', 'PICK YOUR CORNER'],
        ]
      : kind === 'goal'
        ? [
            ['#ffd23f', '#1d0f30', 'GOAL!'],
            ['#ff3b4e', '#ffffff', 'GOAL!'],
            ['#2ef08c', '#062814', 'GOAL!'],
            ['#5cc8ff', '#0b1640', 'GOAL!'],
          ]
        : kind === 'saved'
          ? [
              ['#111018', '#ff6f86', 'SAVED!'],
              ['#1d2a5a', '#ffffff', 'WHAT A SAVE'],
              ['#111018', '#ff6f86', 'SAVED!'],
              ['#1d2a5a', '#ffffff', 'WHAT A SAVE'],
            ]
          : [
              ['#ffd23f', '#1d0f30', 'PERFECT 10'],
              ['#ff4fd8', '#ffffff', '★ ★ ★'],
              ['#2fd3ff', '#0b1640', 'PERFECT 10'],
              ['#6dff5a', '#062814', '★ ★ ★'],
            ]
  const w = c.width / blocks.length
  blocks.forEach(([bg, fg, text], i) => {
    g.fillStyle = bg
    g.fillRect(i * w, 0, w, c.height)
    g.fillStyle = 'rgba(255,255,255,0.08)'
    g.fillRect(i * w, 0, w, c.height / 2)
    g.font = `900 ${kind === 'normal' ? 44 : 54}px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = fg
    g.fillText(text, i * w + w / 2, c.height / 2 + 3)
  })
  // the LED dot grid
  g.fillStyle = 'rgba(0,0,0,0.28)'
  for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1)
  for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, c.height)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

/** writes a message across the custom board texture: gold on deep blue, between little footballs */
function drawBoard(t: THREE.CanvasTexture, text: string) {
  const c = t.image as HTMLCanvasElement
  const g = c.getContext('2d')!
  // two long blocks to the strip (each a little wider than the goal), the text fitted inside with room to spare
  const n = 2
  const w = c.width / n
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `900 50px ${FONT}`
  const size = Math.min(50, (50 * w * 0.82) / Math.max(1, g.measureText(text).width))
  g.font = `900 ${size.toFixed(1)}px ${FONT}`
  for (let i = 0; i < n; i++) {
    const alt = i % 2 === 1
    g.fillStyle = alt ? '#ffd23f' : '#0b1640'
    g.fillRect(i * w, 0, w, c.height)
    g.fillStyle = 'rgba(255,255,255,0.08)'
    g.fillRect(i * w, 0, w, c.height / 2)
    g.fillStyle = alt ? '#1d0f30' : '#ffd23f'
    g.fillText(text, i * w + w / 2, c.height / 2 + 3)
  }
  g.fillStyle = 'rgba(0,0,0,0.28)'
  for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1)
  for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, c.height)
  t.needsUpdate = true
}

/** a flag's cloth: stripes in a few team colours */
function flagTexture() {
  const [c, g] = canvas(256, 512)
  const sets = [
    ['#ff3b4e', '#ffffff', '#ff3b4e'],
    ['#ffffff', '#ff3b4e', '#ffffff'],
    ['#ffd23f', '#1d2a5a', '#ffd23f'],
    ['#ff3b4e', '#ffd23f', '#ff3b4e'],
  ]
  // four flags, one per quarter of the texture (rows)
  sets.forEach((cols, i) => {
    const y0 = (i * c.height) / 4
    const h = c.height / 4
    cols.forEach((col, j) => {
      g.fillStyle = col
      g.fillRect((j * c.width) / 3, y0, c.width / 3 + 1, h)
    })
    // a star in the middle
    g.fillStyle = i === 2 ? '#1d2a5a' : '#ffd23f'
    g.beginPath()
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5
      const r = k % 2 ? 11 : 26
      g.lineTo(c.width / 2 + Math.cos(a) * r, y0 + h / 2 + Math.sin(a) * r)
    }
    g.fill()
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** a bilinear patch of the net between four corners, with its outward direction, mesh grid and pinned edges */
function netPatch(p00: THREE.Vector3, p10: THREE.Vector3, p01: THREE.Vector3, p11: THREE.Vector3, out: THREE.Vector3, nu: number, nv: number, cell: number, pin: [boolean, boolean, boolean, boolean]) {
  const pos: number[] = []
  const outs: number[] = []
  const grid: number[] = []
  const pins: number[] = []
  const idx: number[] = []
  const wU = p10.distanceTo(p00)
  const wV = p01.distanceTo(p00)
  const P = new THREE.Vector3()
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = i / nu
      const v = j / nv
      P.copy(p00).multiplyScalar((1 - u) * (1 - v)).addScaledVector(p10, u * (1 - v)).addScaledVector(p01, (1 - u) * v).addScaledVector(p11, u * v)
      pos.push(P.x, P.y, P.z)
      outs.push(out.x, out.y, out.z)
      grid.push((u * wU) / cell, (v * wV) / cell)
      // pinned to the frame (or the ground) at its edges: [u = 0, u = 1, v = 0, v = 1]
      const e = Math.min(pin[0] ? u : 1, pin[1] ? 1 - u : 1, pin[2] ? v : 1, pin[3] ? 1 - v : 1)
      pins.push(Math.min(1, e * 4) ** 0.8)
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aOut', new THREE.Float32BufferAttribute(outs, 3))
  g.setAttribute('aGrid', new THREE.Float32BufferAttribute(grid, 2))
  g.setAttribute('aPin', new THREE.Float32BufferAttribute(pins, 1))
  g.setIndex(idx)
  return g
}

/** one fan of the crowd: body, head, hair and two arms, each tagged so the shader can move the arms */
function fanGeometry() {
  const part = (build: (k: VKit) => void, id: number) => {
    const k = new VKit(INK, 0.045)
    build(k)
    const g = k.geometry()
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(id), 1))
    return g
  }
  const body = part((k) => k.add(new THREE.CapsuleGeometry(0.17, 0.26, 2, 6), '#ffffff', T([0, 0.42, 0], [0, 0, 0], [1, 1, 0.8])), 0)
  const head = part((k) => k.add(new THREE.SphereGeometry(0.125, 8, 5), '#ffffff', T([0, 0.83, 0.01])), 1)
  const hairG = part((k) => k.add(new THREE.SphereGeometry(0.13, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), '#ffffff', T([0, 0.85, -0.01], [-0.35, 0, 0]), 0), 4)
  const arm = (s: number) => part((k) => k.add(new THREE.CapsuleGeometry(0.05, 0.24, 1, 4), '#ffffff', T([s * 0.2, 0.46, 0.02], [0, 0, s * 0.08])), s > 0 ? 2 : 3)
  const g = mergeGeometries([body, head, hairG, arm(1), arm(-1)])
  for (const x of [body, head, hairG]) x.dispose()
  return g
}

/** the stand behind the goal: a stepped bank of seats, its front wall, the roof and the upper back wall */
function standGeometry() {
  // the profile, in (depth behind the goal line, height): the front wall, then a step per row
  const d0 = -STAND_Z
  const shape = new THREE.Shape()
  shape.moveTo(d0 - 0.8, 0)
  shape.lineTo(d0 - 0.8, STAND_Y)
  for (let i = 0; i < ROWS; i++) {
    const d = d0 + i * ROW_D
    const y = STAND_Y + i * ROW_H
    shape.lineTo(d, y)
    shape.lineTo(d + ROW_D, y)
    shape.lineTo(d + ROW_D, y + ROW_H)
  }
  const dTop = d0 + ROWS * ROW_D
  shape.lineTo(dTop + 0.6, STAND_Y + ROWS * ROW_H)
  shape.lineTo(dTop + 0.6, 0)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: STAND_HW * 2, bevelEnabled: false, curveSegments: 1 })
  // turn it so the depth runs along -z and the extrusion along x, centred
  g.rotateY(Math.PI / 2)
  g.translate(-STAND_HW, 0, 0)
  return g.index ? g.toNonIndexed() : g
}

export function buildStadium(opts: { mobile: boolean }): Stadium {
  const root = new THREE.Group()
  root.name = 'stadium'
  const own: { dispose: () => void }[] = []

  /* ---- the pitch ---- */
  const pitch = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } }, vertexShader: PITCH_VERT, fragmentShader: PITCH_FRAG })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), pitch)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(0, 0, 20)
  root.add(ground)
  own.push(ground.geometry, pitch)
  // the strip of ground behind the boards, under the stand
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 40), new THREE.MeshBasicMaterial({ color: '#0d1a14' }))
  apron.rotation.x = -Math.PI / 2
  apron.position.set(0, 0.002, BOARD_Z - 20)
  root.add(apron)
  own.push(apron.geometry, apron.material as THREE.Material)

  /* ---- the goal frame ---- */
  {
    const k = new VKit(INK, 0.035)
    const r = GOAL.post
    const white = '#f6f7fb'
    for (const s of [-1, 1]) k.add(new THREE.CylinderGeometry(r, r, GOAL.h + r, 16), white, T([s * GOAL.hw, (GOAL.h + r) / 2, 0]))
    k.add(new THREE.CylinderGeometry(r, r, GOAL.hw * 2 + r * 2, 16), white, T([0, GOAL.h, 0], [0, 0, Math.PI / 2]))
    // the back stanchions holding the net up
    const grey = '#9aa3b8'
    for (const s of [-1, 1]) {
      const a = V(s * GOAL.hw, GOAL.h - 0.05, -0.05)
      const b = V(s * GOAL.hw, NET.topBackY, NET.topBackZ)
      const c = V(s * GOAL.hw, 0.02, NET.bottomBackZ)
      for (const [p, q] of [[a, b], [b, c]] as const) {
        const len = p.distanceTo(q)
        const m = new THREE.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), q.clone().sub(p).normalize()), V(1, 1, 1))
        k.add(new THREE.CylinderGeometry(0.025, 0.025, len, 8), grey, m, 0.02)
      }
      // along the bottom from the post back
      const m = new THREE.Matrix4().compose(V(s * GOAL.hw, 0.02, NET.bottomBackZ / 2), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2), V(1, 1, 1))
      k.add(new THREE.CylinderGeometry(0.02, 0.02, -NET.bottomBackZ, 8), grey, m, 0.015)
    }
    k.add(new THREE.CylinderGeometry(0.02, 0.02, GOAL.hw * 2, 8), grey, T([0, 0.02, NET.bottomBackZ], [0, 0, Math.PI / 2]), 0.015)
    k.add(new THREE.CylinderGeometry(0.025, 0.025, GOAL.hw * 2, 8), grey, T([0, NET.topBackY, NET.topBackZ], [0, 0, Math.PI / 2]), 0.02)
    const frame = k.mesh('goal-frame', toonMaterial())
    root.add(frame)
    own.push(frame.geometry)
  }

  /* ---- the net ---- */
  const net = new THREE.ShaderMaterial({
    uniforms: { uHit: { value: V(0, 1, -2) }, uAmp: { value: 0 }, uT: { value: -1 }, uTime: { value: 0 }, uAlpha: { value: 0.95 } },
    vertexShader: NET_VERT,
    fragmentShader: NET_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  {
    const hw = GOAL.hw
    const cell = 0.16
    const back = netPatch(V(-hw, 0, NET.bottomBackZ), V(hw, 0, NET.bottomBackZ), V(-hw, NET.topBackY, NET.topBackZ), V(hw, NET.topBackY, NET.topBackZ), V(0, 1.0, -2.3).normalize(), 48, 18, cell, [true, true, true, true])
    const roof = netPatch(V(-hw, NET.topBackY, NET.topBackZ), V(hw, NET.topBackY, NET.topBackZ), V(-hw, GOAL.h, 0), V(hw, GOAL.h, 0), V(0, 1, -0.14).normalize(), 48, 8, cell, [true, true, true, true])
    const sides = [-1, 1].map((s) => netPatch(V(s * hw, 0, 0), V(s * hw, 0, NET.bottomBackZ), V(s * hw, GOAL.h, 0), V(s * hw, NET.topBackY, NET.topBackZ), V(s, 0, 0), 14, 16, cell, [true, true, true, true]))
    const g = mergeGeometries([back, roof, ...sides])
    for (const x of [back, roof, ...sides]) x.dispose()
    const m = new THREE.Mesh(g, net)
    m.renderOrder = 2
    m.name = 'net'
    root.add(m)
    own.push(g, net)
  }

  /* ---- LED boards behind the goal ---- */
  const tex = { normal: boardTexture('normal'), goal: boardTexture('goal'), saved: boardTexture('saved'), perfect: boardTexture('perfect'), custom: boardTexture('custom') }
  const boardMat = new THREE.MeshBasicMaterial({ map: tex.normal, toneMapped: false, color: new THREE.Color(0.95, 0.95, 0.95) })
  {
    const w = 60
    tex.normal.repeat.set(w / 17, 1)
    for (const t of [tex.goal, tex.saved, tex.perfect, tex.custom]) t.repeat.set(w / 17, 1)
    // a message block sits right behind the goal
    tex.custom.offset.x = 0.25 - (w / 17 / 2) % 1
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.95), boardMat)
    face.position.set(0, 0.5, BOARD_Z)
    root.add(face)
    // the board's dark casing and its shadow side
    const k = new VKit(INK, 0.03)
    k.add(new THREE.BoxGeometry(w, 1.05, 0.25), '#181a28', T([0, 0.52, BOARD_Z - 0.14]))
    const casing = k.mesh('boards', toonMaterial())
    root.add(casing)
    own.push(face.geometry, boardMat, casing.geometry, tex.normal, tex.goal, tex.saved, tex.perfect, tex.custom)
  }

  /* ---- the stand ---- */
  {
    const g = standGeometry()
    // per face: the treads are seats (navy, a red block behind the goal), the risers darker, the front wall darkest
    const pos = g.getAttribute('position')
    const nrm = g.getAttribute('normal')
    const col = new Float32Array(pos.count * 3)
    const navy = new THREE.Color('#26306a')
    const red = new THREE.Color('#9c2236')
    const riser = new THREE.Color('#141a3c')
    const wall = new THREE.Color('#1b2147')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i += 3) {
      const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
      const up = nrm.getY(i) > 0.5
      if (y < STAND_Y - 0.01) c.copy(wall)
      else if (up) c.copy(Math.abs(x) < 8 ? red : navy)
      else c.copy(riser)
      for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }))
    root.add(m)
    own.push(g, m.material as THREE.Material)
    // the front wall's lip, a railing in the club colours
    const k = new VKit(INK, 0.03)
    k.add(new THREE.BoxGeometry(STAND_HW * 2, 0.16, 0.3), '#ff3b4e', T([0, STAND_Y + 0.05, STAND_Z + 0.75]))
    // the upper back wall, and the roof: a dark canopy reaching out over the stand, its lit fascia at the front
    const topY = STAND_Y + ROWS * ROW_H
    const backZ = STAND_Z - ROWS * ROW_D - 0.6
    k.add(new THREE.BoxGeometry(STAND_HW * 2 + 1, ROOF.y - topY + 0.6, 0.6), '#121735', T([0, (ROOF.y + topY) / 2, backZ]))
    const depth = ROOF.z - backZ
    k.add(new THREE.BoxGeometry(STAND_HW * 2 + 2, 0.45, depth + 0.6), '#0e1228', T([0, ROOF.y + 0.15 + depth * 0.05, (ROOF.z + backZ) / 2], [-0.1, 0, 0]))
    k.add(new THREE.BoxGeometry(STAND_HW * 2 + 2, 0.8, 0.35), '#242c5c', T([0, ROOF.y + 0.15, ROOF.z + 0.15]))
    // pillars under the roof
    for (const x of [-21, -7, 7, 21]) k.add(new THREE.CylinderGeometry(0.2, 0.2, ROOF.y - topY + 0.4, 10), '#121735', T([x, (ROOF.y + topY) / 2, backZ + 1.2]))
    // end walls
    for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.8, ROOF.y + 0.6, ROWS * ROW_D + 3), '#161c40', T([s * (STAND_HW + 0.4), (ROOF.y + 0.6) / 2, STAND_Z - (ROWS * ROW_D) / 2 - 0.6]))
    const extra = k.mesh('stand-extra', toonMaterial())
    root.add(extra)
    own.push(extra.geometry)
  }

  /* ---- the crowd ---- */
  const seats: THREE.Vector3[] = []
  const crowd = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCheer: { value: 0 }, uGroan: { value: 0 }, uWaveX: { value: -100 }, uWaveAmp: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: CROWD_VERT,
    fragmentShader: CROWD_FRAG,
    vertexColors: true,
  })
  {
    const base = fanGeometry()
    const ig = new THREE.InstancedBufferGeometry()
    for (const name of ['position', 'normal', 'color', 'aFlat', 'aPart']) ig.setAttribute(name, base.getAttribute(name))
    const step = opts.mobile ? 0.84 : 0.66
    const shirts = ['#ec3a4c', '#ec3a4c', '#ec3a4c', '#e9ecf4', '#e9ecf4', '#c9505e', '#f2c94c', '#25336b', '#2b2f45', '#4fb2e6', '#b8bfd0']
    const skins = ['#f2c7a2', '#e9b48a', '#c98d62', '#9c6440', '#6e4228', '#f7d6bd']
    const pos: number[] = []
    const shirt: number[] = []
    const skin: number[] = []
    const seed: number[] = []
    const c = new THREE.Color()
    let rnd = 7
    const r01 = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647)
    for (let row = 0; row < ROWS; row++) {
      const z = STAND_Z - row * ROW_D - ROW_D * 0.45
      const y = STAND_Y + row * ROW_H
      // the last few metres by the end walls are never in the picture
      for (let x = -STAND_HW + 4; x <= STAND_HW - 4; x += step) {
        if (r01() < 0.05) continue
        const px = x + (r01() - 0.5) * 0.18
        pos.push(px, y, z + (r01() - 0.5) * 0.12)
        // the home end: mostly red and white, a few away shirts in the corners
        const away = Math.abs(px) > 22 && r01() < 0.55
        c.set(away ? (r01() < 0.5 ? '#ffd23f' : '#1d2a5a') : shirts[Math.floor(r01() * shirts.length)])
        shirt.push(c.r, c.g, c.b)
        c.set(skins[Math.floor(r01() * skins.length)])
        skin.push(c.r, c.g, c.b)
        seed.push(r01(), 0.55 + r01() * 0.6, r01(), 0.92 + r01() * 0.16)
        if (r01() < 0.25) seats.push(new THREE.Vector3(px, y + 0.85, z + 0.2))
      }
    }
    ig.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3))
    ig.setAttribute('iShirt', new THREE.InstancedBufferAttribute(new Float32Array(shirt), 3))
    ig.setAttribute('iSkin', new THREE.InstancedBufferAttribute(new Float32Array(skin), 3))
    ig.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 4))
    ig.instanceCount = pos.length / 3
    const m = new THREE.Mesh(ig, crowd)
    m.frustumCulled = false
    m.name = 'crowd'
    root.add(m)
    own.push(base, ig, crowd)
  }

  /* ---- flags in the crowd ---- */
  const flagTex = flagTexture()
  const flags = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uCheer: { value: 0 }, uMap: { value: flagTex } }, vertexShader: FLAG_VERT, fragmentShader: FLAG_FRAG, side: THREE.DoubleSide })
  {
    // [x, row]: a fan waving a flag on a pole
    const spots = [
      [-17, 2],
      [-9, 6],
      [-3, 9],
      [5, 3],
      [12, 7],
      [19, 2],
      [24, 9],
      [-23, 6],
      [1, 5],
      [-13, 10],
      [15, 10],
      [8, 10],
    ]
    const geos: THREE.BufferGeometry[] = []
    const flagSeed: number[] = []
    spots.forEach(([x, row], i) => {
      // the cloth off the top of the pole; uv.v picks one of the four flags in the texture, and the pole has uv.x = -1
      const cloth = new THREE.PlaneGeometry(1.5, 0.95, 12, 4)
      cloth.translate(0.75, 1.1, 0)
      const uv = cloth.getAttribute('uv')
      const which = i % 4
      for (let j = 0; j < uv.count; j++) uv.setY(j, (3 - which) / 4 + uv.getY(j) / 4)
      const pole = new THREE.BoxGeometry(0.05, 1.6, 0.05)
      pole.translate(0, 0.8, 0)
      const puv = pole.getAttribute('uv')
      for (let j = 0; j < puv.count; j++) puv.setXY(j, -1, 0)
      // held up from the fan's hands
      const y = STAND_Y + row * ROW_H + 0.85
      const z = STAND_Z - row * ROW_D - ROW_D * 0.45 + 0.1
      for (const g of [cloth, pole]) {
        const n = g.getAttribute('position').count
        for (let j = 0; j < n; j++) flagSeed.push((i * 0.137) % 1, x, y, z)
        geos.push(g)
      }
    })
    const g = mergeGeometries(geos)
    for (const x of geos) x.dispose()
    g.setAttribute('iFlag', new THREE.Float32BufferAttribute(flagSeed, 4))
    const m = new THREE.Mesh(g, flags)
    m.frustumCulled = false
    root.add(m)
    own.push(g, flags, flagTex)
  }

  /* ---- floodlights ---- */
  const lamps = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.35, 2.1), toneMapped: false })
  let beams!: THREE.ShaderMaterial
  const glare: THREE.SpriteMaterial[] = []
  {
    // banks of lamps hung under the roof's front edge, tilted down at the pitch, each with a soft glare
    const k = new VKit(INK, 0.05)
    const lampGeos: THREE.BufferGeometry[] = []
    const tilt: [number, number, number] = [0.55, 0, 0]
    const gm = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#fff3d2').multiplyScalar(0.75), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const halo = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#9fb6ff').multiplyScalar(0.18), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    glare.push(gm, halo)
    own.push(gm, halo)
    const y = ROOF.y - 0.75
    const z = ROOF.z + 0.25
    for (let x = -24; x <= 24.1; x += 8) {
      k.add(new THREE.BoxGeometry(3.0, 1.0, 0.35), '#2b3360', T([x, y, z], tilt))
      k.add(new THREE.BoxGeometry(0.15, 0.7, 0.15), '#2b3360', T([x, y + 0.6, z - 0.1]), 0)
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 2; j++) {
          const lg = new THREE.PlaneGeometry(0.58, 0.36)
          lg.applyMatrix4(T([-1.05 + i * 0.7, -0.22 + j * 0.44, 0.19]))
          lg.applyMatrix4(T([x, y, z], tilt))
          lampGeos.push(lg)
        }
      const sp = new THREE.Sprite(gm)
      sp.scale.set(7.5, 5, 1)
      sp.position.set(x, y - 0.2, z + 0.8)
      root.add(sp)
      const h = new THREE.Sprite(halo)
      h.scale.set(22, 14, 1)
      h.position.set(x, y - 1.5, z + 0.5)
      root.add(h)
    }
    // soft beams of light from each bank down through the haze to the pitch
    const beamGeos: THREE.BufferGeometry[] = []
    for (let x = -24; x <= 24.1; x += 8) {
      const top = V(x, y - 0.4, z + 0.3)
      const bot = V(x * 0.45, 0, 6 + Math.abs(x) * 0.1)
      const tw = 1.3
      const bw = 7.5
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute([top.x - tw, top.y, top.z, top.x + tw, top.y, top.z, bot.x + bw, bot.y, bot.z, bot.x - bw, bot.y, bot.z], 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2))
      g.setIndex([0, 3, 1, 1, 3, 2])
      beamGeos.push(g)
    }
    const beamGeo = mergeGeometries(beamGeos)
    for (const g of beamGeos) g.dispose()
    beams = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uK; varying vec2 vUv; void main() { vec2 q = clamp(vUv, 0.0, 1.0); float across = 1.0 - (q.x - 0.5) * (q.x - 0.5) * 4.0; float down = pow(q.y, 1.6) * smoothstep(0.0, 0.35, q.y); gl_FragColor = vec4(vec3(1.0, 0.96, 0.85), across * down * 0.075 * uK); }',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const beamMesh = new THREE.Mesh(beamGeo, beams)
    beamMesh.renderOrder = 5
    root.add(beamMesh)
    own.push(beamGeo, beams)
    const banks = k.mesh('floodlights', toonMaterial())
    root.add(banks)
    const lg = mergeGeometries(lampGeos)
    for (const x of lampGeos) x.dispose()
    const lm = new THREE.Mesh(lg, lamps)
    root.add(lm)
    own.push(banks.geometry, lg, lamps)
  }

  /* ---- the sky ---- */
  const sky = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uFlash: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: SKY_FRAG,
    depthWrite: false,
    depthTest: false,
  })
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sky)
    m.frustumCulled = false
    m.renderOrder = -10
    root.add(m)
    own.push(m.geometry, sky)
  }

  return { root, net, pitch, crowd, flags, sky, boards: { mat: boardMat, ...tex, write: (text: string) => drawBoard(tex.custom, text) }, lamps, beams, glare, seats, own }
}
