import * as THREE from 'three'
import { T, type P2, type P3 } from '../../lib/three/toon'
import { FLOOR_Y, swayInstances, swayMaterial, swayMesh } from './cast'
import { FIELD } from './rules'
import type { FieldSize } from './frame'
import { Bubbles, buildMotes } from './fx'
import { C, RKit, TAU, V, curve2, ell, fin, flatSurf, horn, limb, oval, paint, path3, smooth, smoothstep, star, stroke, tint, tubeR, warp, type Motion } from './kit'

/*
  The reef the game is played over, built in code like the cast. The swim plane is y = 0; the sea floor lies about
  FLOOR_Y below it, in gentle dunes (floorAt), and rises into a reef wall beyond the far edge and up the sides. It is
  laid out round the field it is built for (field.ts: the wide, mid or tall layout), so the borders are lush just
  outside whichever field is on show.

  - The floor: one big plane with its own shader: pale golden sand in soft patches, rippled bands stepped into a
    second tone, speckles, and two layers of animated caustic light dancing over it (crisp, toon-stepped, not a blur).
    It is seen through clear tropical water: a turquoise cast over it all, deeper in drifting patches and out of the
    sun's warm pool over the field, so the creatures' warm colours stand out against it.
  - The decor: rocks, bushy staghorn corals, sea fans, tube sponges, anemones, sea grass, kelp, starfish, scallops, a
    giant clam with its pearl, a sunken anchor and chain, and the timbers of a wreck (round domes and plates are left
    out: from this high they read as flat discs).
    It is laid out by a seeded hand (the same reef every visit): lush round the borders, sparse over the field so
    the cast reads against the sand. Every piece is a kit mesh in the cast's sway shader, the soft ones swaying in a
    current that rolls across the reef. It is split into chunks by area so the parts off screen (above and below the
    field on a tall phone) are culled.
  - Soft god rays fanning down from the top left (drawn under the cast), bubble streams rising from vents and the
    clam, and plankton motes drifting in the light.

  buildReef() returns the set; the scene adds `root`, calls tick(t, dt) every frame and resize(scale) when the
  canvas changes (the point sprites' size factor), and dispose() at the end. waterFog() is the fog to set on the
  scene for a camera at a given distance, so the far reef fades into blue.
*/

/** the water's colour (fog, background) */
export const WATER = '#1d8fb8'

/** the half size of the field the reef was last built round (the floor rises into walls beyond it) */
const edge = { hw: FIELD.w / 2, hh: FIELD.h / 2 }

/** the height of the sea floor at (x, z), round the field of the reef last built */
export function floorAt(x: number, z: number) {
  const { hw, hh } = edge
  const dunes = 0.16 * Math.sin(0.35 * x + 0.2 * z) + 0.1 * Math.sin(0.6 * z - 0.25 * x + 1.3) + 0.06 * Math.sin(1.1 * x + 0.9 * z)
  const wall = 0.75 * smoothstep(hh + 1.5, hh + 7.5, -z) + 0.45 * smoothstep(hw + 0.5, hw + 4.5, Math.abs(x)) + 0.3 * smoothstep(hh + 2.5, hh + 8.5, z)
  return FLOOR_Y + dunes + wall
}

/** the scene fog for a camera `dist` from the field: clear over the field, deep blue far off */
export function waterFog(dist: number) {
  return new THREE.Fog(WATER, dist * 0.86, dist * 1.75)
}

/* ---------------- the floor ---------------- */

const FLOOR_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`

const FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uSandA;
uniform vec3 uSandB;
uniform vec3 uShade;
uniform vec3 uWater;
uniform vec3 uLight;
varying vec3 vW;
varying vec3 vN;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// the classic tiling water-caustic web
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
void main() {
  vec2 p = vW.xz;
  // pale golden sand in soft patches, seen through the water's turquoise (more of it in drifting patches)
  float n = noise(p * 0.32) * 0.6 + noise(p * 1.05) * 0.4;
  vec3 sand = mix(uSandA, uSandB, smoothstep(0.38, 0.72, n));
  sand *= mix(vec3(1.0), uShade, uWater.x + smoothstep(0.5, 0.85, noise(p * 0.21 + 7.3)) * uWater.y);
  // rippled bands, stepped into a darker tone
  float w = sin(dot(p, vec2(0.85, 2.3)) * 1.5 + noise(p * 0.55) * 4.5);
  sand *= mix(1.0, 0.92, smoothstep(0.5, 0.66, w));
  sand *= mix(1.0, 1.04, smoothstep(0.7, 0.86, -w));
  // speckles: grains of darker and paler sand
  vec2 cell = floor(p * 8.0);
  float h = hash(cell);
  vec2 f = fract(p * 8.0) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5;
  float grain = step(length(f), 0.075) * step(0.8, h);
  sand *= mix(1.0, h > 0.9 ? 1.14 : 0.8, grain);
  // toon light from the sun: two tones, the shaded one cooler
  sand *= mix(uShade * 0.92, vec3(1.0), smoothstep(0.55, 0.7, dot(normalize(vN), uSun)));
  // the field sits in a warm pool of light; out of it the sand cools to teal and sinks into shade
  float pool = smoothstep(16.0, 4.5, length((p - vec2(0.0, -0.8)) * vec2(0.75, 1.0)));
  sand *= mix(uShade * 0.8, vec3(1.04), pool);
  // caustics: two webs drifting through each other, cut crisp
  float c1 = caustic(p * 0.105 + vec2(0.0, uTime * 0.008), uTime * 0.42 + 23.0);
  float c2 = caustic(p * 0.16 + vec2(0.37, 0.11), uTime * 0.36);
  float cs = smoothstep(0.3, 0.46, c1 + c2 * 0.55);
  vec3 col = sand + uLight * cs * uWater.z;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`

function buildFloor() {
  const g = new THREE.PlaneGeometry(60, 50, 120, 100)
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0, -3)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) p.setY(i, floorAt(p.getX(i), p.getZ(i)))
  g.computeVertexNormals()
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(-0.3, 1, 0.45).normalize() },
        uSandA: { value: new THREE.Color('#f6e1ae') },
        uSandB: { value: new THREE.Color('#eacd96') },
        // what the water does to the sand: a turquoise cast, deeper out of the sun
        uShade: { value: new THREE.Color('#3fbfe4') },
        // how much of it: everywhere, extra in drifting patches; and the caustics' strength
        uWater: { value: new THREE.Vector3(0.42, 0.33, 0.16) },
        uLight: { value: new THREE.Color('#eeffff') },
      },
    ]),
    vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    fog: true,
  })
  const m = new THREE.Mesh(g, mat)
  m.name = 'floor'
  m.renderOrder = -2
  return m
}

/* ---------------- god rays ---------------- */

const RAYS_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vW;
void main() {
  // shafts fanning out from the sun beyond the top left of the reef, breathing slowly
  vec2 d = vW.xz - vec2(-15.0, -16.0);
  float a = atan(d.y, d.x);
  float r = length(d);
  float s = 0.0;
  s += smoothstep(0.55, 1.0, sin(a * 23.0 + uTime * 0.12)) * 0.55;
  s += smoothstep(0.6, 1.0, sin(a * 37.0 - uTime * 0.09 + 1.7)) * 0.4;
  s += smoothstep(0.7, 1.0, sin(a * 11.0 + uTime * 0.05 + 4.0)) * 0.6;
  s *= 0.7 + 0.3 * sin(uTime * 0.4 + a * 5.0);
  float fade = smoothstep(4.0, 12.0, r) * smoothstep(42.0, 18.0, r);
  gl_FragColor = vec4(uColor * s * fade, 1.0);
}`

function buildRays() {
  const g = new THREE.PlaneGeometry(64, 52)
  g.rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#bff6ff').multiplyScalar(0.07) } },
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: RAYS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const m = new THREE.Mesh(g, mat)
  m.name = 'rays'
  // under the cast, over the reef
  m.position.set(0, -0.7, -3)
  m.renderOrder = 4
  m.frustumCulled = false
  return m
}

/* ---------------- a seeded hand ---------------- */

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rand = ReturnType<typeof rng>
const pick = <X,>(r: Rand, xs: readonly X[]) => xs[Math.floor(r() * xs.length)]

/* ---------------- the pieces ---------------- */

/** the reef is outlined in a softer navy than the cast's ink, so the creatures stand out in front of it */
const DECOR_INK = '#33507e'

/** part tags: how each piece sways */
const STILL = 0
const SOFT = 1
const KELP = 2

const CORAL = ['#ff7e9a', '#ff9f43', '#b48cff', '#ffd23f', '#6fd1ff', '#ff6fb5', '#7ee08a', '#ff8a5c']
const ROCK = ['#a3a9cf', '#98a2c6', '#aab0cc', '#9db0c4']

/** a lumpy toon rock: a knobbly ball, flat underneath, faceted in tones */
function rock(k: RKit, x: number, z: number, r: number, R: Rand, color = pick(R, ROCK)) {
  const seed = R() * 100
  const g = warp(new THREE.IcosahedronGeometry(1, 1), (v) => {
    const n = 1 + 0.18 * Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 0.7) + 0.12 * Math.sin(v.z * 4.3 + seed * 1.3)
    v.multiplyScalar(n)
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.2
  })
  const base = C(color)
  const moss = C('#9fd68a')
  const lit = smooth(g)
  const sh = tint(lit, (_x, y, _z) => {
    const h = Math.sin(_x * 12.9898 + y * 78.233 + _z * 37.719 + seed) * 43758.5453
    const f = h - Math.floor(h)
    return y > 0.7 && f > 0.72 ? moss.clone() : base.clone().multiplyScalar(0.93 + f * 0.12)
  })
  k.part(STILL).add(sh, '#ffffff', T([x, floorAt(x, z) + r * 0.25, z], [R() * 0.4, R() * TAU, R() * 0.3], [r, r * (0.55 + R() * 0.25), r * (0.8 + R() * 0.3)]))
}

/** a staghorn coral: branches forking up and out, round-tipped */
function staghorn(k: RKit, x: number, z: number, h: number, R: Rand) {
  const color = pick(R, CORAL)
  const y = floorAt(x, z)
  const tipC = C(color).lerp(C('#ffffff'), 0.35)
  const grow = (a: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const b = a.clone().addScaledVector(dir, len)
    const mid = a.clone().lerp(b, 0.5).add(V((R() - 0.5) * len * 0.25, 0, (R() - 0.5) * len * 0.25))
    const g = tubeR(new THREE.CatmullRomCurve3([a, mid, b]), (t) => r * (1 - t * 0.35), 3, 5, depth === 0 ? 'end' : 'none')
    k.add(tint(g, (_x, yy) => (yy > b.y - r * 1.2 && depth === 0 ? tipC : C(color))), '#ffffff')
    if (depth > 0)
      for (let i = 0; i < 3; i++) {
        const nd = dir.clone().add(V(Math.cos(i * 2.1 + R()) * 0.7, 0.4, Math.sin(i * 2.1 + R()) * 0.7)).normalize()
        grow(b, nd, len * (0.6 + R() * 0.3), r * 0.8, depth - 1)
      }
  }
  k.part(SOFT)
  const n = 4 + Math.floor(R() * 2)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R()
    grow(V(x, y - 0.05, z), V(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6).normalize(), h * 0.45, h * 0.1, 1)
  }
}

/** a sea fan: a flat lacy fan facing the camera, swaying */
function seaFan(k: RKit, x: number, z: number, h: number, R: Rand) {
  const color = pick(R, ['#ff4f7a', '#ffb02e', '#c46bff', '#ff7a45'])
  const y = floorAt(x, z)
  k.part(SOFT)
  const branch = (a: THREE.Vector3, ang: number, len: number, r: number, depth: number) => {
    const b = a.clone().add(V(Math.sin(ang) * len, Math.cos(ang) * len, 0))
    k.add(tubeR(new THREE.LineCurve3(a, b), (t) => r * (1 - t * 0.3), 1, 4, depth === 0 ? 'end' : 'none'), color, undefined, depth > 1 ? 0.022 : 0)
    if (depth > 0) for (const s of [-1, 1]) branch(b, ang + s * (0.3 + R() * 0.2), len * 0.8, r * 0.8, depth - 1)
  }
  k.push(T([x, y, z], [-0.35, (R() - 0.5) * 0.6, 0]))
  branch(V(0, -0.05, 0), 0, h * 0.36, h * 0.04, 2)
  k.pop()
}

/** tube sponges: a cluster of open cups */
function tubes(k: RKit, x: number, z: number, h: number, R: Rand) {
  const color = pick(R, ['#ffb52e', '#b48cff', '#ff6f6f', '#4fd1c5'])
  const y = floorAt(x, z)
  const n = 3 + Math.floor(R() * 3)
  k.part(STILL)
  for (let i = 0; i < n; i++) {
    const a = R() * TAU
    const d = i === 0 ? 0 : 0.12 + R() * 0.12
    const hh = h * (0.5 + R() * 0.5)
    const r = 0.07 + R() * 0.05
    const px = x + Math.cos(a) * d
    const pz = z + Math.sin(a) * d
    const lean = V((px - x) * 0.6, 1, (pz - z) * 0.6).normalize()
    const m = new THREE.Matrix4().compose(V(px, y - 0.05, pz), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), lean), V(1, 1, 1))
    k.push(m)
    k.add(new THREE.CylinderGeometry(r * 1.15, r * 0.9, hh, 8, 1), color, T([0, hh / 2, 0]))
    k.add(new THREE.CircleGeometry(r * 0.85, 8), C(color).multiplyScalar(0.45), T([0, hh + 0.002, 0], [-Math.PI / 2, 0, 0]), 0)
    k.pop()
  }
}

/** an anemone: a squat column crowned with swaying, pale-tipped tentacles */
function anemone(k: RKit, x: number, z: number, r: number, R: Rand) {
  const [base, tip] = pick(R, [['#ff6fa0', '#fff0f6'], ['#ff9a3c', '#fff1d6'], ['#b48cff', '#f5eaff'], ['#4fd1c5', '#e6fffb']] as const)
  const y = floorAt(x, z)
  k.part(STILL)
  k.add(new THREE.CylinderGeometry(r * 0.55, r * 0.7, r * 0.5, 10), C(base).multiplyScalar(0.75), T([x, y + r * 0.2, z]))
  k.part(SOFT)
  const n = 12
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R() * 0.3
    const rr = r * (0.2 + 0.32 * (i % 2))
    const a0 = V(x + Math.cos(a) * rr, y + r * 0.45, z + Math.sin(a) * rr)
    const out = V(Math.cos(a), 1.3, Math.sin(a)).normalize()
    const a1 = a0.clone().addScaledVector(out, r * 0.55)
    const a2 = a1.clone().add(V(Math.cos(a) * r * 0.25, r * 0.25, Math.sin(a) * r * 0.25))
    const g = tubeR(new THREE.CatmullRomCurve3([a0, a1, a2]), (t) => r * 0.1 * (1 - t * 0.5), 3, 4, 'end')
    k.add(tint(g, (_x, yy) => C(yy > a2.y - r * 0.12 ? tip : base)), '#ffffff', undefined, 0.016)
  }
}

/** a tuft of sea grass */
function grass(k: RKit, x: number, z: number, h: number, R: Rand) {
  const color = pick(R, ['#5fcf6a', '#7edb5f', '#46b98a'])
  const y = floorAt(x, z)
  k.part(SOFT)
  const n = 4 + Math.floor(R() * 3)
  for (let i = 0; i < n; i++) {
    const a = R() * TAU
    const hh = h * (0.6 + R() * 0.5)
    const bend = (R() - 0.5) * 0.5
    const blade: P2[] = [[-0.035, 0], [0.035, 0], [0.03 + bend * 0.3, hh * 0.5], [bend, hh], [-0.02 + bend * 0.3, hh * 0.55]]
    k.add(fin(blade, 0.02, 0.25), C(color).multiplyScalar(0.85 + R() * 0.3), T([x + Math.cos(a) * 0.08, y - 0.03, z + Math.sin(a) * 0.08], [0, a, 0]), 0.016)
  }
}

/** kelp: a tall swaying stalk of ribbon leaves with little floats */
function kelp(k: RKit, x: number, z: number, h: number, R: Rand) {
  const y = floorAt(x, z)
  const color = pick(R, ['#3fae5a', '#5bbf4a', '#2f9a6a'])
  k.part(KELP)
  const pts: P3[] = Array.from({ length: 6 }, (_, i) => [x + Math.sin(i * 1.3 + R()) * 0.12, y + (h * i) / 5, z + Math.cos(i * 1.1) * 0.08])
  const stalk = path3(pts)
  k.add(tubeR(stalk, () => 0.035, 10, 5, 'end'), C(color).multiplyScalar(0.8), undefined, 0.022)
  for (let i = 1; i < 8; i++) {
    const t = i / 9.5
    const p = stalk.getPointAt(t)
    const s = i % 2 ? 1 : -1
    const len = 0.45 + R() * 0.25
    const leaf: P2[] = curve2([[0, 0], [len * 0.4, 0.09], [len, 0.02], [len * 0.45, -0.05]], 10)
    k.add(fin(leaf, 0.02, 0.3), C(color).multiplyScalar(0.9 + R() * 0.25), T([p.x, p.y, p.z], [0, s > 0 ? R() * 0.6 : Math.PI + R() * 0.6, 0.5 + R() * 0.4]), 0.022)
    if (i % 3 === 0) ell(k, { c: [p.x, p.y + 0.04, p.z], r: [0.05, 0.06, 0.05] }, '#c8d94a', [6, 4], 0.02)
  }
}

/** a starfish lying on the sand */
function starfish(k: RKit, x: number, z: number, r: number, R: Rand) {
  const color = pick(R, ['#ff6a3d', '#ff4f7a', '#ffb02e', '#8a6bff'])
  const y = floorAt(x, z)
  const pts = star(0, 0, r, r * 0.42, 5).map(([px, py]) => [px, py] as P2)
  const m = T([x, y + 0.03, z], [-Math.PI / 2, 0, R() * TAU])
  k.part(STILL)
  k.add(fin(curve2([...pts, pts[0]], 30).slice(0, -1), 0.06, 1), color, m)
  k.push(m)
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * TAU) / 5
    for (const t of [0.35, 0.62]) paint(k, flatSurf(0.031), oval(Math.cos(a) * r * t, Math.sin(a) * r * t, r * 0.07, r * 0.07, 0, 8), C(color).lerp(C('#ffffff'), 0.5), 0.002, true)
  }
  k.pop()
}

/** a scallop shell */
function scallop(k: RKit, x: number, z: number, r: number, R: Rand) {
  const color = pick(R, ['#ffd0c2', '#fff0d0', '#ffc8e0'])
  const y = floorAt(x, z)
  const fan: P2[] = [[0, 0], ...Array.from({ length: 9 }, (_, i): P2 => {
    const a = Math.PI * 0.15 + (i / 8) * Math.PI * 0.7
    return [Math.cos(a) * r, Math.sin(a) * r]
  })]
  const m = T([x, y + 0.04, z], [-Math.PI / 2 + 0.25, 0, R() * TAU])
  k.part(STILL)
  k.add(fin(fan, 0.05, 1), color, m)
  k.push(m)
  for (let i = 1; i < 6; i++) {
    const a = Math.PI * 0.18 + (i / 6) * Math.PI * 0.64
    stroke(k, flatSurf(0.027), [[0, r * 0.1], [Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9]], r * 0.07, 0.002, C(color).multiplyScalar(0.78), 0.2, false)
  }
  k.pop()
}

/** a giant clam, open, with a pearl inside; returns where its bubbles rise from */
function clam(k: RKit, x: number, z: number, r: number) {
  const y = floorAt(x, z)
  const lip = (g: THREE.BufferGeometry) =>
    warp(g, (v) => {
      v.y += 0.12 * Math.sin(Math.atan2(v.z, v.x) * 7) * Math.max(0, 1 - Math.abs(v.y))
    })
  k.part(STILL)
  k.add(lip(new THREE.SphereGeometry(1, 22, 8, 0, TAU, Math.PI / 2, Math.PI / 2)), '#7fc7ff', T([x, y + r * 0.45, z], [0, 0, 0], [r, r * 0.5, r * 0.8]))
  k.add(lip(new THREE.SphereGeometry(1, 22, 8, 0, TAU, 0, Math.PI / 2)), '#9fd6ff', T([x, y + r * 0.5, z - r * 0.15], [-0.7, 0, 0], [r, r * 0.5, r * 0.8]))
  k.add(new THREE.CircleGeometry(r * 0.85, 20), '#ff9fc4', T([x, y + r * 0.46, z], [-Math.PI / 2, 0, 0], [1, 0.8, 1]), 0)
  ell(k, { c: [x, y + r * 0.58, z + r * 0.1], r: [r * 0.22, r * 0.22, r * 0.22] }, '#fffaf0', [14, 10], undefined, [0, 0, 0], { shine: 1 })
  return V(x, y + r * 0.7, z + r * 0.1)
}

/** a sunken anchor half sunk in the sand, its chain trailing off */
function anchor(k: RKit, x: number, z: number, s: number, rot: number) {
  const y = floorAt(x, z)
  const IRON = '#5f8f8a'
  const RUST = '#b8743a'
  const m = T([x, y + 0.12 * s, z], [-Math.PI / 2 + 0.12, 0, rot], s)
  k.part(STILL)
  k.push(m)
  limb(k, [0, -0.55, 0], [0, 0.5, 0], 0.07, IRON)
  k.add(new THREE.TorusGeometry(0.13, 0.04, 8, 16), IRON, T([0, 0.66, 0]))
  limb(k, [-0.3, 0.38, 0], [0.3, 0.38, 0], 0.05, IRON)
  for (const sx of [-1, 1]) ell(k, { c: [sx * 0.32, 0.38, 0], r: [0.06, 0.06, 0.06] }, IRON, [8, 6])
  const arm = new THREE.CatmullRomCurve3([V(-0.48, -0.25, 0), V(-0.3, -0.58, 0), V(0, -0.66, 0), V(0.3, -0.58, 0), V(0.48, -0.25, 0)])
  k.add(tubeR(arm, () => 0.065, 16, 8), IRON)
  for (const sx of [-1, 1]) horn(k, [sx * 0.46, -0.3, 0], [sx * 0.6, -0.08, 0], 0.11, IRON, undefined, 4)
  for (const [px, py, r] of [[0.02, 0.1, 0.04], [-0.03, -0.3, 0.035], [0.2, -0.6, 0.03], [-0.25, 0.38, 0.03]] as const) ell(k, { c: [px, py, 0.06], r: [r, r, r * 0.4] }, RUST, [8, 6], 0)
  k.pop()
  // the chain: links trailing from the ring across the sand
  const ring = V(0, 0.66, 0).applyMatrix4(m)
  const dir = rot + 2.2
  for (let i = 0; i < 9; i++) {
    const d = 0.16 * s * (i + 1)
    const cx = ring.x + Math.cos(dir) * d + Math.sin(i * 0.8) * 0.06
    const cz = ring.z + Math.sin(dir) * d
    k.add(new THREE.TorusGeometry(0.075 * s, 0.024 * s, 6, 12), IRON, T([cx, floorAt(cx, cz) + 0.03, cz], [i % 2 ? 0 : Math.PI / 2, -dir, 0], [1.4, 1, 1]), 0.02)
  }
}

/** the timbers of an old wreck sticking out of the sand, with a barrel and a scatter of coins */
function wreck(k: RKit, x: number, z: number, R: Rand) {
  const WOOD = '#c48b52'
  const DARK = '#a8703f'
  const GRAIN = '#7a4a26'
  k.part(STILL)
  for (let i = 0; i < 4; i++) {
    const px = x + (i - 1.5) * 0.42
    const pz = z + Math.sin(i * 1.7) * 0.2
    const h = 0.7 + R() * 0.7
    // a weathered plank, light enough to read as wood on the sand, with grain lines and a broken top
    k.push(T([px, floorAt(px, pz) + h * 0.32, pz], [0.25 + R() * 0.2, 0.2, (R() - 0.5) * 0.5]))
    k.add(new THREE.BoxGeometry(0.22, h, 0.1), i % 2 ? WOOD : DARK)
    for (const gx of [-0.05, 0.045]) k.add(new THREE.BoxGeometry(0.016, h * (0.55 + R() * 0.3), 0.012), GRAIN, T([gx, -h * 0.08, 0.052]), 0)
    k.add(new THREE.BoxGeometry(0.1, 0.06, 0.1), i % 2 ? DARK : WOOD, T([0.06, h / 2 + 0.02, 0], [0, 0, 0.6]))
    k.pop()
  }
  for (const s of [-1, 1]) {
    const rib = new THREE.CatmullRomCurve3([V(x + s * 0.9, floorAt(x, z) - 0.1, z - 0.6), V(x + s * 1.15, floorAt(x, z) + 0.5, z - 0.3), V(x + s * 0.95, floorAt(x, z) + 0.9, z + 0.1)])
    k.add(tubeR(rib, (t) => 0.07 * (1 - t * 0.4), 10, 6), DARK)
  }
  // a barrel on its side
  const bx = x + 1.6
  const bz = z + 0.5
  const by = floorAt(bx, bz) + 0.22
  k.add(new THREE.CylinderGeometry(0.24, 0.24, 0.55, 14), WOOD, T([bx, by, bz], [0, 0.5, Math.PI / 2]))
  for (const o of [-0.17, 0.17]) k.add(new THREE.TorusGeometry(0.245, 0.02, 6, 16), '#556070', T([bx + o * Math.cos(0.5), by, bz - o * Math.sin(0.5)], [0, 0.5 + Math.PI / 2, 0]), 0)
  for (let i = 0; i < 6; i++) {
    const cx = x + 0.6 + R() * 1.4
    const cz = z + 0.4 + R() * 0.8
    k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), '#ffcf3a', T([cx, floorAt(cx, cz) + 0.03, cz], [R() * 0.4, 0, R() * 0.4]), 0.018, { shine: 1 })
  }
}

/* ---------------- layout ---------------- */

type Piece = 'rock' | 'stag' | 'fan' | 'tubes' | 'anemone' | 'grass' | 'kelp' | 'star' | 'shell'

interface Zone {
  name: string
  /** x range and z range */
  x: [number, number]
  z: [number, number]
  /** how many pieces, and what they may be */
  n: number
  kinds: readonly Piece[]
  /** pieces are this much bigger here */
  scale: number
  /** keep clear of a box (the cannon's spot) */
  clear?: [number, number, number, number]
}

const BORDER: readonly Piece[] = ['rock', 'stag', 'stag', 'stag', 'fan', 'fan', 'tubes', 'tubes', 'anemone', 'anemone', 'grass', 'grass']

/** where the decor goes round a field of half size hw × hh (counts are for the wide field, scaled by each zone's size) */
function zonesFor(hw: number, hh: number): Zone[] {
  const across = (2 * hw + 10) / 26
  const down = (2 * hh + 2.6) / 11.6
  return [
    { name: 'far', x: [-hw - 5, hw + 5], z: [-hh - 8, -hh - 1.1], n: Math.round(72 * across), kinds: [...BORDER, 'kelp', 'kelp'], scale: 1.2 },
    { name: 'far2', x: [-hw - 8, hw + 8], z: [-hh - 19.5, -hh - 8], n: Math.round(34 * across), kinds: ['rock', 'stag', 'stag', 'fan', 'kelp', 'tubes', 'anemone'], scale: 1.6 },
    { name: 'left', x: [-hw - 5.5, -hw - 0.3], z: [-hh - 1.1, hh + 1.5], n: Math.round(26 * down), kinds: [...BORDER, 'kelp'], scale: 1.05 },
    { name: 'right', x: [hw + 0.3, hw + 5.5], z: [-hh - 1.1, hh + 1.5], n: Math.round(26 * down), kinds: [...BORDER, 'kelp'], scale: 1.05 },
    { name: 'near', x: [-hw - 5, hw + 5], z: [hh + 0.7, hh + 7.5], n: Math.round(40 * across), kinds: ['rock', 'grass', 'grass', 'anemone', 'shell', 'star', 'tubes', 'stag'], scale: 1.0, clear: [-2.6, 2.6, hh + 0.1, hh + 3.7] },
    { name: 'near2', x: [-hw - 7, hw + 7], z: [hh + 7.5, hh + 15.5], n: Math.round(26 * across), kinds: ['rock', 'grass', 'stag', 'anemone', 'tubes'], scale: 1.3 },
    { name: 'field', x: [-hw + 0.6, hw - 0.6], z: [-hh - 0.3, hh - 0.1], n: Math.round((24 * hw * hh) / 36), kinds: ['star', 'shell', 'grass', 'grass', 'star', 'shell'], scale: 0.7, clear: [-2.4, 2.4, hh - 1.3, hh + 1.5] },
  ]
}

function place(k: RKit, kind: Piece, x: number, z: number, s: number, R: Rand) {
  switch (kind) {
    case 'rock':
      return rock(k, x, z, (0.35 + R() * 0.4) * s, R)
    case 'stag':
      return staghorn(k, x, z, (0.8 + R() * 0.5) * s, R)
    case 'fan':
      return seaFan(k, x, z, (1.0 + R() * 0.5) * s, R)
    case 'tubes':
      return tubes(k, x, z, (0.5 + R() * 0.4) * s, R)
    case 'anemone':
      return anemone(k, x, z, (0.3 + R() * 0.15) * s, R)
    case 'grass':
      return grass(k, x, z, (0.35 + R() * 0.3) * s, R)
    case 'kelp':
      return kelp(k, x, z, (2.2 + R() * 1.4) * s, R)
    case 'star':
      return starfish(k, x, z, (0.16 + R() * 0.08) * s, R)
    case 'shell':
      return scallop(k, x, z, (0.13 + R() * 0.06) * s, R)
  }
}

/* ---------------- the set ---------------- */

/** an attribute's onUpload: lets go of its array once it is on the GPU */
function dropArray(this: THREE.BufferAttribute) {
  ;(this as unknown as { array: null }).array = null
}

const SWAY_KELP = 0.07
function decorRig(p: THREE.Vector3, _n: THREE.Vector3, tag: number, m: Motion) {
  if (tag === STILL) return
  const h = Math.max(0, p.y - floorAt(p.x, p.z))
  // a current rolling across the reef: the phase follows position
  const ph = p.x * 0.35 + p.z * 0.22
  if (tag === KELP) {
    m.w1.set(SWAY_KELP * h * h, 0, 0.03 * h * h, ph)
    m.w2.set(0, 0, 0.02 * h, ph * 2.3)
  } else if (tag === SOFT) {
    m.w1.set(0.08 * h, 0, 0.05 * h, ph)
    m.w2.set(0.025 * h, 0, 0.025 * h, ph * 3.1 + p.y * 9)
  }
}

export interface ReefSet {
  root: THREE.Group
  /** bubbles rising from the reef (the scene may add its own to the same pool) */
  bubbles: Bubbles
  /** every frame, with the scene clock (s) and the frame time */
  tick(t: number, dt: number): void
  /** the canvas changed: (height in device px) / (2 · tan(fov / 2)), for the point sprites */
  resize(scale: number): void
  dispose(): void
}

/** builds the reef round a field (the wide one unless told); `lite` (phones) lays out about half as much decor and plankton */
export function buildReef(opts: { lite?: boolean; field?: FieldSize } = {}): ReefSet {
  const lite = !!opts.lite
  const field = opts.field ?? FIELD
  const hw = (edge.hw = field.w / 2)
  const hh = (edge.hh = field.h / 2)
  const root = new THREE.Group()
  root.name = 'reef'
  const floor = buildFloor()
  const rays = buildRays()
  root.add(floor, rays)
  const R = rng(7)
  const decorMat = swayMaterial([1.1, 2.7, 1.2])
  const meshes: THREE.InstancedMesh[] = []
  const bases: THREE.BufferGeometry[] = []
  // one set of instance attributes for every chunk: one instance, standing still, its clock the scene's
  const inst = swayInstances(1)
  const vents: THREE.Vector3[] = []
  const add = (k: RKit, name: string) => {
    const g = k.bake(decorRig)
    bases.push(g)
    const { mesh } = swayMesh(g, decorMat, 1, inst)
    mesh.name = name
    mesh.setMatrixAt(0, new THREE.Matrix4())
    // the chunks stand still, so they can be culled by their bounds
    mesh.computeBoundingSphere()
    mesh.frustumCulled = true
    // and nothing reads them again: once on the GPU, their copies in memory go (several MB a chunk)
    for (const a of [...Object.values(g.attributes), g.index]) (a as THREE.BufferAttribute | null)?.onUpload(dropArray)
    root.add(mesh)
    meshes.push(mesh)
  }
  for (const zone of zonesFor(hw, hh)) {
    const k = new RKit(DECOR_INK, 0.03)
    const n = Math.round(zone.n * (lite ? 0.55 : 1))
    const spots: [number, number][] = []
    let tries = 0
    while (spots.length < n && tries++ < n * 30) {
      const x = zone.x[0] + R() * (zone.x[1] - zone.x[0])
      const z = zone.z[0] + R() * (zone.z[1] - zone.z[0])
      if (zone.clear && x > zone.clear[0] && x < zone.clear[1] && z > zone.clear[2] && z < zone.clear[3]) continue
      // keep pieces apart, a little more in the field
      const gap = zone.name === 'field' ? 1.6 : 0.85 * zone.scale
      if (spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < gap * gap)) continue
      spots.push([x, z])
      const kind = pick(R, zone.kinds)
      // kelp only beyond the field's edges, where it can't stand in front of the cast
      if (kind === 'kelp' && Math.abs(x) < hw + 0.8 && z > -hh - 1.9) continue
      place(k, kind, x, z, zone.scale, R)
    }
    if (zone.name === 'field') {
      anchor(k, -0.7 * hw, 0.58 * hh, 0.95, 0.5)
      wreck(k, 0.575 * hw, -0.82 * hh, R)
      vents.push(clam(k, -0.325 * hw, -0.49 * hh, 0.38))
    }
    const vent = (x: number, z: number) => V(x, floorAt(x, z) + 0.3, z)
    if (zone.name === 'far') vents.push(vent(-0.4 * hw, -hh - 2), vent(0.69 * hw, -hh - 2.7))
    if (zone.name === 'left') vents.push(vent(-hw - 1.4, 0.33 * hh))
    add(k, zone.name)
  }
  const bubbles = new Bubbles(lite ? 160 : 320)
  root.add(bubbles.points)
  const motes = buildMotes(lite ? 110 : 260, V(-hw - 4, FLOOR_Y + 0.4, -hh - 7.5), V(hw + 4, 1.6, hh + 4.5))
  root.add(motes)
  const ventClock = vents.map(() => Math.random() * 2)
  const moteMat = motes.material as THREE.ShaderMaterial
  const floorMat = floor.material as THREE.ShaderMaterial
  const raysMat = rays.material as THREE.ShaderMaterial
  return {
    root,
    bubbles,
    tick(t, dt) {
      inst.anim.setX(0, t)
      inst.anim.needsUpdate = true
      floorMat.uniforms.uTime.value = t
      raysMat.uniforms.uTime.value = t
      moteMat.uniforms.uTime.value = t
      // a stream of bubbles from each vent, in little bursts
      for (let i = 0; i < vents.length; i++) {
        ventClock[i] -= dt
        if (ventClock[i] > 0) continue
        ventClock[i] = 0.18 + Math.random() * 0.25 + (Math.random() < 0.1 ? 1.5 : 0)
        const v = vents[i]
        bubbles.emit(v.x + (Math.random() - 0.5) * 0.15, v.y, v.z + (Math.random() - 0.5) * 0.15, 0, 0.4, 0, 0.07 + Math.random() * 0.09, 2.6 + Math.random(), 0.08)
      }
      bubbles.update(dt)
    },
    resize(scale) {
      bubbles.mat.uniforms.scale.value = scale
      moteMat.uniforms.scale.value = scale
    },
    dispose() {
      for (const m of meshes) {
        m.geometry.dispose()
        m.dispose()
      }
      for (const g of bases) g.dispose()
      decorMat.dispose()
      floor.geometry.dispose()
      floorMat.dispose()
      rays.geometry.dispose()
      raysMat.dispose()
      bubbles.dispose()
      motes.geometry.dispose()
      moteMat.dispose()
    },
  }
}
