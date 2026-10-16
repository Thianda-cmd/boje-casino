import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Bits, PacedQuality, Sparks, WHITE_HOT, glowTexture, ring, ringTexture, rnd, roundRect } from '../../lib/three/fx'
import { T, VKit, toonRamp, vkMaterial } from '../../lib/three/toon'
import { COLS, ROWS, colOf, rowOf, type Grid, type PaySym, type Sym, type TileUp } from './rules'
import { LEVEL_COLOR, SYMBOL_COLOR, multColor } from './meta'
import { BADGE_H, BADGE_W, INK, allMaterials, badgeAtlas, buildHost, buildMirrorBall, buildOctoHat, buildSymbol, castMaterial, discoMaterial, garlandGeometry, popCardTexture, recordGeometry, shredGeometry, releaseModels, symbolMaterials, warmUp, type HostRig } from './models'

/*
  The Pop Party stage: a 7 × 7 light-up disco floor inside a balloon arch, with DJ Bop at his decks on top.
  A new floor of balloons rises in from below as the old one floats away; winners puff up and pop into latex
  shreds, the tiles under them light and double, and the rest float up while new balloons rise in behind them.
  When Disco Night starts the sun sets, the mirror ball drops in and the backyard pulses to a 120 BPM beat.
  Like the other slots, everything runs on the scene clock, so turbo, hurry and long cascades speed the whole
  show up; only the beat and the sky keep real time.
*/

export type HostAction = 'slap' | 'scratch' | 'shades' | 'cheer' | 'jump' | 'yawn' | 'cross' | 'gasp' | 'fist'
export interface PumpChangeView {
  pos: number
  fromId: number
  to: { id: number; sym: Sym }
}

const IN_W = 3.56
const IN_H = 3.56
/**
 * The view fits FIT_W across and from VIEW_TOP down to VIEW_BOTTOM: the arch (a slim ring of balloons, 8 across and
 * up), DJ Bop and his booth sitting on its top (his head about 1.1 over it) and HUD_PX under it; on a short stage the
 * counters sit on the arch's bottom row of balloons, the caption beside them. So the floor gets the screen: a cell is
 * about 85 px on a 1440 × 900 desktop. On narrow screens the width rules (7.52 makes a cell about 46 px on a 375 px
 * phone), the arch's sides tuck in to fit and any height to spare goes under the arch (see resize).
 */
const FIT_W = 7.52
const VIEW_TOP = 5.2
const VIEW_BOTTOM = -3.98
const FIT_H = VIEW_TOP - VIEW_BOTTOM
const CAM_Y = (VIEW_TOP + VIEW_BOTTOM) / 2
/** the room the counters need under the arch on a short stage, in CSS px: they sit on the arch's bottom row and stick
 *  out a little below it, the caption beside them (see PopParty's HUD) */
const HUD_PX = 13
/** how far the arch's backing ring reaches past the window (its two rows of balloons sit on it: see archLayout) */
const RIM = 0.42
const FOV = 30
const CLIP = [new THREE.Plane(new THREE.Vector3(0, -1, 0), IN_H - 0.01), new THREE.Plane(new THREE.Vector3(0, 1, 0), IN_H - 0.01)]

const cellX = (c: number) => c - (COLS - 1) / 2
const cellY = (r: number) => (ROWS - 1) / 2 - r
/** depths, back to front */
const Z_BED = -0.45
const Z_TILE = -0.42
const Z_DIM = 0.42
const Z_WIN = 0.5
const Z_BADGE = 0.55
/**
 * A badge is a square atlas slot BADGE_Q across, its pill BADGE_H of that tall (a third of a cell) and BADGE_W[slot]
 * wide (0.41 of a cell for ×2, up to 0.59 for ×128). The pill sits in its cell's bottom-right corner, clear of the
 * balloon's face.
 */
const BADGE_Q = 0.66
const BADGE_CORNER = 0.49
/** the cast is modelled to fill 0.9 of a cell; drawn this much bigger it fills the cell the way a slot symbol should */
const CAST = 1.12
/** DJ Bop is drawn this much bigger than modelled (his booth a little less), standing this much higher behind it */
const HOST_SCALE = 0.94
const BOOTH_SCALE = 0.75
const HOST_LIFT = 0.04
/** the arch's balloon colours by day, and the chrome they turn in Disco Night */
const ARCH = ['#ff4fb8', '#ffcc29', '#3fc4ff', '#9a6bff', '#29d8c4']
const ARCH_DAY = ARCH.map((c) => new THREE.Color(c))
const ARCH_NIGHT = ['#dfe6ff', '#ffc93d', '#ff4fd8'].map((c) => new THREE.Color(c))
/** the top of DJ Bop's booth, and where the mirror ball hangs in Disco Night (it waits MIRROR_UP higher by day) */
const BOOTH = new THREE.Vector3(0, IN_H + 0.5 * BOOTH_SCALE + 0.03, 0.35)
const MIRROR = new THREE.Vector3(-IN_W + 0.3, IN_H + 1.05, -0.2)
const MIRROR_UP = 7
/** where DJ Bop blows up the Big Pop balloon: over the front of his booth, off to the side his snout points to */
const BALLOON = new THREE.Vector3(0.68, BOOTH.y + 0.34, 1)
const RAMP = [92, 165, 225, 255]
/** each of DJ Bop's arms, shoulder to mitt, in the torso's frame (as built in models.ts) */
const ARM_DIR = [new THREE.Vector3(-0.345, -0.34, 0.295).normalize(), new THREE.Vector3(0.345, -0.34, 0.295).normalize()]
/** DJ Bop's hand props are drawn this much bigger than modelled (on top of HOST_SCALE), to read at stage size */
const PROP = 1.2
const MITT = [new THREE.Vector3(-0.475, 0.18, 0.315), new THREE.Vector3(0.475, 0.18, 0.315)]

const ease = (t: number) => 1 - (1 - t) ** 3
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
/** 0 → 1 → 0 across u = 0..1: in over the first `a`, out over the last `r` */
const env = (u: number, a = 0.2, r = 0.25) => (u <= 0 || u >= 1 ? 0 : smooth(Math.min(1, u / a, (1 - u) / r)))
const TAU = Math.PI * 2
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

/* ------------------------------------------------------------------ */
/*  Pieces                                                              */
/* ------------------------------------------------------------------ */

/** how a balloon rises onto its row: ease out past it by `over`, then `bobs` damped swings back onto it */
interface Move {
  rise: number
  settle: number
  over: number
  bobs: number
  squash: number
}
const DROP: Move = { rise: 0.45, settle: 0.35, over: 0.12, bobs: 1.5, squash: 1 }
const SHIFT: Move = { rise: 0.2, settle: 0.1, over: 0.08, bobs: 0.5, squash: 0.45 }
const REFILL: Move = { rise: 0.27, settle: 0.11, over: 0.08, bobs: 0.5, squash: 0.75 }

/** pieces moving together; the move is over when n reaches 0 */
interface Batch {
  n: number
}

interface Rest {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}
const restOf = (o: THREE.Object3D) => o.userData.rest as Rest

interface Piece {
  key: Sym
  sym: Sym
  id: number
  root: THREE.Group
  inner: THREE.Group
  model: THREE.Group
  eyes: THREE.Object3D | null
  joy: THREE.Object3D | null
  parts: Record<string, THREE.Object3D>
  glow: THREE.Sprite
  col: number
  row: number
  y: number
  ty: number
  vy: number
  wait: number
  phase: number
  blinkAt: number
  blink: number
  win: number
  winTo: number
  squash: number
  /** over-inflate before a burst (0.3 = 1.3×) */
  inflate: number
  state: 'rise' | 'idle' | 'leave' | 'float' | 'popping'
  /** the current move: where it started, how far into it, and its shape */
  y0: number
  t: number
  move: Move
  batch: Batch | null
  onArrive: (() => void) | null
  onBurst: (() => void) | null
  popDur: number
  /** bob speed, radians a second */
  bobW: number
  /** seconds into the win dance */
  winT: number
  /** lifted in front of the dimmer, 0..1 */
  front: number
  frontTo: number
  glowAmt: number
  glowTo: number
  squashAmp: number
  wiggle: number
  flopAt: number
  flop: number
  hopAt: number
  hop: number
  /** disco balls: rise and halo flare */
  lift: number
  liftTo: number
  flare: number
  glintAt: number
}

const PARTS = ['wag', 'neck', 'earR', 'tentL', 'tentR', 'ball', 'bow', 'halo']
const PREVIEW: Sym[] = ['poodle', 'giraffe', 'bunny', 'octo', 'heart', 'star', 'round', 'disco']

/* ------------------------------------------------------------------ */
/*  The floor                                                           */
/* ------------------------------------------------------------------ */

interface Tile {
  level: number
  hot: number
  hotTo: number
  lift: number
  liftTo: number
  block: number
  blockTo: number
}

interface Badge {
  slot: number
  anim: 'stamp' | 'flip' | 'drop' | 'punch' | null
  t: number
  /** the slot a flip turns over to */
  next: number
  dim: number
  /** grown under a highlighted cluster */
  zoom: number
  zoomTo: number
}

const TILE_VERT = /* glsl */ `
attribute vec4 aTile;
attribute vec4 aFx;
attribute vec3 aHotColor;
varying vec2 vP;
varying vec2 vW;
varying vec4 vTile;
varying vec4 vFx;
varying vec3 vHot;
void main() {
  vP = position.xy;
  vec4 w = instanceMatrix * vec4(position, 1.0);
  vW = w.xy;
  vTile = aTile;
  vFx = aFx;
  vHot = aHotColor;
  gl_Position = projectionMatrix * modelViewMatrix * w;
}`

// aTile: level, previous level, time of the change, fade length; aFx: hot, blocked, lifted, flash
const TILE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFree;
uniform float uBeat;
uniform float uDim;
uniform vec3 uPalette[9];
varying vec2 vP;
varying vec2 vW;
varying vec4 vTile;
varying vec4 vFx;
varying vec3 vHot;
// set once in main(): how far in from the rounded edge this point is (0 on the edge, 0.48 in the middle), its
// screen-space width, how much the nearest edge faces the light (top left), and the frames' beat pulse
float gIn;
float gAA;
float gFacing;
float gPulse;
vec3 rainbow(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
// a multiplier tile: a dark panel lit by a neon frame. c: the tube's colour, rim: the bevel's, k: 0 at ×2 up to 1 at ×128
vec3 neon(vec3 c, vec3 rim, float k) {
  const float TUBE = 0.078;
  // the panel stays dark under the balloon, with a faint wash of the colour and a soft glow in from the frame
  vec3 col = uPalette[0] * 1.05 + c * (0.04 + 0.04 * k);
  col += c * (0.26 + 0.16 * k) * exp(-max(gIn - TUBE, 0.0) / (0.04 + 0.035 * k)) * gPulse;
  // the bevelled rim outside the tube, lit from the top left
  col = mix(col, rim * (0.62 + 0.36 * gFacing), 1.0 - smoothstep(TUBE - 0.026 - gAA, TUBE - 0.026 + gAA, gIn));
  // the tube itself, white-hot in the middle
  col += mix(c, vec3(1.0), 0.45) * 1.3 * exp(-pow((gIn - TUBE) / max(0.014, gAA), 2.0)) * gPulse;
  // ×32 and up: a second, finer line inside it
  col += c * 0.8 * exp(-pow((gIn - TUBE - 0.062) / max(0.008, gAA), 2.0)) * step(0.6, k) * gPulse;
  // a dark lip on the very edge keeps neighbours apart
  return col * mix(0.3, 1.0, smoothstep(0.0, 0.014 + gAA, gIn));
}
vec3 face(float l) {
  vec3 dark = uPalette[0];
  float edge = max(abs(vP.x), abs(vP.y)) / 0.48;
  // dark and lit: a bevel, light along the top-left edge and shaded along the bottom-right
  float bev = smoothstep(0.8, 0.97, edge) * clamp((vP.y - vP.x) * 3.0, -1.0, 1.0);
  if (l < 0.5) return dark * (1.0 + bev * 0.5);
  // lit: a warm glow round the rim of a dark panel
  if (l < 1.5) return mix(dark * 1.3, uPalette[1] * 0.45, smoothstep(0.4, 0.92, edge)) * (1.0 + bev * 0.3) + uPalette[1] * smoothstep(0.07, 0.0, abs(edge - 0.86)) * 0.7;
  // ×2 and up: the level's neon frame round a dark panel, so the balloon on it always stands out;
  // ×128 runs a rainbow round a gold bevel
  vec3 c = uPalette[int(l + 0.5)];
  vec3 col = l > 7.5 ? neon(rainbow(uTime * 0.6 + (vW.x - vW.y) * 0.08) * 1.1, c, 1.0) : neon(c, c, (l - 2.0) / 6.0);
  // a shine runs along the frames on the diagonal every 2.5 s
  float s = fract(uTime / 2.5) * 22.0 - 11.0;
  return col + c * 0.45 * smoothstep(0.35, 0.0, abs(vW.x + vW.y - s)) * smoothstep(0.15, 0.05, gIn);
}
void main() {
  vec2 q = abs(vP) - 0.36;
  vec2 o = max(q, 0.0);
  gIn = 0.12 - length(o) - min(max(q.x, q.y), 0.0);
  gAA = fwidth(gIn);
  vec2 n = sign(vP) * (o.x > 0.0 && o.y > 0.0 ? normalize(o) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));
  gFacing = dot(n, vec2(-0.7071, 0.7071));
  gPulse = 1.0 + 0.3 * uBeat * uFree;
  float since = uTime - vTile.z;
  vec3 c = face(vTile.x);
  if (since < vTile.w) c = mix(face(vTile.y), c, smoothstep(0.0, 1.0, since / vTile.w));
  c += vec3(0.9) * vFx.w * clamp(1.0 - since / 0.1, 0.0, 1.0);
  float lit = step(0.5, vTile.x);
  c *= 1.0 + 0.1 * uBeat * uFree * lit;
  // a disco ball parked here: greyed out, with a slow ripple
  float r = length(vP) / 0.48;
  float ripple = smoothstep(0.08, 0.0, abs(r - fract(uTime * 0.5) * 1.3)) * 0.25;
  c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), 0.4 * vFx.y * lit) + ripple * vFx.y * lit;
  // under a winning cluster the frame lights up in the cluster's colour
  if (vFx.x > 0.0) c = mix(c, neon(vHot, vHot, 0.3), 0.65 * vFx.x);
  // tiles under a highlighted cluster shine through the dimmer in front of the floor
  c /= max(0.2, 1.0 - uDim * vFx.z);
  gl_FragColor = vec4(c, 1.0);
}`

const BADGE_VERT = /* glsl */ `
attribute float aSlot;
attribute float aDim;
varying vec2 vUv;
varying float vDim;
void main() {
  vDim = aDim;
  // the atlas is 4 square slots across and 2 down, slot 0 at the top left
  vUv = vec2((mod(aSlot, 4.0) + uv.x) * 0.25, (1.0 - floor(aSlot / 4.0) + uv.y) * 0.5);
  gl_Position = aSlot < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`

const BADGE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uDim;
uniform float uHide;
varying vec2 vUv;
varying float vDim;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.02) discard;
  // just under the bloom threshold, so the numerals stay crisp
  gl_FragColor = vec4(t.rgb * 0.84 * (1.0 - 0.45 * vDim * uDim), t.a * (1.0 - uHide));
}`

/** the pump strip along the bottom edge: a neon tube with a shimmer running along it */
const STRIP_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
void main() {
  float run = pow(0.5 + 0.5 * sin(vUv.x * 26.0 - uTime * 5.0), 6.0);
  float core = 1.0 - abs(vUv.y - 0.5) * 1.2;
  gl_FragColor = vec4(uColor * core * (1.0 + 0.35 * run), 1.0);
}`

const FLAT_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const SCREEN_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'

/* ------------------------------------------------------------------ */
/*  Backdrop: a garden party at golden hour that becomes Disco Night    */
/* ------------------------------------------------------------------ */

const BACK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFree;
uniform float uBeat;
uniform float uAspect;
uniform vec2 uBall;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// an sRGB colour (0..255) as linear light
vec3 C(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
vec3 archCol(float k) {
  float i = mod(k, 5.0);
  return i < 1.0 ? C(255., 79., 184.) : i < 2.0 ? C(255., 204., 41.) : i < 3.0 ? C(63., 196., 255.) : i < 4.0 ? C(154., 107., 255.) : C(41., 216., 196.);
}
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float t = uTime;
  float n = uFree;
  float day = 1.0 - n;
  vec3 ink = C(29., 15., 48.);

  // sky: blue fading to warm at the horizon by day; deep violet with a glow on the horizon by night
  vec3 col = mix(C(255., 217., 168.), C(159., 220., 255.), smoothstep(-0.2, 0.1, p.y));
  col = mix(col, C(79., 185., 255.), smoothstep(0.1, 0.5, p.y));
  vec3 night = mix(C(42., 11., 74.), C(13., 6., 36.), smoothstep(-0.2, 0.45, p.y));
  night += C(106., 42., 138.) * exp(-pow((p.y + 0.2) * 6.0, 2.0)) * 0.8;
  col = mix(col, night, n);

  // stars come out at night
  vec2 g = floor((p + 2.0) * 60.0);
  float s = hash(g);
  vec2 f = fract((p + 2.0) * 60.0) - 0.5;
  float tw = 0.5 + 0.5 * sin(t * (1.5 + s * 3.0) + s * 40.0);
  col += step(0.975, s) * tw * smoothstep(0.22, 0.0, length(f)) * smoothstep(-0.15, 0.2, p.y) * n * vec3(1.0, 0.95, 1.2);

  // the sun, which sets behind the hedge when the party starts
  vec2 sc = vec2(-0.34 * uAspect, mix(0.33, -0.32, n));
  vec3 sun = mix(C(255., 241., 168.) * 0.95, C(255., 138., 61.), n);
  float sd = length(p - sc);
  col += sun * exp(-sd * sd * 60.0) * 0.22;
  col = mix(col, sun, smoothstep(0.066, 0.062, sd));

  // clouds: three puffs of three circles, drifting, with an ink edge
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float span = uAspect + 0.5;
    vec2 c = vec2(mod(t * (0.012 + fi * 0.006) + fi * 0.37 * span, span) - span * 0.5, 0.2 + fi * 0.085);
    c.x *= 1.0 + fi * 0.15;
    vec2 q = p - c;
    float d = min(min(length(q) - 0.05, length(q - vec2(0.058, -0.012)) - 0.038), length(q + vec2(0.06, 0.014)) - 0.034);
    d = max(d, -(q.y + 0.03));
    vec3 cc = mix(C(217., 239., 255.) * 0.8, vec3(0.82), smoothstep(-0.03, 0.02, q.y));
    float a = mix(1.0, 0.4, n);
    col = mix(col, mix(ink, C(30., 18., 64.), n), smoothstep(0.0015, -0.0005, d) * a);
    col = mix(col, mix(cc, C(58., 36., 112.), n), smoothstep(-0.0025, -0.0045, d) * a);
  }

  // string lights: three wires sagging across the top, a bulb every 0.06; they chase at night
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y0 = i == 0 ? 0.47 : (i == 1 ? 0.36 : 0.28);
    float span = 0.9 * uAspect;
    float wire = y0 - 0.05 * (1.0 - pow(p.x / span, 2.0));
    if (abs(p.y - wire) > 0.05) continue;
    col = mix(col, ink, smoothstep(0.0022, 0.0008, abs(p.y - wire)) * 0.7);
    float k = floor(p.x / 0.06 + 0.5);
    float bx = k * 0.06;
    vec2 q = (p - vec2(bx, y0 - 0.05 * (1.0 - pow(bx / span, 2.0)) - 0.011)) / vec2(0.0065, 0.009);
    float m = mod(k + fi, 3.0);
    vec3 bc = m < 1.0 ? C(255., 207., 106.) : (m < 2.0 ? C(255., 122., 209.) : C(106., 227., 255.));
    float chase = 0.5 + 0.5 * sin(t * 8.0 - k * 0.9);
    vec3 lit = mix(mix(bc, vec3(1.0), 0.45) * 0.8, bc * (1.2 + 2.2 * chase), n);
    col = mix(col, ink, smoothstep(1.35, 1.15, length(q)));
    col = mix(col, lit, smoothstep(1.0, 0.8, length(q)));
    col += bc * exp(-dot(q, q) * 0.22) * mix(0.25, 0.4 + 1.4 * chase, n) * 0.4;
  }

  // bunting: two strings of triangle flags in the arch colours, tips fluttering
  for (int i = 0; i < 2; i++) {
    float y0 = i == 0 ? 0.44 : 0.39;
    float span = 0.95 * uAspect;
    float sag = y0 - 0.04 * (1.0 - pow(p.x / span, 2.0));
    if (p.y > sag + 0.004 || p.y < sag - 0.05) continue;
    col = mix(col, ink, smoothstep(0.002, 0.0008, abs(p.y - sag)) * 0.7);
    float k = floor(p.x / 0.075 + float(i) * 0.5);
    float x0 = (k - float(i) * 0.5) * 0.075;
    float u = (p.x - x0) / 0.06;
    if (u > 1.0) continue;
    float top = y0 - 0.04 * (1.0 - pow((x0 + 0.03) / span, 2.0)) - 0.002;
    float tip = 0.5 + 0.13 * sin(3.0 * t + k);
    float low = top - 0.036 * (u < tip ? u / tip : (1.0 - u) / (1.0 - tip));
    float d = min(p.y - low, top - p.y);
    vec3 fc = archCol(k + float(i) * 2.0) * mix(0.85, 0.35, n);
    col = mix(col, ink, smoothstep(-0.0005, 0.0008, d));
    col = mix(col, fc, smoothstep(0.0015, 0.003, d));
  }

  // balloons drifting up behind the yard, in two layers
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float front = step(7.0, fi);
    float h1 = hash(vec2(fi, 1.7));
    float h2 = hash(vec2(fi, 8.3));
    float h3 = hash(vec2(fi, 4.1));
    float r = mix(0.015, 0.025, front) * (0.85 + 0.3 * h3);
    float y = mod(t * mix(0.01, 0.025, front) * (0.8 + 0.4 * h2) + h1 * 1.3, 1.3) - 0.62;
    float x = (h2 - 0.5) * 0.96 * uAspect + 0.02 * sin(t * (0.5 + h3) + fi * 2.1);
    vec2 q = p - vec2(x, y);
    if (abs(q.x) > r * 2.0 || q.y > r * 1.4 || q.y < -r * 6.0) continue;
    float body = smoothstep(1.0, 0.9, length(q / vec2(r, r * 1.18)));
    float knot = step(abs(q.x), (q.y + r * 1.32) * 0.9) * step(q.y, -r * 1.08);
    float str = smoothstep(0.0016, 0.0005, abs(q.x - 0.003 * sin(q.y * 160.0 + t * 3.0))) * step(q.y, -r * 1.25) * step(-r * 5.5, q.y);
    float a = mix(0.3, 0.45, front) * mix(1.0, 0.5, n);
    vec3 bc = mix(archCol(fi), C(60., 30., 90.), n * 0.6);
    col = mix(col, bc, clamp(body + knot, 0.0, 1.0) * a);
    col = mix(col, ink, str * a * 0.7);
  }

  // the hedge and the picket fence in front of it, then the lawn
  float hb = -0.2 + 0.02 * sqrt(max(0.0, 1.0 - pow(fract(p.x / 0.07) * 2.0 - 1.0, 2.0))) + 0.004 * sin(p.x * 23.0);
  vec3 sil = C(30., 18., 64.);
  if (p.y < hb + 0.003) {
    col = mix(col, mix(C(111., 210., 126.) * 0.9, sil, n), smoothstep(0.0015, -0.0015, p.y - hb));
    col = mix(col, mix(C(73., 184., 95.) * 0.9, sil, n), smoothstep(0.004, 0.008, hb - p.y));
    float px = (fract(p.x / 0.045) - 0.5) * 0.045;
    float post = max(abs(px) - 0.0065, p.y - (-0.19 - abs(px) * 1.1));
    float rails = min(abs(p.y + 0.215), abs(p.y + 0.242)) - 0.004;
    float fence = max(min(post, rails), -(p.y + 0.262));
    vec3 white = mix(C(255., 246., 232.) * 0.85, sil, n);
    col = mix(col, mix(ink, sil, n), smoothstep(0.0018, 0.0006, fence));
    col = mix(col, white, smoothstep(-0.0005, -0.0018, fence));
    vec3 lawn = mix(mix(C(92., 196., 110.), C(52., 150., 80.), smoothstep(-0.26, -0.5, p.y)) * 0.85, C(24., 12., 48.), n);
    col = mix(col, lawn, smoothstep(-0.258, -0.262, p.y));
  }

  // the crowd: a row of balloon-animal heads and ears along the bottom, bobbing to the beat at night
  if (p.y < -0.33) {
    float k = floor(p.x / 0.075);
    float hk = hash(vec2(k, 2.0));
    vec2 hc = vec2((k + 0.5) * 0.075 + (hk - 0.5) * 0.02, -0.425 + 0.012 * hash(vec2(k, 5.0)) + 0.006 * uBeat * n * (1.0 - 2.0 * mod(k, 2.0)));
    float hr = 0.024 + 0.01 * hash(vec2(k, 7.0));
    vec2 q = p - hc;
    float d = length(q / vec2(1.0, 0.92)) - hr;
    if (hk < 0.5) {
      // tall bunny ears
      d = min(d, length((q - vec2(-hr * 0.45, hr * 1.5)) / vec2(0.32, 1.0)) - hr * 0.55);
      d = min(d, length((q - vec2(hr * 0.45, hr * 1.5)) / vec2(0.32, 1.0)) - hr * 0.55);
    } else {
      // pointy dog ears
      vec2 e = vec2(abs(q.x) - hr * 0.75, q.y - hr * 0.6);
      d = min(d, max(abs(e.x) * 1.6 + e.y * 0.8 - hr * 0.55, -e.y - hr * 0.3));
    }
    d = min(d, max(abs(q.x) - hr * 1.3, q.y + hr * 0.4));
    d = min(d, p.y + 0.455);
    vec3 crowd = mix(mix(col, C(199., 168., 255.), 0.6), C(18., 8., 42.), n);
    col = mix(col, crowd, smoothstep(0.0015, -0.0015, d));
  }

  // night: two spotlights sweeping up from the bottom corners
  if (n > 0.0) {
    for (int i = 0; i < 2; i++) {
      float sgn = i == 0 ? -1.0 : 1.0;
      vec2 d = p - vec2(sgn * 0.5 * uAspect, -0.55);
      float aim = -sgn * 0.45 + 0.35 * sin(t * 2.094 + float(i) * 3.14);
      float a = atan(d.x, d.y);
      float beam = smoothstep(0.1, 0.0, abs(a - aim)) * smoothstep(1.5, 0.1, length(d));
      col += (i == 0 ? C(255., 79., 216.) : C(47., 211., 255.)) * beam * 0.18 * (1.0 + 0.5 * uBeat) * n;
    }
    // light thrown off the mirror ball: rainbow dots turning around it
    vec2 q = p - uBall;
    float ca = cos(t * 0.4);
    float sa = sin(t * 0.4);
    q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
    vec2 cell = floor(q / 0.11);
    vec2 fq = q / 0.11 - cell - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5;
    float h = hash(cell);
    col += hue(h * 7.0) * step(0.55, h) * smoothstep(0.1, 0.05, length(fq)) * 0.5 * n * smoothstep(0.06, 0.2, length(q));
  }

  col *= 1.0 - 0.35 * smoothstep(0.45, 1.0, length(p * vec2(0.7, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}`

/* ------------------------------------------------------------------ */
/*  Ring bursts: every expanding ring in one instanced draw             */
/* ------------------------------------------------------------------ */

interface RingFx {
  x: number
  y: number
  z: number
  c: THREE.Color
  r0: number
  r1: number
  t: number
  life: number
}

class Rings {
  readonly mesh: THREE.InstancedMesh
  private readonly list: RingFx[] = []
  private readonly tint: THREE.InstancedBufferAttribute
  private readonly m = new THREE.Matrix4()

  constructor(private readonly cap: number) {
    const geo = new THREE.PlaneGeometry(1, 1)
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aTint', this.tint)
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: ringTexture() } },
      vertexShader: 'attribute vec4 aTint; varying vec4 vTint; varying vec2 vUv; void main() { vTint = aTint; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vTint; varying vec2 vUv; void main() { gl_FragColor = vec4(vTint.rgb, texture2D(map, vUv).a * vTint.a); }',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 8
  }

  get active() {
    return this.list.length > 0
  }

  /** a ring growing from half-size r0 to r1 while it fades */
  emit(at: THREE.Vector3, c: THREE.Color, r0: number, r1: number, life: number) {
    if (this.list.length >= this.cap) this.list.shift()
    this.list.push({ x: at.x, y: at.y, z: at.z, c: c.clone(), r0, r1, t: 0, life })
  }

  update(dt: number) {
    let n = 0
    for (const f of this.list) {
      f.t += dt
      if (f.t >= f.life) continue
      const k = f.t / f.life
      const s = (f.r0 + (f.r1 - f.r0) * ease(k)) * 2
      this.mesh.setMatrixAt(n, this.m.makeScale(s, s, 1).setPosition(f.x, f.y, f.z))
      this.tint.setXYZW(n, f.c.r, f.c.g, f.c.b, (1 - k) ** 1.5)
      this.list[n++] = f
    }
    this.list.length = n
    this.mesh.count = n
    this.mesh.visible = n > 0
    this.mesh.instanceMatrix.needsUpdate = true
    this.tint.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

/* ------------------------------------------------------------------ */
/*  Stage bits                                                          */
/* ------------------------------------------------------------------ */

interface Flight {
  from: THREE.Vector3
  ctrl: THREE.Vector3
  to: THREE.Vector3
  t: number
  dur: number
  obj: THREE.Object3D | null
  color: THREE.Color
  /** orbs can be cut short by hurry() */
  orb: boolean
  done: () => void
}

/** one balloon of the arch; x and r are x0 and r0 pulled in on narrow screens */
interface ArchBalloon {
  x0: number
  r0: number
  x: number
  y: number
  z: number
  r: number
  rot: number
  /** distance along the arch, for the chase */
  s: number
  color: number
  w: number
  ph: number
}

interface Escapee {
  on: boolean
  p: THREE.Vector3
  v: THREE.Vector3
  r: number
  ph: number
  color: THREE.Color
}

interface Rocket {
  x: number
  y: number
  z: number
  vy: number
  top: number
  wait: number
  color: THREE.Color
}

/** a light cone: a spotlight on a held column, or a disco beam sweeping the room */
interface Cone {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  /** a spotlight's column (it fades once the column lands), or -1 for a beam */
  col: number
  on: number
  /** seconds since it came on (negative until a spotlight's hold starts) */
  t: number
  /** a beam's sweep: how long, and from and to which angle */
  life: number
  a0: number
  a1: number
}

type Act = HostAction | 'pump' | 'pins' | 'blow'
const ACT_DUR: Record<Act, number> = { slap: 0.12, scratch: 0.5, shades: 1.2, cheer: 0.6, jump: 0.5, yawn: 1.4, cross: 1.2, gasp: 0.8, fist: 0.6, pump: 0.54, pins: 0.42, blow: 0.5 }

interface Pose {
  /** where each arm (left, right) points from the shoulder, in the torso's frame, and how far it goes there from rest */
  arm: THREE.Vector3[]
  reach: number[]
  hop: number
  lean: number
  nod: number
  tilt: number
  shades: number
  open: number
}
const pose = (): Pose => ({ arm: [new THREE.Vector3(), new THREE.Vector3()], reach: [0, 0], hop: 0, lean: 0, nod: 0, tilt: 0, shades: 0, open: 0 })
const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize()
/** arm directions for DJ Bop's gestures (left, right) */
const ARMS = {
  up: [dir(-0.5, 0.82, 0.12), dir(0.5, 0.82, 0.12)],
  wide: [dir(-0.78, 0.6, -0.05), dir(0.78, 0.6, -0.05)],
  cheeks: [dir(-0.3, 0.72, 0.6), dir(0.3, 0.72, 0.6)],
  hug: [dir(0.4, 0.02, 0.92), dir(-0.4, 0.08, 0.92)],
  hold: [dir(0.12, 0.3, 0.95), dir(-0.12, 0.3, 0.95)],
  ear: dir(-0.3, 0.8, -0.5),
  throw: dir(-0.25, 0.15, 0.96),
  fist: dir(0.32, 0.92, 0.2),
  punch: dir(0.42, 0.6, 0.68),
  lift: dir(0.42, -0.05, 0.9),
  slam: dir(0.38, -0.55, 0.74),
  deck: dir(0.69, -0.62, 0.37),
  pumpUp: dir(0.3, 0.12, 0.95),
  pumpDown: dir(0.32, -0.28, 0.9),
}

/* ------------------------------------------------------------------ */
/*  The scene                                                           */
/* ------------------------------------------------------------------ */

export class PartyScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** a drop column came to rest; syms top to bottom */
  onLand?: (col: number, syms: Sym[]) => void
  /** a disco ball came to rest (drop or refill); the screen counts and chimes */
  onDiscoLand?: (id: number) => void
  /** refills of a float-up started rising */
  onRefill?: () => void
  onCoin?: () => void
  /** real-time beat while the Disco Night mood is on: 120 BPM, n = 0,1,2…; hat on odd half-beats */
  onBeat?: (n: number, half: boolean) => void
  thumbs: Partial<Record<Sym | 'host', string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
  private readonly key: THREE.DirectionalLight
  private readonly ambient: THREE.AmbientLight

  private readonly pool = new Map<Sym, Piece[]>()
  private readonly live = new Set<Piece>()
  private readonly byId = new Map<number, Piece>()

  // the floor
  private readonly tiles: Tile[] = []
  private readonly tileMat: THREE.ShaderMaterial
  private readonly tileAttr: THREE.InstancedBufferAttribute
  private readonly fxAttr: THREE.InstancedBufferAttribute
  private readonly hotAttr: THREE.InstancedBufferAttribute
  private readonly badges: Badge[] = []
  private readonly badgeMesh: THREE.InstancedMesh
  private readonly badgeMat: THREE.ShaderMaterial
  private readonly slotAttr: THREE.InstancedBufferAttribute
  private readonly badgeDim: THREE.InstancedBufferAttribute

  // the stage
  private readonly backMat: THREE.ShaderMaterial
  private readonly bedMat: THREE.MeshBasicMaterial
  private readonly dimMat: THREE.MeshBasicMaterial
  private readonly dimMesh: THREE.Mesh
  private readonly lipMat: THREE.MeshBasicMaterial
  private readonly stripMat: THREE.ShaderMaterial
  private readonly arch: ArchBalloon[]
  private readonly archMesh: THREE.InstancedMesh
  private readonly archLen: number
  private readonly escapees: Escapee[] = []
  private readonly escMesh: THREE.InstancedMesh
  private readonly dj: HostRig
  private readonly mirror: THREE.Group
  private readonly mirrorBall: THREE.Object3D
  private readonly blackMat: THREE.ShaderMaterial
  private readonly flashMat: THREE.ShaderMaterial
  private readonly overlays: THREE.Mesh[] = []
  private readonly thrown: THREE.Mesh
  private readonly coneTex: THREE.Texture
  private readonly coneGeo: THREE.PlaneGeometry
  /** every light cone's material is a copy of this one, which lives as long as the scene: their shader compiles once
   *  (before the first spin) and is not thrown away each time the last cone fades */
  private readonly coneMat: THREE.MeshBasicMaterial

  // effects
  private readonly sparks = new Sparks(1800)
  private readonly rings = new Rings(72)
  private readonly shreds: Bits
  private readonly blasts: Bits
  private readonly records: Bits
  private readonly confetti: Bits
  private readonly coins: Bits
  private readonly cards: { sprite: THREE.Sprite; t: number }[] = []
  private readonly orbPool: THREE.Sprite[] = []
  private flights: Flight[] = []
  private hats: { obj: THREE.Group; v: THREE.Vector3; spin: number; t: number }[] = []
  private cones: Cone[] = []
  private rockets: Rocket[] = []
  private fountain: { at: THREE.Vector3; t: number } | null = null
  /** scene-time timers: promises from wait(), and jobs from after(), which are dropped on dispose */
  private timers: { at: number; fn: () => void; job: boolean }[] = []
  private conds: { test: () => boolean; fn: () => void }[] = []

  // the host
  private act: { kind: Act; t: number; dur: number } | null = null
  private readonly pose = pose()
  private point: { at: THREE.Vector3; t: number } | null = null
  private pointW = 0
  private balloonT = -1
  private shadesT = -1
  private scratch = 0
  private slapAt = -1

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private readonly quality = new PacedQuality()
  private drewLast = false
  private frame = 0
  private dist = 20
  /** CAM_Y, lowered when a narrow screen leaves height to spare, so the spare goes to the counters under the arch */
  private camY = CAM_Y
  private raf = 0
  private last = 0
  private acc = 0
  /** scene time (runs at the scene speed) and real time */
  private time = 0
  private clock = 0
  private base = 1
  private boost = 1
  private chain = 1
  private slowmo = 1
  private combo = 0
  private chase = 0
  private free = 0
  private freeTo = 0
  private mirrorK = 0
  private black = 0
  private blackTo = 0
  private flashA = 0
  private dim = 0
  private dimTo = 0
  private tease = 0
  private teaseTo = 0
  private teaseCol = -1
  private readonly rising = new Array<number>(COLS).fill(-Infinity)
  private stripFlare = 0
  private archBounce = 0
  private shake = 0
  private push = 0
  private pushTo = 0
  private readonly pushAt = new THREE.Vector3()
  private shower = 0
  private coinAt = 0
  private beatOn = false
  private beatClock = 0
  private beatHalf = -1
  private beatAt = -10
  private beat = 0
  private wiggleAt = 3
  private escapeAt = 12
  private glintAt = 0
  private lastDisco = -1
  private floorDirty = true
  private badgeScale = 0
  private readonly pointer = new THREE.Vector2()
  private readonly look = new THREE.Vector2()
  private disposed = false
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void

  constructor(private readonly el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.localClippingEnabled = true
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none'
    el.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.45, 0.85)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.key = new THREE.DirectionalLight('#fff4e0', 2)
    this.key.position.set(-3, 5, 6)
    this.ambient = new THREE.AmbientLight('#d8e8ff', 0.95)
    this.scene.add(this.key, this.ambient)

    // the backyard
    this.backMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFree: { value: 0 }, uBeat: { value: 0 }, uAspect: { value: 1 }, uBall: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: BACK_FRAG,
      depthWrite: false,
      depthTest: false,
    })
    const quad = new THREE.PlaneGeometry(2, 2)
    const back = new THREE.Mesh(quad, this.backMat)
    back.frustumCulled = false
    back.renderOrder = -10
    this.scene.add(back)
    this.own.push(quad, this.backMat)

    // the floor: a dark bed showing as grout between 49 tiles, and a badge on each lit tile
    this.bedMat = new THREE.MeshBasicMaterial({ color: '#150b2e' })
    const winGeo = new THREE.PlaneGeometry(IN_W * 2, IN_H * 2)
    const bed = new THREE.Mesh(winGeo, this.bedMat)
    bed.position.z = Z_BED
    this.scene.add(bed)
    this.own.push(winGeo, this.bedMat)

    const tileGeo = new THREE.ShapeGeometry(roundRect(0.48, 0.48, 0.12) as THREE.Shape, 4)
    this.tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(49 * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.fxAttr = new THREE.InstancedBufferAttribute(new Float32Array(49 * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.hotAttr = new THREE.InstancedBufferAttribute(new Float32Array(49 * 3), 3).setUsage(THREE.DynamicDrawUsage)
    tileGeo.setAttribute('aTile', this.tileAttr)
    tileGeo.setAttribute('aFx', this.fxAttr)
    tileGeo.setAttribute('aHotColor', this.hotAttr)
    this.tileMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFree: { value: 0 }, uBeat: { value: 0 }, uDim: { value: 0 }, uPalette: { value: LEVEL_COLOR.map((c) => new THREE.Color(c)) } },
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
    })
    const tileMesh = new THREE.InstancedMesh(tileGeo, this.tileMat, 49)
    const badgeGeo = new THREE.PlaneGeometry(1, 1)
    this.slotAttr = new THREE.InstancedBufferAttribute(new Float32Array(49).fill(-1), 1).setUsage(THREE.DynamicDrawUsage)
    this.badgeDim = new THREE.InstancedBufferAttribute(new Float32Array(49), 1).setUsage(THREE.DynamicDrawUsage)
    badgeGeo.setAttribute('aSlot', this.slotAttr)
    badgeGeo.setAttribute('aDim', this.badgeDim)
    this.badgeMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: badgeAtlas() }, uDim: { value: 0 }, uHide: { value: 0 } },
      vertexShader: BADGE_VERT,
      fragmentShader: BADGE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.badgeMesh = new THREE.InstancedMesh(badgeGeo, this.badgeMat, 49)
    this.badgeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.badgeMesh.renderOrder = 6
    const m = new THREE.Matrix4()
    for (let pos = 0; pos < 49; pos++) {
      tileMesh.setMatrixAt(pos, m.makeTranslation(cellX(colOf(pos)), cellY(rowOf(pos)), Z_TILE))
      this.tiles.push({ level: 0, hot: 0, hotTo: 0, lift: 0, liftTo: 0, block: 0, blockTo: 0 })
      this.badges.push({ slot: -1, anim: null, t: 0, next: -1, dim: 0, zoom: 1, zoomTo: 1 })
    }
    tileMesh.frustumCulled = this.badgeMesh.frustumCulled = false
    this.scene.add(tileMesh, this.badgeMesh)
    this.own.push(tileGeo, this.tileMat, tileMesh, badgeGeo, this.badgeMat, this.badgeMesh)

    // the dimmer in front of the floor while a cluster shows off
    this.dimMat = new THREE.MeshBasicMaterial({ color: '#0b0420', transparent: true, opacity: 0, depthWrite: false })
    this.dimMesh = new THREE.Mesh(winGeo, this.dimMat)
    this.dimMesh.position.z = Z_DIM
    this.dimMesh.renderOrder = 2
    this.scene.add(this.dimMesh)
    this.own.push(this.dimMat)

    // the arch: a toon backing ring with an ink outline, two rows of balloons, a neon lip and the pump strip
    const ramp = toonRamp(RAMP)
    const backGeo = new THREE.ExtrudeGeometry(ring(IN_W + RIM, IN_H + RIM, 0.6, IN_W + 0.02, IN_H + 0.02, 0.2), { depth: 0.3, bevelEnabled: false, curveSegments: 14 })
    const faceMat = new THREE.MeshToonMaterial({ color: '#3b1d6e', gradientMap: ramp })
    const wallMat = new THREE.MeshToonMaterial({ color: '#24104a', gradientMap: ramp })
    const backing = new THREE.Mesh(backGeo, [faceMat, wallMat])
    backing.position.z = -0.5
    const inkGeo = new THREE.ShapeGeometry(ring(IN_W + RIM + 0.07, IN_H + RIM + 0.07, 0.67, IN_W + 0.02, IN_H + 0.02, 0.2), 14)
    const inkMat = new THREE.MeshBasicMaterial({ color: INK })
    const inkRing = new THREE.Mesh(inkGeo, inkMat)
    inkRing.position.z = -0.52
    this.scene.add(backing, inkRing)
    this.own.push(backGeo, faceMat, wallMat, inkGeo, inkMat)

    const layout = archLayout()
    this.arch = layout.balloons
    this.archLen = layout.length
    this.archMesh = new THREE.InstancedMesh(garlandGeometry(), castMaterial(true), this.arch.length)
    this.archMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.archMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.arch.length * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.archMesh.frustumCulled = false
    this.escMesh = new THREE.InstancedMesh(garlandGeometry(), castMaterial(true), 3)
    this.escMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.escMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(9), 3).setUsage(THREE.DynamicDrawUsage)
    this.escMesh.count = 0
    this.escMesh.frustumCulled = false
    for (let i = 0; i < 3; i++) this.escapees.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0.2, ph: 0, color: new THREE.Color() })
    this.scene.add(this.archMesh, this.escMesh)
    this.own.push(this.archMesh, this.escMesh)

    const lipGeo = new THREE.ShapeGeometry(ring(IN_W + 0.035, IN_H + 0.035, 0.24, IN_W - 0.005, IN_H - 0.005, 0.2), 14)
    this.lipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7ad1').multiplyScalar(1.6) })
    const lip = new THREE.Mesh(lipGeo, this.lipMat)
    lip.position.z = 0.12
    this.scene.add(lip)
    this.own.push(lipGeo, this.lipMat)

    const stripGeo = new THREE.PlaneGeometry(7.1, 0.07)
    this.stripMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#7ff3ff').multiplyScalar(1.4) }, uTime: { value: 0 } },
      vertexShader: FLAT_VERT,
      fragmentShader: STRIP_FRAG,
    })
    const strip = new THREE.Mesh(stripGeo, this.stripMat)
    strip.position.set(0, -IN_H + 0.045, 0.05)
    this.scene.add(strip)
    this.own.push(stripGeo, this.stripMat)

    // DJ Bop at his booth on top of the arch, and the mirror ball waiting out of sight
    this.dj = buildHost()
    this.dj.root.position.copy(BOOTH)
    this.sizeHost(true)
    this.dj.pump.scale.setScalar(PROP)
    this.dj.pins.scale.setScalar(PROP)
    this.scene.add(this.dj.root)
    this.mirror = buildMirrorBall()
    this.mirror.position.set(MIRROR.x, MIRROR.y + MIRROR_UP, MIRROR.z)
    this.mirror.visible = false
    this.mirrorBall = this.mirror.getObjectByName('ball')!
    this.scene.add(this.mirror)
    // the pin DJ Bop throws in Pin Drop
    const pin = new VKit()
    pin.add(new THREE.CylinderGeometry(0.008, 0.002, 0.2, 6), '#dfe6ff', T([0, -0.06, 0]), 0.008)
    pin.add(new THREE.SphereGeometry(0.034, 12, 9), '#ff3b55', T([0, 0.05, 0]), 0.012)
    this.thrown = pin.mesh('pin', castMaterial(true))
    this.thrown.visible = false
    this.scene.add(this.thrown)
    for (const o of [this.dj.root, this.mirror, this.thrown])
      o.traverse((x) => {
        if (x instanceof THREE.Mesh) this.own.push(x.geometry)
      })

    // full-screen layers: the blackout before Disco Night and the white flash of big moments
    this.blackMat = overlayMaterial('#05020d', THREE.NormalBlending)
    this.flashMat = overlayMaterial('#ffffff', THREE.AdditiveBlending)
    for (const [mat, order] of [
      [this.blackMat, 20],
      [this.flashMat, 21],
    ] as const) {
      const o = new THREE.Mesh(quad, mat)
      o.frustumCulled = false
      o.renderOrder = order
      o.visible = false
      this.overlays.push(o)
      this.scene.add(o)
      this.own.push(mat)
    }
    this.coneTex = coneTexture()
    this.coneGeo = new THREE.PlaneGeometry(1, 1)
    this.coneGeo.translate(0, -0.5, 0)
    this.coneMat = new THREE.MeshBasicMaterial({ map: this.coneTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })
    this.own.push(this.coneTex, this.coneGeo, this.coneMat)

    // shreds and bits: latex inside the window (clipped), the Big Pop, records, confetti and coins
    const shredMat = vkMaterial(ramp)
    this.clip(shredMat)
    this.shreds = new Bits(shredGeometry(), shredMat, 420, true)
    this.blasts = new Bits(shredGeometry(), vkMaterial(ramp), 120, true)
    this.records = new Bits(recordGeometry(), vkMaterial(ramp), 16, false)
    const confGeo = new THREE.PlaneGeometry(0.09, 0.05)
    this.confetti = new Bits(confGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 500, false)
    const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24)
    coinGeo.rotateX(Math.PI / 2)
    this.coins = new Bits(coinGeo, new THREE.MeshToonMaterial({ color: '#ffc93d', gradientMap: ramp, emissive: '#7a4a00', emissiveIntensity: 0.3 }), 220, false)
    this.shreds.mesh.renderOrder = 8
    this.blasts.mesh.renderOrder = 9
    this.confetti.mesh.renderOrder = 9
    this.coins.mesh.renderOrder = 9
    this.scene.add(this.shreds.mesh, this.blasts.mesh, this.records.mesh, this.confetti.mesh, this.coins.mesh, this.sparks.points, this.rings.mesh)
    this.own.push(this.shreds, this.blasts, this.records, this.confetti, this.coins, this.sparks, this.rings)

    // POP! cards, over the sparks of the pops they mark
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: popCardTexture(), transparent: true, depthTest: false, depthWrite: false, opacity: 0 }))
      s.renderOrder = 11
      s.visible = false
      this.scene.add(s)
      this.cards.push({ sprite: s, t: 1 })
      this.own.push(s.material)
    }

    this.onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = cv.getBoundingClientRect()
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
    }
    this.onLeave = () => this.pointer.set(0, 0)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerleave', this.onLeave)

    this.flushFloor()
    const r0 = el.getBoundingClientRect()
    this.resize(r0.width || 800, r0.height || 600)
    this.ready = this.init()
  }

  /* ---------------- setup ---------------- */

  private async init() {
    const step = (p: number) => {
      this.onProgress?.(p)
      return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    }
    await step(0.1)
    if (this.disposed) return
    warmUp()
    for (const m of allMaterials()) this.clip(m)
    await step(0.45)
    if (this.disposed) return
    // one of everything, out of sight and showing every face, so every shader is compiled before the first spin
    const warm = new THREE.Group()
    const temp: Piece[] = []
    for (const s of PREVIEW) {
      const p = this.acquire(s, -1)
      if (p.joy) p.joy.visible = true
      p.glow.visible = true
      temp.push(p)
      this.scene.remove(p.root)
      warm.add(p.root)
    }
    const hat = buildOctoHat()
    const cone = new THREE.Mesh(this.coneGeo, this.coneMat)
    cone.frustumCulled = false
    warm.add(hat, cone)
    warm.position.set(0, 0, -30)
    this.scene.add(warm)
    const hidden: THREE.Object3D[] = [this.mirror, this.thrown, this.dj.pump, this.dj.pins, this.dj.balloon, this.dj.mouth.open, ...this.overlays]
    for (const o of hidden) o.visible = true
    const far = new THREE.Vector3(0, 0, -30)
    for (const b of [this.shreds, this.blasts, this.records, this.confetti, this.coins]) {
      b.emit(far, new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
      b.update(0)
    }
    this.sparks.emit(0, 0, -30, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.sparks.update(0)
    this.rings.emit(far, new THREE.Color(), 0.1, 0.1, 0.01)
    this.rings.update(0)
    this.cards[0].sprite.visible = true
    // for the target the scene is drawn into (the composer's linear, untoned buffer), not the canvas; compile() also
    // reaches what the warm frame below can't draw, such as the mirror ball parked out of sight
    try {
      this.renderer.setRenderTarget(this.composer.readBuffer)
      const compiled = this.renderer.compileAsync(this.scene, this.camera)
      this.renderer.setRenderTarget(null)
      await compiled
    } catch {
      this.renderer.setRenderTarget(null)
      /* compiles on first draw instead */
    }
    if (this.disposed) return
    await step(0.8)
    if (this.disposed) return
    this.composer.render()
    for (const o of hidden) o.visible = false
    this.dj.root.visible = true
    this.cards[0].sprite.visible = false
    this.scene.remove(warm)
    for (const p of temp) {
      warm.remove(p.root)
      this.release(p)
    }
    try {
      this.thumbs = this.makeThumbs()
    } catch {
      this.thumbs = {}
    }
    await step(1)
    if (this.disposed) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** DJ Bop and his booth at stage size (bigger than modelled, him standing a little taller), or as modelled */
  private sizeHost(stage: boolean) {
    const { torso, booth } = this.dj
    torso.scale.setScalar(stage ? HOST_SCALE : 1)
    booth.scale.setScalar(stage ? BOOTH_SCALE : 1)
    restOf(torso).y = stage ? HOST_LIFT : 0
    torso.position.y = restOf(torso).y
  }

  private clip(m: THREE.Material) {
    if (m.clippingPlanes !== CLIP) {
      m.clippingPlanes = CLIP
      m.needsUpdate = true
    }
  }

  /** small transparent pictures of each symbol (all smiles) and of DJ Bop, for the paytable */
  private makeThumbs() {
    const r = this.renderer
    const cv = r.domElement
    const size = Math.floor(Math.min(160, cv.width / 4, cv.height / 3))
    if (size < 40) return {}
    const ts = new THREE.Scene()
    const key = new THREE.DirectionalLight('#fff4e0', 2)
    key.position.set(-3, 5, 6)
    ts.add(key, new THREE.AmbientLight('#d8e8ff', 0.95))
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20)
    const out = document.createElement('canvas')
    out.width = out.height = size
    const g = out.getContext('2d')!
    const css = size / this.dpr
    const res: Partial<Record<Sym | 'host', string>> = {}
    const clear = r.getClearColor(new THREE.Color())
    const alpha = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    r.setScissorTest(true)
    r.setViewport(0, 0, css, css)
    r.setScissor(0, 0, css, css)
    const shoot = (o: THREE.Object3D, name: Sym | 'host') => {
      ts.add(o)
      r.clear()
      r.render(ts, cam)
      g.clearRect(0, 0, size, size)
      g.drawImage(cv, 0, cv.height - size, size, size, 0, 0, size, size)
      res[name] = out.toDataURL('image/png')
      ts.remove(o)
    }
    cam.position.set(0, 0, 2.6)
    cam.lookAt(0, 0, 0)
    for (const s of PREVIEW) {
      const o = buildSymbol(s)
      o.traverse((x) => {
        if (x.name === 'halo') x.visible = false
        if (x.name === 'joy') x.visible = true
        if (x.name === 'eyes') x.visible = false
      })
      shoot(o, s)
    }
    // DJ Bop from the chest up, borrowed from the stage for a moment at his modelled size
    const root = this.dj.root
    root.position.set(0, 0, 0)
    this.sizeHost(false)
    cam.position.set(0.1, 0.9, 1.9)
    cam.lookAt(0, 0.8, -0.3)
    shoot(root, 'host')
    this.sizeHost(true)
    root.position.copy(BOOTH)
    this.scene.add(root)
    r.setScissorTest(false)
    r.setViewport(0, 0, this.w, this.h)
    r.setClearColor(clear, alpha)
    return res
  }

  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    this.w = w
    this.h = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(this.dpr)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    // the counters need about HUD_PX under the arch whatever the size, so a short stage shows a little more below
    const fitH = FIT_H / Math.max(0.5, 1 - HUD_PX / h)
    this.dist = Math.max(fitH / 2 / tan, FIT_W / 2 / (tan * this.camera.aspect))
    // the top of the view stays put; any height to spare goes under the arch
    this.camY = VIEW_TOP - tan * this.dist
    this.placeCamera()
    this.sparks.mat.uniforms.scale.value = (h * this.dpr) / (2 * tan)
    this.backMat.uniforms.uAspect.value = w / h
    // on narrow screens the arch's sides tuck in and its balloons there shrink a little, to fit the width
    const room = tan * this.dist * this.camera.aspect - IN_W
    const t = clamp01((room - 0.36) / 0.16)
    for (const b of this.arch) {
      const out = Math.abs(b.x0) - IN_W
      b.x = out > 0 ? Math.sign(b.x0) * (IN_W + out * (0.3 + 0.7 * t)) : b.x0
      b.r = b.r0 * (1 - (1 - t) * 0.2 * clamp01(out / 0.12))
    }
    // badges grow a little on small screens, so their numbers stay readable
    const scale = Math.min(1.15, Math.max(1, 14 / ((BADGE_Q * BADGE_H * h) / (2 * tan * this.dist))))
    if (scale !== this.badgeScale) {
      this.badgeScale = scale
      for (let pos = 0; pos < 49; pos++) this.placeBadge(pos, this.badges[pos].slot >= 0 ? 1 : 0)
    }
    if (this.raf) this.composer.render()
  }

  private placeCamera() {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const k = smooth(this.push) * 0.07
    const at = new THREE.Vector3(this.look.x * 0.3 + sx, this.camY - this.look.y * 0.2 + sy, this.dist)
    const aim = new THREE.Vector3(sx * 0.5, this.camY + sy * 0.5, 0)
    this.camera.position.copy(at.lerp(this.pushAt, k))
    this.camera.lookAt(aim.lerp(this.pushAt, k * 4))
  }

  /* ---------------- clock ---------------- */

  private get speed() {
    return this.base * this.boost * this.chain * this.slowmo
  }

  setTurbo(on: boolean) {
    this.base = on ? 1.75 : 1
  }

  /** the player is impatient: run the rest of the round three times as fast, skip tease holds and orb flights */
  hurry() {
    this.boost = 3
    this.teaseTo = 0
    // columns still waiting (held ones too) come up right away
    for (const p of this.live) if (p.state === 'rise' && p.wait > 0.1) p.wait = Math.min(p.wait, 0.04 + p.col * 0.03)
    for (const f of this.flights) if (f.orb) f.t = 1
  }

  calm() {
    this.boost = 1
    this.chain = 1
  }

  get hurried() {
    return this.boost > 1
  }

  /** extra speed for long cascades, 1..2 */
  setChain(k: number) {
    this.chain = Math.min(2, Math.max(1, k))
  }

  /** the cascade count so far: the arch chases faster and brighter */
  setCombo(n: number) {
    this.combo = n
  }

  /** scene seconds */
  wait(s: number) {
    return new Promise<void>((r) => (this.disposed ? r() : this.timers.push({ at: this.time + s, fn: r, job: false })))
  }

  private until(test: () => boolean) {
    return new Promise<void>((r) => (this.disposed ? r() : this.conds.push({ test, fn: r })))
  }

  /** runs `fn` after `s` scene seconds */
  private after(s: number, fn: () => void) {
    if (this.disposed) return
    if (s <= 0) fn()
    else this.timers.push({ at: this.time + s, fn, job: true })
  }

  /* ---------------- pieces ---------------- */

  private acquire(sym: Sym, id: number): Piece {
    let p = this.pool.get(sym)?.pop()
    if (!p) p = this.make(sym)
    p.id = id
    p.state = 'idle'
    p.win = p.winTo = p.winT = 0
    p.front = p.frontTo = 0
    p.glowAmt = p.glowTo = 0
    p.squash = p.wiggle = p.flop = p.hop = p.inflate = 0
    p.lift = p.liftTo = p.flare = 0
    p.wait = p.t = p.vy = 0
    p.batch = null
    p.onArrive = p.onBurst = null
    p.phase = Math.random() * 10
    p.bobW = rnd(1.3, 1.7) * TAU
    p.blinkAt = this.clock + rnd(0.5, 4)
    p.flopAt = this.clock + rnd(1, 5)
    p.hopAt = this.clock + rnd(2, 6)
    p.glintAt = this.clock + rnd(0, 0.8)
    if (p.joy) p.joy.visible = false
    if (p.eyes) p.eyes.visible = true
    for (const o of Object.values(p.parts)) {
      const r = o.userData.rest as Rest | undefined
      if (!r) continue
      o.position.set(r.x, r.y, r.z)
      o.rotation.set(r.rx, r.ry, r.rz)
      o.scale.setScalar(1)
    }
    p.root.visible = true
    p.root.scale.setScalar(1)
    p.inner.position.set(0, 0, 0)
    p.inner.rotation.set(0, 0, 0)
    p.inner.scale.setScalar(1)
    this.scene.add(p.root)
    this.live.add(p)
    if (id >= 0) this.byId.set(id, p)
    return p
  }

  private make(sym: Sym): Piece {
    const model = buildSymbol(sym)
    model.scale.setScalar(CAST)
    for (const m of symbolMaterials(model)) this.clip(m)
    const inner = new THREE.Group()
    inner.add(model)
    const root = new THREE.Group()
    root.add(inner)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(SYMBOL_COLOR[sym]).multiplyScalar(1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
    this.clip(glow.material)
    glow.scale.set(1.5, 1.5, 1)
    glow.position.z = -0.35
    // drawn after the dimmer, so a winner's glow stays bright
    glow.renderOrder = 3
    glow.visible = false
    root.add(glow)
    const parts: Record<string, THREE.Object3D> = {}
    for (const n of PARTS) {
      const o = model.getObjectByName(n)
      if (o) parts[n] = o
    }
    return {
      key: sym,
      sym,
      id: -1,
      root,
      inner,
      model,
      eyes: model.getObjectByName('eyes') ?? null,
      joy: model.getObjectByName('joy') ?? null,
      parts,
      glow,
      col: 0,
      row: 0,
      y: 0,
      ty: 0,
      vy: 0,
      wait: 0,
      phase: 0,
      blinkAt: 0,
      blink: 0,
      win: 0,
      winTo: 0,
      squash: 0,
      inflate: 0,
      state: 'idle',
      y0: 0,
      t: 0,
      move: DROP,
      batch: null,
      onArrive: null,
      onBurst: null,
      popDur: 0.05,
      bobW: TAU * 1.5,
      winT: 0,
      front: 0,
      frontTo: 0,
      glowAmt: 0,
      glowTo: 0,
      squashAmp: 1,
      wiggle: 0,
      flopAt: 0,
      flop: 0,
      hopAt: 0,
      hop: 0,
      lift: 0,
      liftTo: 0,
      flare: 0,
      glintAt: 0,
    }
  }

  private release(p: Piece) {
    if (!this.live.has(p)) return
    this.scene.remove(p.root)
    this.live.delete(p)
    if (this.byId.get(p.id) === p) this.byId.delete(p.id)
    this.untrack(p)
    p.onArrive = p.onBurst = null
    p.state = 'idle'
    p.glow.material.opacity = 0
    p.glow.visible = false
    let list = this.pool.get(p.key)
    if (!list) this.pool.set(p.key, (list = []))
    list.push(p)
  }

  private track(p: Piece, b: Batch) {
    this.untrack(p)
    p.batch = b
    b.n++
  }

  private untrack(p: Piece) {
    if (p.batch) p.batch.n--
    p.batch = null
  }

  /** a piece standing on (col, row) */
  private place(p: Piece, col: number, row: number) {
    p.col = col
    p.row = row
    p.y = p.ty = p.y0 = cellY(row)
    p.root.position.set(cellX(col), p.y, 0)
  }

  /** starts a piece moving up onto `row` from `y0` */
  private send(p: Piece, row: number, y0: number, move: Move, wait: number, state: 'rise' | 'float', b: Batch) {
    p.row = row
    p.ty = cellY(row)
    p.y = p.y0 = y0
    p.move = move
    p.wait = wait
    p.t = 0
    p.state = state
    this.track(p, b)
  }

  private worldOf(p: Piece) {
    return new THREE.Vector3(cellX(p.col), p.y, p.front * Z_WIN)
  }

  private centroid(ps: Piece[]) {
    const c = new THREE.Vector3()
    for (const p of ps) c.add(this.worldOf(p))
    return ps.length ? c.divideScalar(ps.length) : c
  }

  private pieces(ids: number[]) {
    return ids.map((id) => this.byId.get(id)).filter((p): p is Piece => !!p)
  }

  /* ---------------- the floor ---------------- */

  /** the badge quad's side, at rest */
  private badgeSize(pos: number) {
    return BADGE_Q * this.badgeScale * this.badges[pos].zoom
  }

  /** the middle of a cell's badge: its pill tucked into the cell's bottom-right corner */
  private badgeAt(pos: number): [number, number, number] {
    const q = this.badgeSize(pos)
    const w = BADGE_W[Math.max(0, this.badges[pos].slot)] * q
    return [cellX(colOf(pos)) + BADGE_CORNER - w / 2, cellY(rowOf(pos)) - BADGE_CORNER + (BADGE_H * q) / 2, Z_BADGE]
  }

  /** changes a tile; the shader cross-fades from the old colour over `fade` seconds, with a white flash */
  private setTile(pos: number, level: number, fade: number, flash: boolean) {
    const a = this.tileAttr.array as Float32Array
    a[pos * 4 + 1] = fade > 0 ? this.tiles[pos].level : level
    a[pos * 4] = level
    a[pos * 4 + 2] = this.time
    a[pos * 4 + 3] = Math.max(0.001, fade)
    ;(this.fxAttr.array as Float32Array)[pos * 4 + 3] = flash ? 1 : 0
    this.tiles[pos].level = level
    this.tileAttr.needsUpdate = this.fxAttr.needsUpdate = true
  }

  /** shows a badge, animating the change */
  private setBadge(pos: number, level: number, how: 'instant' | 'auto') {
    const b = this.badges[pos]
    const slot = level >= 2 ? level - 2 : -1
    if (how === 'instant') {
      b.slot = b.next = slot
      b.anim = null
      ;(this.slotAttr.array as Float32Array)[pos] = slot
      this.slotAttr.needsUpdate = true
      this.placeBadge(pos, slot >= 0 ? 1 : 0)
    } else if (slot !== b.slot) {
      b.anim = slot < 0 ? 'drop' : b.slot < 0 ? 'stamp' : 'flip'
      b.next = slot
      b.t = 0
      if (b.anim === 'stamp') {
        b.slot = slot
        ;(this.slotAttr.array as Float32Array)[pos] = slot
        this.slotAttr.needsUpdate = true
      }
    }
    this.floorDirty = true
  }

  private punch(pos: number) {
    const b = this.badges[pos]
    if (b.slot >= 0 && !b.anim) {
      b.anim = 'punch'
      b.t = 0
      this.floorDirty = true
    }
  }

  /**
   * Sets every tile: at once, stamped one by one in a square spiral from the middle (1.2 s, `onEach(i)` per stamp),
   * or switched off ring by ring from the middle out (`onEach(ring)` per ring).
   */
  async setTiles(levels: readonly number[], how: 'instant' | 'spiral' | 'waveOff', onEach?: (i: number) => void) {
    if (how === 'instant') {
      levels.forEach((l, pos) => {
        this.setTile(pos, l, 0, false)
        this.setBadge(pos, l, 'instant')
      })
      return
    }
    if (how === 'spiral') {
      const order = spiralOrder()
      const gap = 1.2 / order.length
      order.forEach((pos, i) =>
        this.after(i * gap, () => {
          this.setTile(pos, levels[pos], 0.2, true)
          this.setBadge(pos, levels[pos], 'auto')
          if (levels[pos] >= 1) this.rings.emit(new THREE.Vector3(cellX(colOf(pos)), cellY(rowOf(pos)), Z_TILE + 0.02), new THREE.Color(LEVEL_COLOR[levels[pos]]).multiplyScalar(1.6), 0.3, 0.75, 0.3)
          onEach?.(i)
        }),
      )
      await this.wait(1.2 + 0.2)
      return
    }
    for (let ringN = 0; ringN < 4; ringN++)
      this.after(ringN * 0.25, () => {
        for (let pos = 0; pos < 49; pos++) {
          if (Math.max(Math.abs(colOf(pos) - 3), Math.abs(rowOf(pos) - 3)) !== ringN) continue
          this.setTile(pos, levels[pos], 0.35, false)
          this.setBadge(pos, levels[pos], 'auto')
        }
        onEach?.(ringN)
      })
    await this.wait(0.75 + 0.35)
  }

  /** tiles go up one by one: a ring when one lights, a badge stamped on at ×2, a badge flip above that */
  async tileUps(ups: TileUp[], onUp?: (u: TileUp) => void) {
    if (!ups.length) return
    const gap = Math.min(0.04, 0.3 / ups.length)
    ups.forEach((u, i) =>
      this.after(i * gap, () => {
        const at = new THREE.Vector3(cellX(colOf(u.pos)), cellY(rowOf(u.pos)), Z_TILE + 0.02)
        this.setTile(u.pos, u.to, 0.2, true)
        this.setBadge(u.pos, u.to, 'auto')
        const c = new THREE.Color(LEVEL_COLOR[u.to])
        if (u.to === 1) this.rings.emit(at, new THREE.Color(1.6, 1.6, 1.6), 0.3, 0.8, 0.2)
        else {
          at.set(...this.badgeAt(u.pos))
          this.sparks.burst(at, c, u.to >= 6 ? 10 : 5, 2.6, 0.12, 0.4)
        }
        onUp?.(u)
      }),
    )
    await this.wait((ups.length - 1) * gap + 0.2)
  }

  /** a tile reached ×128: it turns rainbow, a fountain of sparkles rises from it and DJ Bop fist-pumps */
  async tileFanfare(pos: number) {
    const at = new THREE.Vector3(cellX(colOf(pos)), cellY(rowOf(pos)), 0.3)
    this.fountain = { at, t: 1 }
    this.punch(pos)
    this.rings.emit(at, new THREE.Color('#ffd23f').multiplyScalar(2), 0.4, 1.6, 0.6)
    this.sparks.emit(at.x, at.y, at.z + 0.2, 0, 0, 0, new THREE.Color('#ffd23f').multiplyScalar(2.4), 1.8, 0.35, 0, 0, 0.9)
    this.startAct('fist')
    await this.wait(1)
  }

  /** every lit tile fades back to dark */
  private darken(fade: number) {
    this.tiles.forEach((t, pos) => {
      if (!t.level) return
      this.setTile(pos, 0, fade, false)
      this.setBadge(pos, 0, fade > 0 ? 'auto' : 'instant')
    })
  }

  /** disco balls parked on lit tiles grey them out */
  private updateBlocks() {
    for (const t of this.tiles) t.blockTo = 0
    for (const p of this.live) if (p.sym === 'disco' && p.state === 'idle' && p.id >= 0) this.tiles[p.col * ROWS + p.row].blockTo = 1
  }

  /* ---------------- the board ---------------- */

  /** places a grid at rest and sets the tiles, no animation */
  show(grid: Grid, tiles: readonly number[]) {
    for (const p of [...this.live]) this.release(p)
    grid.forEach((col, c) =>
      col.forEach((cell, r) => {
        const p = this.acquire(cell.sym, cell.id)
        this.place(p, c, r)
      }),
    )
    void this.setTiles(tiles, 'instant')
    this.clearHighlight()
    this.updateBlocks()
  }

  /**
   * The old balloons let go and float away while the new floor rises in from below, column by column. Columns from
   * `teaseFrom` on hold back under a spotlight (two disco balls are already showing). Resolves when all have settled.
   */
  async drop(grid: Grid, teaseFrom: number) {
    this.clearHighlight()
    const batch: Batch = { n: 0 }
    for (const p of this.live) {
      if (p.state === 'leave' || p.state === 'popping') continue
      if (this.byId.get(p.id) === p) this.byId.delete(p.id)
      p.state = 'leave'
      p.wait = 0.025 * p.col
      p.vy = 0.5
      p.t = 0
      this.track(p, batch)
    }
    const night = this.freeTo > 0
    // a paid spin starts on a dark floor; in Disco Night the floor stays lit
    if (!night) this.darken(0.3)
    grid.forEach((col, c) => {
      const held = teaseFrom >= 0 && c >= teaseFrom && !this.hurried
      const due = (night ? 0.3 : 0.15) + 0.06 * c
      const start = due + (held ? 0.5 * (c - teaseFrom + 1) : 0)
      const ps = col.map((cell, r) => {
        const p = this.acquire(cell.sym, cell.id)
        p.col = c
        this.send(p, r, cellY(r) - 7.6, DROP, start, 'rise', batch)
        p.root.position.set(cellX(c), p.y, 0)
        if (cell.sym === 'disco') p.onArrive = () => this.discoLanded(p)
        return p
      })
      const first = ps[0]
      const arrive = first.onArrive
      first.onArrive = () => {
        arrive?.()
        this.onLand?.(c, col.map((x) => x.sym))
        for (const k of this.cones) if (k.col === c) k.on = Math.min(k.on, 0.999)
        if (held && c === COLS - 1) this.teaseTo = 0
      }
      if (held) this.spotlight(c, due)
    })
    if (teaseFrom >= 0 && !this.hurried) {
      this.teaseCol = teaseFrom
      this.after((night ? 0.3 : 0.15) + 0.06 * teaseFrom, () => {
        if (!this.hurried) this.teaseTo = 1
      })
    }
    await this.until(() => batch.n <= 0)
    this.teaseTo = 0
    this.updateBlocks()
  }

  private discoLanded(p: Piece) {
    this.lastDisco = p.id
    this.onDiscoLand?.(p.id)
    this.pointAt(this.worldOf(p))
    this.sparks.burst(this.worldOf(p).setZ(0.4), new THREE.Color('#ffd1ff'), 10, 2.6, 0.18, 0.5)
  }

  /** a spotlight cone over a held column, from when it would have come up until it lands */
  private spotlight(col: number, from: number) {
    const mat = this.coneMat.clone()
    mat.color.set('#ffe9b0').multiplyScalar(1.1)
    const mesh = new THREE.Mesh(this.coneGeo, mat)
    mesh.position.set(cellX(col), IN_H + 0.4, 0.3)
    mesh.scale.set(1.9, IN_H * 2 + 0.6, 1)
    mesh.renderOrder = 7
    this.scene.add(mesh)
    this.cones.push({ mesh, mat, col, on: 1, t: -from, life: 0, a0: 0, a1: 0 })
  }

  /** every disco ball on the floor flashes, and DJ Bop points at the newest one */
  flareDiscos() {
    for (const p of this.live) {
      if (p.sym !== 'disco' || p.id < 0 || p.state === 'leave') continue
      p.flare = 1
      const at = this.worldOf(p).setZ(0.45)
      this.rings.emit(at, new THREE.Color('#ffb8f0').multiplyScalar(1.8), 0.3, 1.1, 0.45)
      this.sparks.burst(at, new THREE.Color('#ffd1ff'), 12, 3.4, 0.2, 0.6)
    }
    const p = this.byId.get(this.lastDisco)
    if (p) this.pointAt(this.worldOf(p))
  }

  /**
   * Pump It!: DJ Bop pumps three strokes while the group glows, a rainbow stream flies down to it, and each changed
   * cell's balloon over-inflates and poofs into one of the group's kind. About 1.3 s.
   */
  async pump(groupIds: number[], changes: PumpChangeView[], onChange?: (i: number) => void) {
    const group = this.pieces(groupIds)
    for (const p of group) p.glowTo = 1
    this.startAct('pump')
    const hand = this.handWorld(1).add(new THREE.Vector3(0, 0.3, 0.1))
    const to = this.centroid(group).setZ(0.4)
    for (let i = 0; i < 12; i++)
      this.after(i * 0.045, () => {
        const ctrl = hand.clone().lerp(to, 0.5).add(new THREE.Vector3(rnd(-0.6, 0.6), 1.2, 1))
        this.fly(hand.clone(), ctrl, to.clone(), 0.32, null, new THREE.Color().setHSL(i / 12, 1, 0.6), false)
      })
    await this.wait(0.62)
    const fresh: Piece[] = []
    let left = changes.length
    changes.forEach((ch, i) =>
      this.after(i * 0.08, () => {
        const old = this.byId.get(ch.fromId)
        // the old balloon puffs up and poofs into one of the group's kind
        const swap = () => {
          const at = new THREE.Vector3(cellX(colOf(ch.pos)), cellY(rowOf(ch.pos)), 0.35)
          const c = new THREE.Color(SYMBOL_COLOR[ch.to.sym])
          this.rings.emit(at, c.clone().multiplyScalar(1.8), 0.25, 0.8, 0.35)
          this.sparks.burst(at, c, 10, 3.2, 0.18, 0.5)
          const p = this.acquire(ch.to.sym, ch.to.id)
          this.place(p, colOf(ch.pos), rowOf(ch.pos))
          p.squash = 1
          p.squashAmp = 1
          p.glowTo = 1
          fresh.push(p)
          onChange?.(i)
          left--
        }
        if (old) this.burst(old, 0.15, 0.35, swap, false)
        else swap()
      }),
    )
    await this.until(() => left <= 0)
    await this.wait(0.2)
    for (const p of [...group, ...fresh]) p.glowTo = 0
    this.updateBlocks()
  }

  /** winners come forward, puff up with a wobble and a happy face while the rest of the floor dims */
  async highlight(clusters: { sym: PaySym; ids: number[]; pos: number[] }[]) {
    this.dimTo = 1
    const hot = new Set<number>()
    for (const c of clusters) {
      for (const p of this.pieces(c.ids)) {
        p.winTo = 1
        p.frontTo = 1
        p.glowTo = 1
      }
      for (const pos of c.pos) {
        const t = this.tiles[pos]
        t.hotTo = t.liftTo = 1
        hot.add(pos)
        ;(this.hotAttr.array as Float32Array).set(new THREE.Color(SYMBOL_COLOR[c.sym]).toArray(), pos * 3)
      }
    }
    this.hotAttr.needsUpdate = true
    this.badges.forEach((b, pos) => {
      b.dim = hot.has(pos) ? 0 : 1
      b.zoomTo = hot.has(pos) ? 1.15 : 1
    })
    this.floorDirty = true
    await this.wait(0.35)
  }

  /**
   * Each multiplied cell sends a glowing orb from its badge to the screen point `to` (CSS pixels); `onOrb(k, mult)`
   * fires as the k-th one arrives. When hurried they all arrive at once.
   */
  async gather(c: { ids: number[]; pos: number[]; mults: number[] }, to: { x: number; y: number }, onOrb: (i: number, mult: number) => void) {
    const cells = c.pos.map((pos, i) => ({ pos, m: c.mults[i] })).filter((x) => x.m > 0)
    if (!cells.length) return
    if (this.hurried) {
      cells.forEach((x, k) => onOrb(k, x.m))
      return
    }
    const dest = this.screenToWorld(to.x, to.y, 1.2)
    const gap = Math.min(0.06, 0.45 / cells.length)
    const all: Promise<void>[] = []
    for (let k = 0; k < cells.length; k++) {
      const { pos, m } = cells[k]
      if (k) await this.wait(gap)
      if (this.hurried || this.disposed) {
        for (let j = k; j < cells.length; j++) onOrb(j, cells[j].m)
        break
      }
      const from = new THREE.Vector3(...this.badgeAt(pos))
      const ctrl = from.clone().lerp(dest, 0.5).add(new THREE.Vector3(rnd(-0.5, 0.5), 0.9, 0.6))
      const color = new THREE.Color(multColor(m))
      const orb = this.orbPool.pop() ?? this.makeOrb()
      orb.material.color.copy(color).multiplyScalar(1.8)
      orb.scale.setScalar(0.5)
      this.scene.add(orb)
      this.punch(pos)
      all.push(
        new Promise<void>((r) =>
          this.fly(from, ctrl, dest.clone(), 0.3, orb, color, true, () => {
            this.scene.remove(orb)
            this.orbPool.push(orb)
            this.sparks.burst(dest, color, 6, 2, 0.16, 0.35)
            onOrb(k, m)
            r()
          }),
        ),
      )
    }
    await Promise.all(all)
  }

  private makeOrb() {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }))
    s.renderOrder = 10
    this.own.push(s.material)
    return s
  }

  private fly(from: THREE.Vector3, ctrl: THREE.Vector3, to: THREE.Vector3, dur: number, obj: THREE.Object3D | null, color: THREE.Color, orb: boolean, done: () => void = () => {}) {
    if (this.disposed) done()
    else this.flights.push({ from, ctrl, to, t: 0, dur, obj, color, orb, done })
  }

  /** the push-in for a cluster worth ×50 or more: slow motion, a flash, and back */
  async superPop(ids: number[]) {
    this.pushAt.copy(this.centroid(this.pieces(ids)))
    this.pushTo = 1
    this.slowmo = 0.5
    this.startAct('gasp')
    await this.wait(0.175)
    this.slowmo = 1
    this.flash('#ffffff', 0.6)
    this.pushTo = 0
    await this.wait(0.25)
  }

  /**
   * Every cluster pops at once, each rippling out from its first cell: balloons over-inflate and burst into latex
   * shreds. `onPop(i)` fires per balloon in the order they burst.
   */
  async pop(clusters: number[][], onPop: (i: number) => void) {
    let k = 0
    let end = 0
    for (const ids of clusters) {
      const ps = this.pieces(ids)
      if (!ps.length) continue
      const gap = Math.min(0.03, 0.3 / ps.length)
      ps.forEach((p, j) =>
        this.after(j * gap, () =>
          this.burst(p, 0.05, 0.3, () => {
            this.tiles[p.col * ROWS + p.row].hotTo = 0
            onPop(k++)
          }),
        ),
      )
      end = Math.max(end, (ps.length - 1) * gap + 0.05)
      this.popCard(this.centroid(ps).setZ(0.9))
    }
    await this.wait(end + 0.1)
  }

  /** over-inflates a piece for `dur`, then bursts it (with shreds, sparks and its own extras when `shatter`) and releases it */
  private burst(p: Piece, dur: number, amount: number, then: () => void, shatter = true) {
    if (this.byId.get(p.id) === p) this.byId.delete(p.id)
    p.state = 'popping'
    p.t = 0
    p.wait = 0
    p.popDur = dur
    p.inflate = amount
    p.onBurst = () => {
      if (shatter) this.shatter(p)
      this.release(p)
      then()
    }
  }

  private shatter(p: Piece) {
    const at = this.worldOf(p)
    const c = new THREE.Color(SYMBOL_COLOR[p.sym])
    this.sparks.emit(at.x, at.y, at.z + 0.3, 0, 0, 0, WHITE_HOT, 0.3, 0.08, 0, 0, 0.5)
    this.rings.emit(at.clone().setZ(at.z + 0.25), c.clone().multiplyScalar(1.5), 0.2, 0.62, 0.22)
    this.sparks.burst(at, c, 6, 4.5, 0.11, 0.4)
    const spray = (n: number, color: THREE.Color, speed: number, grav: number, scale: number, life = 1) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU
        const s = speed * rnd(0.4, 1)
        this.shreds.emit(at, new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + speed * 0.3, rnd(0.5, 3)), color, scale * rnd(0.7, 1.3), life * rnd(0.7, 1.1), grav, rnd(6, 16))
      }
    }
    spray(8, c, 5, -14, 1.9)
    const white = new THREE.Color('#ffffff')
    switch (p.sym) {
      case 'poodle':
        spray(6, white, 3, -6, 1.2)
        break
      case 'giraffe':
        spray(6, new THREE.Color('#ff8a1c'), 4, -10, 1.1)
        break
      case 'bunny':
        spray(4, white, 3, -6, 1.2)
        break
      case 'octo': {
        const hat = buildOctoHat()
        hat.position.add(at)
        this.scene.add(hat)
        this.hats.push({ obj: hat, v: new THREE.Vector3(rnd(-1.5, 1.5), rnd(3.5, 5), 2), spin: rnd(-12, 12), t: 0.8 })
        break
      }
      case 'heart':
        spray(8, new THREE.Color('#ffb3c0'), 1.6, -3, 0.9, 1.6)
        break
      case 'star':
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + rnd(-0.3, 0.3)
          this.sparks.emit(at.x, at.y, at.z + 0.3, Math.cos(a) * 3.5, Math.sin(a) * 3.5 + 1, rnd(0, 2), new THREE.Color('#d8ff8a').multiplyScalar(2.4), 0.42, 0.6, -4, 1.5)
        }
        break
    }
  }

  /** a POP! card at a cluster */
  private popCard(at: THREE.Vector3) {
    const card = this.cards.find((c) => c.t >= 1) ?? this.cards[0]
    card.t = 0
    card.sprite.position.copy(at)
    card.sprite.material.rotation = rnd(-0.25, 0.25)
    card.sprite.visible = true
  }

  /** survivors float up to their new rows while new balloons rise in below them */
  async float(next: Grid) {
    const batch: Batch = { n: 0 }
    const keep = new Set<Piece>()
    let fresh = 0
    next.forEach((col, c) => {
      const n = col.filter((cell) => !this.byId.has(cell.id)).length
      col.forEach((cell, r) => {
        let p = this.byId.get(cell.id)
        if (p) {
          keep.add(p)
          if (p.row !== r) this.send(p, r, p.y, SHIFT, 0, 'float', batch)
          return
        }
        p = this.acquire(cell.sym, cell.id)
        keep.add(p)
        p.col = c
        this.send(p, r, cellY(r) - n - 0.4, REFILL, (r - (ROWS - n)) * 0.03, 'float', batch)
        p.root.position.set(cellX(c), p.y, 0)
        if (cell.sym === 'disco') p.onArrive = () => this.discoLanded(p!)
        fresh++
      })
    })
    // anything still standing that the new grid does not have (it should have popped)
    for (const p of [...this.live]) if (!keep.has(p) && p.state === 'idle') this.release(p)
    if (fresh) {
      this.stripFlare = 1
      this.onRefill?.()
    }
    await this.until(() => batch.n <= 0)
    this.updateBlocks()
  }

  /**
   * Pin Drop!: DJ Bop pulls pins from behind his ear and throws one at the first balloon; the rest pop one after
   * another, each zapped from the last. About 0.55 + 0.05·n + 0.2 s.
   */
  async pin(sym: PaySym, ids: number[], onPop?: (i: number) => void) {
    const ps = this.pieces(ids)
    for (const p of ps) p.glowTo = 1
    this.startAct('pins')
    await this.wait(0.25)
    if (!ps.length) return
    const from = this.handWorld(0).add(new THREE.Vector3(0, 0.15, 0))
    const to = this.worldOf(ps[0]).setZ(0.4)
    this.dj.pins.visible = false
    this.thrown.visible = true
    await new Promise<void>((r) => this.fly(from, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 1.4, 0.8)), to, 0.3, this.thrown, new THREE.Color(SYMBOL_COLOR[sym]), false, r))
    this.thrown.visible = false
    const c = new THREE.Color(SYMBOL_COLOR[sym])
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      if (i) {
        const a = this.worldOf(ps[i - 1]).setZ(0.4)
        const b = this.worldOf(p).setZ(0.4)
        for (let j = 0; j <= 8; j++) {
          const q = a.clone().lerp(b, j / 8)
          this.sparks.emit(q.x + rnd(-0.05, 0.05), q.y + rnd(-0.05, 0.05), q.z, 0, 0, 0, j % 2 ? WHITE_HOT : c.clone().multiplyScalar(2.2), rnd(0.14, 0.22), rnd(0.15, 0.3))
        }
        await this.wait(0.05)
      }
      this.burst(p, 0.03, 0.25, () => onPop?.(i))
      if (i === 0) this.popCard(this.worldOf(p).setZ(0.9))
    }
    await this.wait(0.2)
  }

  /** the disco balls rise and spin while light beams sweep the room: a trigger, or a shorter retrigger */
  async discos(ids: number[], kind: 'trigger' | 'retrigger') {
    const ps = this.pieces(ids)
    const sweep = kind === 'trigger' ? 0.6 : 0.3
    const hold = kind === 'trigger' ? 0.4 : 0.2
    for (const p of ps) {
      p.liftTo = 1
      p.frontTo = 1
      p.flare = 1
    }
    const colors = ['#ff4fd8', '#2fd3ff', '#ffd23f', '#ffffff']
    for (let i = 0; i < 4; i++) {
      const p = ps[i % Math.max(1, ps.length)]
      const at = p ? this.worldOf(p).setZ(0.6) : new THREE.Vector3(0, 0, 0.6)
      const mat = this.coneMat.clone()
      mat.color.set(colors[i]).multiplyScalar(1.3)
      const mesh = new THREE.Mesh(this.coneGeo, mat)
      mesh.position.copy(at)
      mesh.scale.set(2.2, 9, 1)
      mesh.renderOrder = 7
      this.scene.add(mesh)
      const a0 = Math.PI + (i - 1.5) * 0.9
      this.cones.push({ mesh, mat, col: -1, on: 1, t: 0, life: sweep + hold * 0.5, a0, a1: a0 + (i % 2 ? 1.6 : -1.6) })
    }
    await this.wait(sweep + hold)
    for (const p of ps) {
      p.liftTo = 0
      p.frontTo = 0
    }
  }

  /** winners settle back and the floor brightens again */
  clearHighlight() {
    this.dimTo = 0
    for (const p of this.live) {
      p.winTo = 0
      p.frontTo = 0
      p.glowTo = 0
    }
    for (const t of this.tiles) t.hotTo = t.liftTo = 0
    for (const b of this.badges) {
      b.dim = 0
      b.zoomTo = 1
    }
    this.floorDirty = true
  }

  /* ---------------- Disco Night ---------------- */

  /** Lights out, the sun sets and the mirror ball drops in; or, off, the yard comes back. Resolves when done. */
  async setFree(on: boolean) {
    if (on) {
      this.blackTo = 0.85
      await this.wait(0.4)
      // the feature starts on a fresh floor, switched in while the lights are out
      this.darken(0)
      this.freeTo = 1
      this.glasses(true)
      this.beatOn = true
      this.beatClock = 0
      this.beatHalf = -1
      this.mirror.visible = true
      this.blackTo = 0
      await this.until(() => this.free >= 1 && this.mirrorK >= 1)
    } else {
      this.beatOn = false
      this.freeTo = 0
      await this.until(() => this.free <= 0 && this.mirrorK <= 0)
    }
  }

  private glasses(star: boolean) {
    this.dj.glasses.getObjectByName('heart')!.visible = !star
    this.dj.glasses.getObjectByName('star')!.visible = star
  }

  /* ---------------- DJ Bop ---------------- */

  /** a gesture from DJ Bop; fire and forget */
  host(action: HostAction) {
    this.startAct(action)
  }

  private startAct(kind: Act) {
    // the shades lift on their own, so they can go with whatever the arms are doing
    if (kind === 'shades') {
      this.shadesT = 0
      return
    }
    this.act = { kind, t: 0, dur: ACT_DUR[kind] }
    this.dj.pump.visible = kind === 'pump'
    this.dj.pins.visible = false
    if (kind === 'slap') this.slapAt = this.time + 0.07
    if (kind === 'scratch') this.scratch = 1
  }

  /** points at a spot for a moment */
  private pointAt(at: THREE.Vector3) {
    this.point = { at: at.clone(), t: 0.8 }
  }

  /** where a mitt is in the world (0 left, 1 right) */
  private handWorld(side: number) {
    const arm = side ? this.dj.armR : this.dj.armL
    arm.updateWorldMatrix(true, false)
    return MITT[side].clone().sub(arm.position).applyMatrix4(arm.matrixWorld)
  }

  private poseHost(dt: number, real: number) {
    const dj = this.dj
    const P = pose()
    const aim = (side: number, d: THREE.Vector3, w: number) => {
      P.arm[side].copy(d)
      P.reach[side] = w
    }
    const a = this.act
    if (a) {
      a.t += dt
      const u = Math.min(1, a.t / a.dur)
      const e = env(u, 0.18, 0.25)
      switch (a.kind) {
        case 'slap':
          // up, then a smack on the right deck
          aim(1, u < 0.5 ? ARMS.lift : ARMS.slam, env(u, 0.3, 0.2))
          break
        case 'scratch':
          aim(1, ARMS.deck.clone().add(new THREE.Vector3(0.18 * Math.sin(a.t * TAU * 6), 0, 0.12 * Math.cos(a.t * TAU * 6))).normalize(), e)
          break
        case 'cheer':
          aim(0, ARMS.up[0], e)
          aim(1, ARMS.up[1], e)
          P.open = e
          P.hop = 0.06 * Math.sin(Math.PI * u)
          break
        case 'jump':
          aim(0, ARMS.up[0], e)
          aim(1, ARMS.up[1], e)
          P.hop = 0.12 * Math.sin(Math.PI * u)
          P.open = e
          break
        case 'yawn':
          aim(0, ARMS.wide[0], e)
          aim(1, ARMS.wide[1], e)
          P.open = env(u, 0.25, 0.3)
          P.nod = -0.28 * e
          P.lean = 0.05 * Math.sin(u * Math.PI)
          break
        case 'cross':
          // fingers crossed, hugging himself and fidgeting
          aim(0, ARMS.hug[0], e)
          aim(1, ARMS.hug[1], e)
          P.tilt = 0.07 * Math.sin(a.t * 11) * e
          P.nod = 0.12 * e
          break
        case 'gasp':
          aim(0, ARMS.cheeks[0], e)
          aim(1, ARMS.cheeks[1], e)
          P.open = e
          P.nod = -0.12 * e
          break
        case 'fist':
          // two pumps of the right fist
          aim(1, ARMS.fist.clone().lerp(ARMS.punch, 0.5 - 0.5 * Math.cos(u * TAU * 2)).normalize(), e)
          P.open = e
          P.hop = 0.04 * Math.abs(Math.sin(u * TAU))
          break
        case 'pump': {
          const k = 0.5 - 0.5 * Math.cos((a.t / 0.18) * TAU)
          aim(1, ARMS.pumpUp.clone().lerp(ARMS.pumpDown, k).normalize(), env(u, 0.1, 0.15))
          P.hop = 0.03 * k
          dj.pump.scale.set(PROP, PROP * (1 - 0.18 * k), PROP)
          break
        }
        case 'pins':
          // reach behind the ear for the pins, then throw
          aim(0, u < 0.55 ? ARMS.ear : ARMS.throw, env(u, 0.25, 0.2))
          dj.pins.visible = u > 0.3 && u < 0.6
          break
        case 'blow':
          aim(0, ARMS.hold[0], e)
          aim(1, ARMS.hold[1], e)
          break
      }
      if (a.t >= a.dur) {
        this.act = null
        dj.pump.visible = false
        dj.pins.visible = false
      }
    }

    if (this.shadesT >= 0) {
      this.shadesT += dt
      P.shades = env(this.shadesT / ACT_DUR.shades, 0.15, 0.2)
      if (this.shadesT >= ACT_DUR.shades) this.shadesT = -1
    }

    // held tease: one mitt to his cheek and the mouth open, the other finger hovering over the held column
    const tz = this.tease
    if (tz > 0.01 && P.reach[0] < tz) {
      aim(0, ARMS.cheeks[0], tz)
      P.open = Math.max(P.open, tz)
    }

    // nodding along: 100 BPM by day, on the beat with a shoulder sway at night
    if (this.beatOn) {
      const b = this.beatClock / 0.5
      P.nod += 0.08 * (0.5 + 0.5 * Math.cos(TAU * b))
      P.lean += 0.07 * Math.sin(Math.PI * b) * this.free
    } else P.nod += 0.08 * (0.5 + 0.5 * Math.cos(TAU * this.clock * (100 / 60)))

    // ease everything a little so gestures blend into each other
    const k = Math.min(1, real * 22)
    const S = this.pose
    S.hop += (P.hop - S.hop) * k
    S.lean += (P.lean - S.lean) * k
    S.nod += (P.nod - S.nod) * k
    S.tilt += (P.tilt - S.tilt) * k
    S.shades += (P.shades - S.shades) * k
    S.open += (P.open - S.open) * Math.min(1, real * 30)

    const torso = restOf(dj.torso)
    dj.torso.position.y = torso.y + S.hop * dj.torso.scale.y
    dj.torso.rotation.z = S.lean
    const head = restOf(dj.head)
    dj.head.rotation.set(head.rx + S.nod, head.ry, head.rz + S.tilt)
    const gl = restOf(dj.glasses)
    dj.glasses.position.y = gl.y + 0.12 * S.shades
    dj.glasses.rotation.x = -0.4 * S.shades
    dj.mouth.open.visible = S.open > 0.5
    dj.mouth.smile.visible = S.open <= 0.5

    // the arms swing from rest towards their aim; a point overrides one of them (the right one in a tease)
    if (this.point) this.point.t -= real
    const target = tz > 0.01 ? new THREE.Vector3(cellX(this.teaseCol), -1, 0.4) : this.point && this.point.t > 0 ? this.point.at : null
    this.pointW += ((target ? 1 : 0) - this.pointW) * Math.min(1, real * 10)
    const pointSide = tz > 0.01 ? 1 : target && target.x < 0 ? 0 : 1
    dj.torso.updateWorldMatrix(true, false)
    const q = new THREE.Quaternion()
    const id = new THREE.Quaternion()
    for (let side = 0; side < 2; side++) {
      const arm = side ? dj.armR : dj.armL
      q.copy(id)
      if (P.reach[side] > 0) q.slerp(new THREE.Quaternion().setFromUnitVectors(ARM_DIR[side], P.arm[side]), P.reach[side])
      if (target && side === pointSide && this.pointW > 0.01) {
        const to = dj.torso.worldToLocal(target.clone()).sub(arm.position).normalize()
        // a small circling hover, like a finger over the spot
        to.x += Math.sin(this.clock * 7) * 0.04
        to.y += Math.cos(this.clock * 7) * 0.04
        q.slerp(new THREE.Quaternion().setFromUnitVectors(ARM_DIR[side], to.normalize()), this.pointW * (1 - P.reach[side]))
      }
      arm.quaternion.slerp(q, Math.min(1, real * 24))
    }

    // the decks: platters spin (one follows a scratch), lights cycle, a slap jolts the deck
    this.scratch = Math.max(0, this.scratch - dt * 2)
    const spin = 3.5 * real
    dj.platters[0].rotation.y += spin
    dj.platters[1].rotation.y += this.scratch > 0 ? -Math.cos(this.time * TAU * 6) * 0.25 : spin
    if (this.slapAt > 0 && this.time >= this.slapAt) {
      this.slapAt = -1
      const at = this.handWorld(1)
      this.sparks.burst(at, new THREE.Color('#ffcc29'), 8, 2.4, 0.16, 0.35)
    }
    const c = new THREE.Color()
    for (let i = 0; i < 6; i++) {
      c.setHSL((this.clock * 0.15 + i / 6) % 1, 1, 0.55).multiplyScalar(1.2 + this.beat * 0.8 * this.free)
      dj.lights.setColorAt(i, c)
    }
    dj.lights.instanceColor!.needsUpdate = true

    // the Big Pop balloon: blown up in front of the booth, then it floats at the camera
    if (this.balloonT >= 0) {
      this.balloonT += dt
      const b = dj.balloon
      const t = this.balloonT
      if (t < 0.5) b.scale.setScalar(0.15 + 0.85 * ease(t / 0.5) + 0.04 * Math.sin(t * 30))
      else {
        const k = Math.min(1, (t - 0.5) / 0.45) ** 2
        const cam = this.camera.position
        b.position.copy(BALLOON).lerp(new THREE.Vector3(cam.x * 0.6, cam.y - 1.1, cam.z - 3.2), k)
        b.scale.setScalar(1 + 1.6 * k)
      }
      b.rotation.z = Math.sin(t * 9) * 0.1
    }
  }

  /**
   * The Big Pop: DJ Bop blows up a giant balloon that floats at the camera until it fills the view and bursts
   * (`onBurst`), showering shreds and confetti. Resolves 1.3 s after the start.
   */
  async bigPop(onBurst: () => void) {
    const b = this.dj.balloon
    const rest = { p: b.position.clone(), s: b.scale.x }
    this.scene.add(b)
    b.position.copy(BALLOON)
    b.scale.setScalar(0.15)
    b.visible = true
    this.startAct('blow')
    this.balloonT = 0
    this.archBounce = 1
    await this.wait(0.95)
    onBurst()
    const at = b.localToWorld(new THREE.Vector3(0, 0.5, 0))
    this.balloonT = -1
    b.visible = false
    this.dj.torso.add(b)
    b.position.copy(rest.p)
    b.rotation.set(0, 0, 0)
    b.scale.setScalar(rest.s)
    this.flash('#ffffff', 1)
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * TAU
      const s = rnd(2, 7)
      this.blasts.emit(at, new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, rnd(1, 7)), new THREE.Color(i % 3 ? '#ff4fb8' : '#ff9fdc'), rnd(2, 4.5), rnd(0.8, 1.3), -6, rnd(6, 14))
    }
    this.confettiBurst(120)
    this.shake = 0.6
    await this.wait(0.35)
  }

  /* ---------------- big moments ---------------- */

  /** a full-screen flash of colour */
  flash(color: string, strength = 1) {
    this.flashMat.uniforms.uColor.value.set(color)
    this.flashA = Math.max(this.flashA, strength)
  }

  /** gold coins rain down in front of the stage */
  coinShower(seconds = 2.5) {
    this.shower = Math.max(this.shower, seconds)
  }

  stopShower() {
    this.shower = 0
  }

  private viewHalf(z: number) {
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const depth = this.camera.position.z - z
    return { w: tan * depth * this.camera.aspect, h: tan * depth }
  }

  confettiBurst(n: number) {
    const pal = ['#ff4fb8', '#ffcc29', '#3fc4ff', '#9a6bff', '#29d8c4', '#49e06a', '#ff8a2a']
    for (let i = 0; i < n; i++) {
      const z = rnd(0.8, 2.5)
      const v = this.viewHalf(z)
      this.confetti.emit(new THREE.Vector3(rnd(-v.w, v.w), this.camY + v.h + rnd(0, 1.5), z), new THREE.Vector3(rnd(-1, 1), rnd(-3, -0.5), 0), new THREE.Color(pal[i % pal.length]), rnd(0.8, 1.4), rnd(2.5, 3.5), -3, rnd(4, 10))
    }
  }

  /** two confetti cannons fire up from the bottom corners */
  confettiCannons() {
    const pal = ['#ff4fb8', '#ffcc29', '#3fc4ff', '#9a6bff', '#29d8c4', '#ffffff']
    const z = 1.5
    const v = this.viewHalf(z)
    for (const s of [-1, 1]) {
      const at = new THREE.Vector3(s * (v.w - 0.3), this.camY - v.h + 0.2, z)
      this.sparks.emit(at.x, at.y, at.z, 0, 0, 0, new THREE.Color('#fff2c0').multiplyScalar(2), 2, 0.25, 0, 0, 1)
      for (let i = 0; i < 70; i++)
        this.confetti.emit(at, new THREE.Vector3(-s * rnd(1, 4.5), rnd(7, 12), rnd(-1, 1)), new THREE.Color(pal[i % pal.length]), rnd(0.8, 1.4), rnd(2.4, 3.2), -7, rnd(5, 12))
    }
    this.archBounce = 1
  }

  /** rockets burst over the yard; DJ Bop jumps and flings records */
  fireworks(rockets: number) {
    const pal = ['#ff4fd8', '#2fd3ff', '#ffe23d', '#6dff5a', '#ff9a2e', '#ffffff']
    for (let i = 0; i < rockets; i++) {
      const z = rnd(-1.5, 1)
      const v = this.viewHalf(z)
      this.rockets.push({ x: rnd(-v.w * 0.85, v.w * 0.85), y: this.camY - v.h - 0.3, z, vy: rnd(12, 15), top: this.camY + rnd(-0.2, 0.75) * v.h, wait: i * rnd(0.12, 0.22), color: new THREE.Color(pal[i % pal.length]) })
    }
    this.startAct('jump')
    this.archBounce = 1
    for (let side = 0; side < 2; side++) {
      const at = this.handWorld(side)
      this.records.emit(at, new THREE.Vector3((side ? 1 : -1) * rnd(1.5, 3), rnd(4, 6), rnd(-6, -3)), new THREE.Color(1, 1, 1), rnd(1.6, 2.2), 1.6, -7, rnd(8, 14))
    }
  }

  /* ---------------- coordinates ---------------- */

  private project(v: THREE.Vector3) {
    const q = v.clone().project(this.camera)
    return { x: ((q.x + 1) / 2) * this.w, y: ((1 - q.y) / 2) * this.h }
  }

  private screenToWorld(x: number, y: number, z: number) {
    const ndc = new THREE.Vector3((x / this.w) * 2 - 1, -((y / this.h) * 2 - 1), 0.5).unproject(this.camera)
    const dir = ndc.sub(this.camera.position).normalize()
    return this.camera.position.clone().addScaledVector(dir, (z - this.camera.position.z) / dir.z)
  }

  /** the average screen position of some balloons, in CSS pixels */
  screenOf(ids: number[]) {
    const ps = this.pieces(ids)
    if (!ps.length) return null
    const c = new THREE.Vector3()
    for (const p of ps) c.add(new THREE.Vector3(cellX(p.col), p.ty, 0))
    return this.project(c.divideScalar(ps.length).setZ(0.5))
  }

  /** a cell's centre on screen, in CSS pixels */
  cellScreen(pos: number) {
    return this.project(new THREE.Vector3(cellX(colOf(pos)), cellY(rowOf(pos)), 0))
  }

  /** the floor (the window inside the arch) on screen, so the overlay can keep clear of it */
  floorRect() {
    const a = this.project(new THREE.Vector3(-IN_W, IN_H, 0))
    const b = this.project(new THREE.Vector3(IN_W, -IN_H, 0))
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  /** the outside of the balloon arch on screen, for laying out the overlay */
  frameRect() {
    const a = this.project(new THREE.Vector3(-IN_W - RIM - 0.07, IN_H + RIM + 0.07, 0))
    const b = this.project(new THREE.Vector3(IN_W + RIM + 0.07, -IN_H - RIM - 0.07, 0))
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  /* ---------------- frame loop ---------------- */

  private busy() {
    return (
      this.timers.length > 0 ||
      this.conds.length > 0 ||
      this.flights.length > 0 ||
      this.hats.length > 0 ||
      this.cones.length > 0 ||
      this.rockets.length > 0 ||
      this.sparks.list.length > 0 ||
      this.shreds.list.length > 0 ||
      this.blasts.list.length > 0 ||
      this.records.list.length > 0 ||
      this.coins.list.length > 0 ||
      this.confetti.list.length > 0 ||
      this.rings.active ||
      this.act !== null ||
      this.shadesT >= 0 ||
      this.fountain !== null ||
      this.beatOn ||
      this.shower > 0 ||
      this.shake > 0 ||
      this.flashA > 0 ||
      this.free !== this.freeTo ||
      Math.abs(this.black - this.blackTo) > 0.002 ||
      Math.abs(this.dim - this.dimTo) > 0.002 ||
      Math.abs(this.push - this.pushTo) > 0.002 ||
      this.moving()
    )
  }

  private moving() {
    for (const p of this.live) if (p.state !== 'idle' || p.win > 0.01) return true
    return false
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // idle balloons only bob and blink; 30 frames a second is plenty for that
    if (!this.busy() && this.acc < 1 / 31) {
      this.drewLast = false
      return
    }
    const real = Math.min(0.05, this.acc)
    this.acc = 0
    const dt = real * this.speed
    this.time += dt
    this.clock += real
    this.frame++
    this.update(dt, real)
    // slow device: draw fewer pixels rather than drop frames
    if (this.quality.frame(now, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.resize(this.w, this.h)
    }
    this.drewLast = true
    this.composer.render()
  }

  private update(dt: number, real: number) {
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time)
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.time)
        for (const t of due) t.fn()
      }
    }

    this.updateMood(dt, real)

    // camera: drifts towards the mouse, shakes on big hits, pushes in for a super pop
    this.shake = Math.max(0, this.shake - real * 2.2)
    this.look.lerp(this.pointer, Math.min(1, real * 3))
    this.push = this.pushTo > this.push ? Math.min(this.pushTo, this.push + dt / 0.25) : Math.max(this.pushTo, this.push - dt / 0.3)
    this.placeCamera()

    const T = this.clock
    if (T > this.wiggleAt) {
      // now and then one balloon squeaks and wiggles
      this.wiggleAt = T + 3
      const idle = [...this.live].filter((p) => p.state === 'idle' && p.winTo === 0)
      const p = idle[Math.floor(Math.random() * idle.length)]
      if (p) p.wiggle = 1
    }
    this.tease += (this.teaseTo - this.tease) * Math.min(1, dt * 6)
    // how far each column's new floor has come up, for the old balloons above it to keep clear
    this.rising.fill(-Infinity)
    for (const p of this.live) if (p.state === 'rise') this.rising[p.col] = Math.max(this.rising[p.col], p.y - p.ty)
    for (const p of [...this.live]) this.animate(p, dt, real, T)

    this.updateFloor(dt)
    this.updateArch(real)
    this.poseHost(dt, real)
    this.updateFx(dt, real)

    if (this.conds.length) {
      const done = this.conds.filter((c) => c.test())
      if (done.length) {
        this.conds = this.conds.filter((c) => !done.includes(c))
        for (const c of done) c.fn()
      }
    }
  }

  private updateMood(dt: number, real: number) {
    // Disco Night fades in over 1.6 s; the mirror ball drops on a springy chain in 0.9 s
    this.free = this.freeTo > this.free ? Math.min(1, this.free + dt / 1.6) : Math.max(0, this.free - dt / 1.6)
    this.mirrorK = this.freeTo > 0 ? Math.min(1, this.mirrorK + dt / 0.9) : Math.max(0, this.mirrorK - dt / 1.6)
    if (this.freeTo === 0 && this.free < 0.5) this.glasses(false)
    const n = smooth(this.free)
    const k = this.mirrorK
    const drop = this.freeTo > 0 ? (k < 0.7 ? MIRROR_UP + (-0.1 - MIRROR_UP) * ease(k / 0.7) : -0.1 + 0.1 * smooth((k - 0.7) / 0.3)) : MIRROR_UP * (1 - smooth(k))
    this.mirror.position.y = MIRROR.y + drop
    this.mirror.visible = k > 0
    this.mirrorBall.rotation.y += real * 0.8

    // the beat: kicks on the beat and hats on the half beats, from the real clock
    if (this.beatOn) {
      this.beatClock += real
      const half = Math.floor(this.beatClock / 0.25)
      if (half > this.beatHalf) {
        this.beatHalf = half
        if (half % 2 === 0) this.beatAt = this.clock
        this.onBeat?.(half >> 1, half % 2 === 1)
      }
    }
    this.beat = Math.exp(-(this.clock - this.beatAt) * 7)
    const beat = this.beat * n

    this.black += Math.sign(this.blackTo - this.black) * Math.min(Math.abs(this.blackTo - this.black), dt * (this.blackTo > this.black ? 2.2 : 1.4))
    this.flashA = Math.max(0, this.flashA - real * 3)
    this.blackMat.uniforms.uA.value = this.black
    this.flashMat.uniforms.uA.value = this.flashA
    this.overlays[0].visible = this.black > 0.003
    this.overlays[1].visible = this.flashA > 0.003

    this.key.color.set('#fff4e0').lerp(new THREE.Color('#ffd0f0'), n)
    this.ambient.color.set('#d8e8ff').lerp(new THREE.Color('#b9a8ff'), n)
    this.ambient.intensity = 0.95 - 0.1 * n
    // while a cluster shows off the bloom eases off, so the winners in front of the dimmer stay crisp
    this.bloom.strength = (0.35 + 0.25 * n) * (1 - 0.6 * this.dim)
    // at night only the brightest lights bloom: dozens of lit tiles and the chrome arch would otherwise veil the floor
    this.bloom.threshold = 0.85 + 0.1 * n
    const u = this.backMat.uniforms
    u.uTime.value = this.clock
    u.uFree.value = n
    u.uBeat.value = beat
    if (n > 0) {
      const b = this.mirror.position.clone().project(this.camera)
      u.uBall.value.set(b.x * 0.5 * this.camera.aspect, b.y * 0.5)
    }
    this.bedMat.color.set('#150b2e').add(new THREE.Color(0.06, 0.02, 0.07).multiplyScalar(beat))
    this.lipMat.color.set('#ff7ad1').lerp(new THREE.Color().setHSL(((this.beatHalf >> 1) * 0.17) % 1, 1, 0.62), n).multiplyScalar(1.6 + 0.4 * beat)
    this.stripFlare = Math.max(0, this.stripFlare - dt * 2.5)
    const s = this.stripMat.uniforms
    s.uColor.value.set('#7ff3ff').lerp(new THREE.Color('#ff7ad1'), n).multiplyScalar(1.4 + 0.8 * this.stripFlare)
    s.uTime.value = this.clock
    const disco = discoMaterial().userData.uTime as { value: number }
    disco.value = this.clock

    // the dimmer: winners stand in front of it; held teases dim the floor a little
    this.dim += (this.dimTo - this.dim) * Math.min(1, dt * 10)
    if (Math.abs(this.dim - this.dimTo) < 0.002) this.dim = this.dimTo
    this.dimMat.opacity = Math.max(this.dim * 0.5, this.tease * 0.2)
    this.dimMesh.visible = this.dimMat.opacity > 0.004
    this.tileMat.uniforms.uDim.value = this.dim * 0.5
    this.badgeMat.uniforms.uDim.value = this.dim
    // the badges draw over everything, so they fade out before the Big Pop balloon floats over the floor; they are
    // back under the flash of its burst
    this.badgeMat.uniforms.uHide.value = this.balloonT < 0 ? 0 : clamp01((this.balloonT - 0.6) / 0.2)
  }

  private updateFloor(dt: number) {
    const t = this.tileMat.uniforms
    t.uTime.value = this.time
    t.uFree.value = smooth(this.free)
    t.uBeat.value = this.beat
    // hot, lifted and blocked tiles ease in and out
    const fx = this.fxAttr.array as Float32Array
    let fxDirty = false
    const k = Math.min(1, dt * 9)
    this.tiles.forEach((tile, pos) => {
      for (const [key, to, at] of [
        ['hot', 'hotTo', 0],
        ['block', 'blockTo', 1],
        ['lift', 'liftTo', 2],
      ] as const) {
        const d = tile[to] - tile[key]
        if (d === 0) continue
        tile[key] = Math.abs(d) < 0.01 ? tile[to] : tile[key] + d * k
        fx[pos * 4 + at] = tile[key]
        fxDirty = true
      }
    })
    if (fxDirty) this.fxAttr.needsUpdate = true

    // badges: only the ones animating get new matrices
    if (!this.floorDirty) return
    this.floorDirty = false
    const dims = this.badgeDim.array as Float32Array
    const slots = this.slotAttr.array as Float32Array
    let any = false
    this.badges.forEach((b, pos) => {
      if (dims[pos] !== b.dim) {
        dims[pos] = b.dim
        this.badgeDim.needsUpdate = true
      }
      if (b.slot >= 0) any = true
      if (b.zoom !== b.zoomTo) {
        b.zoom += (b.zoomTo - b.zoom) * Math.min(1, dt * 14)
        if (Math.abs(b.zoomTo - b.zoom) < 0.004) b.zoom = b.zoomTo
        else this.floorDirty = true
        if (!b.anim) this.placeBadge(pos, b.slot >= 0 ? 1 : 0)
      }
      if (!b.anim) return
      b.t += dt
      let s = 1
      let turn = 0
      if (b.anim === 'stamp') {
        const u = Math.min(1, b.t / 0.35)
        s = 1 + 0.6 * Math.exp(-u * 5) * Math.cos(u * 9)
      } else if (b.anim === 'flip') {
        const u = Math.min(1, b.t / 0.2)
        turn = u < 0.5 ? u * Math.PI : (u - 1) * Math.PI
        if (u >= 0.5 && b.slot !== b.next) {
          b.slot = b.next
          slots[pos] = b.slot
          this.slotAttr.needsUpdate = true
        }
        s = 1 + 0.2 * Math.sin(u * Math.PI)
      } else if (b.anim === 'drop') {
        const u = Math.min(1, b.t / 0.15)
        s = 1 - u
        if (u >= 1) {
          b.slot = b.next
          slots[pos] = b.slot
          this.slotAttr.needsUpdate = true
        }
      } else {
        s = 1 + 0.35 * Math.sin(Math.min(1, b.t / 0.25) * Math.PI)
      }
      const dur = b.anim === 'stamp' ? 0.35 : b.anim === 'punch' ? 0.25 : b.anim === 'flip' ? 0.2 : 0.15
      if (b.t >= dur) {
        b.anim = null
        s = b.slot >= 0 ? 1 : 0
        turn = 0
      } else this.floorDirty = true
      this.placeBadge(pos, s, turn)
    })
    this.badgeMesh.visible = any
  }

  /** a badge's matrix: `s` scales it about its middle (stamps and punches), `turn` spins it about y (flips) */
  private placeBadge(pos: number, s = 1, turn = 0) {
    const k = s * this.badgeSize(pos)
    this.badgeMesh.setMatrixAt(pos, new THREE.Matrix4().compose(new THREE.Vector3(...this.badgeAt(pos)), new THREE.Quaternion().setFromAxisAngle(Y, turn), new THREE.Vector3(k, k, 1)))
    this.badgeMesh.instanceMatrix.needsUpdate = true
  }

  private flushFloor() {
    this.tileAttr.needsUpdate = this.fxAttr.needsUpdate = this.hotAttr.needsUpdate = true
    this.floorDirty = true
  }

  private updateArch(real: number) {
    const T = this.clock
    const n = smooth(this.free)
    this.archBounce = Math.max(0, this.archBounce - real * 1.8)
    const ab = this.archBounce
    const bounce = 1 + 0.06 * ab * ab * Math.cos((1 - ab) * Math.PI * 3)
    this.archMesh.scale.setScalar(bounce)
    // the garland only needs every other frame on a slow device
    if (this.quality.q < 0.75 && this.frame % 2) return
    this.chase = (this.chase + real * (2 + this.combo)) % this.archLen
    const swell = 1 + 0.04 * this.beat * n
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const c = new THREE.Color()
    const at = new THREE.Vector3()
    const size = new THREE.Vector3()
    this.arch.forEach((b, i) => {
      q.setFromAxisAngle(Z, b.rot + Math.sin(T * b.w * 0.7 + b.ph) * 0.05)
      m.compose(at.set(b.x, b.y + Math.sin(T * b.w + b.ph) * 0.015, b.z), q, size.setScalar(b.r * swell))
      this.archMesh.setMatrixAt(i, m)
      c.copy(ARCH_DAY[b.color % ARCH_DAY.length]).lerp(ARCH_NIGHT[b.color % ARCH_NIGHT.length], n)
      if (this.combo > 0) {
        const behind = (this.chase - b.s + this.archLen) % this.archLen
        c.multiplyScalar(1 + 0.35 * Math.max(0, 1 - behind / 1.8) * Math.min(1, 0.5 + this.combo * 0.1))
      }
      this.archMesh.setColorAt(i, c)
    })
    this.archMesh.instanceMatrix.needsUpdate = true
    this.archMesh.instanceColor!.needsUpdate = true

    // now and then a balloon slips free of the arch and drifts up into the yard (not on a slow device)
    if (this.quality.q < 0.75) {
      for (const e of this.escapees) e.on = false
      this.escMesh.visible = false
      return
    }
    if (T > this.escapeAt) {
      this.escapeAt = T + rnd(15, 25)
      const e = this.escapees.find((x) => !x.on)
      if (e) {
        const s = Math.random() < 0.5 ? -1 : 1
        e.on = true
        e.p.set(s * (IN_W + 0.35), rnd(-2.5, 1.5), -0.35)
        e.v.set(s * rnd(0.12, 0.3), rnd(0.45, 0.6), rnd(0.15, 0.3))
        e.r = rnd(0.17, 0.22)
        e.ph = rnd(0, 6)
        e.color.set(ARCH[Math.floor(Math.random() * ARCH.length)])
      }
    }
    let k = 0
    for (const e of this.escapees) {
      if (!e.on) continue
      e.p.addScaledVector(e.v, real)
      if (e.p.y > this.camY + this.viewHalf(e.p.z).h + 1) {
        e.on = false
        continue
      }
      q.setFromAxisAngle(Z, Math.sin(T * 1.3 + e.ph) * 0.2)
      m.compose(at.set(e.p.x + Math.sin(T * 0.9 + e.ph) * 0.15, e.p.y, e.p.z), q, size.setScalar(e.r))
      this.escMesh.setMatrixAt(k, m)
      this.escMesh.setColorAt(k, c.copy(e.color).lerp(ARCH_NIGHT[k % ARCH_NIGHT.length], n))
      k++
    }
    this.escMesh.count = k
    this.escMesh.visible = k > 0
    this.escMesh.instanceMatrix.needsUpdate = true
    this.escMesh.instanceColor!.needsUpdate = true
  }

  private updateFx(dt: number, real: number) {
    // orbs, pins and spark streams in flight
    if (this.flights.length) {
      const pos = new THREE.Vector3()
      const prev = new THREE.Vector3()
      for (const f of this.flights) {
        const t0 = f.t
        f.t = Math.min(1, f.t + dt / f.dur)
        const at = (t: number, out: THREE.Vector3) => {
          const a = 1 - t
          return out.set(0, 0, 0).addScaledVector(f.from, a * a).addScaledVector(f.ctrl, 2 * a * t).addScaledVector(f.to, t * t)
        }
        at(f.t, pos)
        at(t0, prev)
        if (f.obj) {
          f.obj.position.copy(pos)
          if (f.orb) f.obj.scale.setScalar(0.5 * (1 - 0.35 * f.t))
          // the pin flies point first (its point is down its -y)
          else f.obj.rotation.z = Math.atan2(pos.y - prev.y, pos.x - prev.x) + Math.PI / 2
        }
        if (Math.random() < dt * 50) this.sparks.emit(pos.x, pos.y, pos.z, rnd(-0.3, 0.3), rnd(-0.3, 0.3), 0, f.color.clone().multiplyScalar(1.8), rnd(0.12, 0.24), rnd(0.25, 0.4), 0, 1)
      }
      const done = this.flights.filter((f) => f.t >= 1)
      this.flights = this.flights.filter((f) => f.t < 1)
      for (const f of done) f.done()
    }

    // octopus hats knocked flying
    if (this.hats.length) {
      for (const h of this.hats) {
        h.t -= dt
        h.v.y -= 12 * dt
        h.obj.position.addScaledVector(h.v, dt)
        h.obj.rotation.z += h.spin * dt
        h.obj.rotation.x += h.spin * 0.4 * dt
        if (h.t <= 0) this.scene.remove(h.obj)
      }
      this.hats = this.hats.filter((h) => h.t > 0)
    }

    // spotlights over held columns, and beams sweeping the room
    if (this.cones.length) {
      for (const k of this.cones) {
        k.t += dt
        if (k.col >= 0) {
          if (k.on < 1) k.on -= dt * 4
          k.mat.opacity = Math.max(0, Math.min(1, k.t * 5, k.on)) * (0.55 + 0.15 * Math.sin(this.clock * 9))
          k.mesh.rotation.z = Math.sin(this.clock * 4.5 + k.col) * 0.09
          if (k.t > 0 && Math.random() < dt * 25) this.sparks.emit(cellX(k.col) + rnd(-0.45, 0.45), rnd(-IN_H, IN_H), 0.4, 0, rnd(0.5, 1.5), 0, new THREE.Color('#ffe9b0').multiplyScalar(2), rnd(0.1, 0.2), rnd(0.4, 0.7))
        } else {
          const u = Math.min(1, k.t / k.life)
          k.mat.opacity = env(u, 0.2, 0.3) * 0.6
          k.mesh.rotation.z = k.a0 + (k.a1 - k.a0) * smooth(u)
          if (u >= 1) k.on = 0
        }
        if (k.on <= 0) {
          this.scene.remove(k.mesh)
          k.mat.dispose()
        }
      }
      this.cones = this.cones.filter((k) => k.on > 0)
    }

    // POP! cards
    for (const c of this.cards) {
      if (c.t >= 1) continue
      c.t = Math.min(1, c.t + dt / 0.4)
      const s = (0.6 + 0.5 * ease(c.t)) * 1.15
      c.sprite.scale.set(s, s, 1)
      c.sprite.material.opacity = c.t < 0.6 ? 1 : 1 - (c.t - 0.6) / 0.4
      c.sprite.visible = c.t < 1
    }

    // the ×128 fountain
    if (this.fountain) {
      const f = this.fountain
      f.t -= dt
      for (let i = Math.round(dt * 160 + Math.random() - 0.5); i > 0; i--) this.sparks.emit(f.at.x + rnd(-0.2, 0.2), f.at.y, f.at.z + 0.3, rnd(-1, 1), rnd(3, 6), rnd(0, 1), new THREE.Color().setHSL(Math.random(), 1, 0.6).multiplyScalar(2.4), rnd(0.14, 0.26), rnd(0.6, 1), -5, 0.5)
      if (f.t <= 0) this.fountain = null
    }

    // fireworks
    if (this.rockets.length) {
      for (const r of this.rockets) {
        if (r.wait > 0) {
          r.wait -= dt
          continue
        }
        r.y += r.vy * dt
        r.vy = Math.max(3, r.vy - 6 * dt)
        if (Math.random() < dt * 70) this.sparks.emit(r.x + rnd(-0.03, 0.03), r.y, r.z, rnd(-0.2, 0.2), -1, 0, new THREE.Color('#ffd9a0').multiplyScalar(2), rnd(0.12, 0.2), rnd(0.3, 0.5), -2)
        if (r.y >= r.top) {
          r.wait = -1
          const hot = r.color.clone().multiplyScalar(2.4)
          this.sparks.emit(r.x, r.y, r.z, 0, 0, 0, hot, 2.4, 0.3, 0, 0, 1)
          for (let i = 0; i < 70; i++) {
            const a = Math.random() * TAU
            const b = Math.acos(rnd(-1, 1))
            const s = rnd(2.5, 4.2)
            this.sparks.emit(r.x, r.y, r.z, Math.cos(a) * Math.sin(b) * s, Math.sin(a) * Math.sin(b) * s, Math.cos(b) * s * 0.5, i % 5 ? hot : WHITE_HOT, rnd(0.16, 0.26), rnd(0.9, 1.4), -2.2, 1.3)
          }
        }
      }
      this.rockets = this.rockets.filter((r) => r.wait !== -1)
    }

    // the mirror ball throws glints across the stage
    if (this.free > 0.5 && this.clock > this.glintAt) {
      this.glintAt = this.clock + 0.3
      const v = this.viewHalf(0)
      const c = new THREE.Color().setHSL(Math.random(), 0.8, 0.75).multiplyScalar(2)
      this.sparks.emit(rnd(-v.w, v.w), rnd(-IN_H, this.camY + v.h), rnd(-0.3, 0.8), 0, 0, 0, c, rnd(0.25, 0.45), rnd(0.25, 0.45), 0, 0, 0.6)
      const b = this.mirror.position
      this.sparks.emit(b.x + rnd(-0.5, 0.5), b.y + rnd(-0.5, 0.5), b.z + 0.7, 0, 0, 0, WHITE_HOT, rnd(0.2, 0.35), 0.25, 0, 0, 0.8)
    }

    // coin shower
    if (this.shower > 0) {
      this.shower -= real
      const n = Math.random() < (real * 80) % 1 ? Math.ceil(real * 80) : Math.floor(real * 80)
      for (let i = 0; i < n; i++) {
        const z = rnd(0.6, 3.2)
        const v = this.viewHalf(z)
        this.coins.emit(new THREE.Vector3(rnd(-v.w, v.w), this.camY + v.h + 0.4, z), new THREE.Vector3(rnd(-0.6, 0.6), rnd(-4, -1), 0), new THREE.Color(1, 1, 1), rnd(0.8, 1.2), 2.6, -7, rnd(5, 13))
      }
      if (this.onCoin && this.clock - this.coinAt > 0.11) {
        this.coinAt = this.clock
        this.onCoin()
      }
    }

    this.sparks.update(dt)
    this.sparks.points.visible = this.sparks.list.length > 0
    this.rings.update(dt)
    for (const [b, t] of [
      [this.shreds, dt],
      [this.blasts, dt],
      [this.records, dt],
      [this.coins, real],
      [this.confetti, real],
    ] as const) {
      b.update(t)
      b.mesh.visible = b.list.length > 0
    }
  }

  private animate(p: Piece, dt: number, real: number, T: number) {
    this.advance(p, dt)
    if (!this.live.has(p)) return
    const t = T + p.phase
    p.win += (p.winTo - p.win) * Math.min(1, dt * 12)
    if (p.win < 0.002 && p.winTo === 0) p.win = 0
    p.winT = p.winTo > 0 ? p.winT + dt : 0
    p.front += (p.frontTo - p.front) * Math.min(1, dt * 12)
    p.lift += (p.liftTo - p.lift) * Math.min(1, dt * 10)
    p.squash = Math.max(0, p.squash - dt * 2.5)
    p.wiggle = Math.max(0, p.wiggle - dt / 0.3)
    p.flare = Math.max(0, p.flare - dt * 1.6)
    const w = smooth(clamp01(p.win))
    const happy = p.win > 0.5
    if (p.joy) p.joy.visible = happy
    if (p.eyes) p.eyes.visible = !happy

    // where it is: bobbing on its row, rising, or drifting away
    let x = cellX(p.col)
    let y = p.y + Math.sin(t * p.bobW) * 0.025
    let z = p.front * Z_WIN
    if (p.state === 'leave') x += Math.sin(p.t * 5 + p.phase) * 0.1 * Math.min(1, p.t * 2.5)
    if (p.sym === 'round') y += Math.sin(t * 0.9 * TAU) * 0.02
    y += p.lift * 0.2

    // squash and stretch: the landing spring, the win wobble, the over-inflate before a burst
    const sq = p.squashAmp * p.squash * p.squash * Math.cos((1 - p.squash) * Math.PI * 2.5)
    const wob = p.winTo > 0 ? 0.07 * Math.exp(-p.winT * 4) * Math.sin(p.winT * 7 * TAU) : 0
    const puff = p.state === 'popping' ? 1 + p.inflate * ease(Math.min(1, p.t / p.popDur)) : 1
    const grow = (1 + 0.12 * w) * puff
    let sx = grow * (1 - wob) * (1 + 0.15 * sq)
    let sy = grow * (1 + wob) * (1 - 0.18 * sq)
    let rz = p.wiggle > 0 ? Math.sin((1 - p.wiggle) * Math.PI * 4) * 0.15 * p.wiggle : 0
    let ry = 0
    if (p.state === 'popping') rz += Math.sin(p.t * 90) * 0.06

    const P = p.parts
    switch (p.sym) {
      case 'poodle':
        P.wag.rotation.z = restOf(P.wag).rz + 0.244 * Math.sin(T * 3 * TAU + p.phase) * (1 + w)
        rz += 0.21 * w
        break
      case 'giraffe': {
        const neck = restOf(P.neck)
        P.neck.rotation.z = neck.rz + 0.04 * Math.sin(t * 0.4 * TAU) + 0.12 * Math.sin(p.winT * 16) * w
        P.neck.scale.y = 1 + 0.12 * w
        break
      }
      case 'bunny': {
        if (T > p.flopAt) {
          p.flopAt = T + rnd(3, 5)
          p.flop = 1
        }
        if (T > p.hopAt) {
          p.hopAt = T + 4 + rnd(-0.3, 0.3)
          p.hop = 1
        }
        p.flop = Math.max(0, p.flop - real * 2)
        p.hop = Math.max(0, p.hop - real * 3)
        y += 0.06 * Math.sin(Math.PI * (1 - p.hop)) * (p.hop > 0 ? 1 : 0) + 0.15 * Math.abs(Math.sin(p.winT * 7)) * w
        P.earR.rotation.z = restOf(P.earR).rz - 0.9 * Math.sin(Math.PI * (1 - p.flop)) * (p.flop > 0 ? 1 : 0) * (1 - w)
        break
      }
      case 'octo': {
        const s = Math.sin(t * 1.2 * TAU)
        P.tentL.rotation.z = restOf(P.tentL).rz + 0.12 * s
        P.tentR.rotation.z = restOf(P.tentR).rz - 0.12 * s
        rz += 0.04 * Math.sin(t * 1.2 * TAU + 1)
        ry = TAU * smooth(Math.min(1, p.winT / 0.5)) * (p.winTo > 0 ? 1 : 0)
        break
      }
      case 'heart': {
        rz += 0.105 * Math.sin(t * 0.5 * TAU)
        // a double heartbeat while it wins
        const b = (p.winT % 0.8) / 0.8
        const beat = Math.max(0, Math.sin(b * Math.PI * 5)) * (b < 0.4 ? 1 : 0)
        sx *= 1 + 0.12 * beat * w
        sy *= 1 + 0.12 * beat * w
        break
      }
      case 'star':
        ry = 0.436 * Math.sin(t * 0.6 * TAU) + TAU * smooth(Math.min(1, p.winT / 0.4)) * (p.winTo > 0 ? 1 : 0)
        break
      case 'round':
        sy *= 1 + 0.2 * w
        sx *= 1 - 0.06 * w
        break
      case 'disco': {
        // 0.6 rad/s, three times that in a tease, 6 rad/s when risen for a trigger
        P.ball.rotation.y += (0.6 * (1 + 2 * this.tease) + 5.4 * p.lift) * dt
        P.halo.scale.setScalar(1.1 * (1 + p.flare) + 0.08 * Math.sin(t * 2.4))
        if (T > p.glintAt && p.state === 'idle') {
          p.glintAt = T + 0.8
          const a = Math.random() * TAU
          this.sparks.emit(x + Math.cos(a) * 0.2, y + Math.sin(a) * 0.2, z + 0.3, 0, 0, 0, WHITE_HOT, rnd(0.18, 0.3), 0.3, 0, 0, 0.6)
        }
        // in front of the dimmer while a tease holds
        z = Math.max(z, this.tease * Z_WIN)
        break
      }
    }

    p.root.position.set(x, y, z)
    p.inner.rotation.set(0, ry, rz)
    p.inner.scale.set(sx, sy, grow)

    // the glow behind winners and pumped groups
    p.glowAmt += (p.glowTo - p.glowAmt) * Math.min(1, dt * 10)
    // soft enough that the lit tile under a winner doesn't wash out the winner itself
    const glow = p.glowAmt * (0.2 + 0.06 * Math.sin(T * 9))
    p.glow.material.opacity = glow
    p.glow.visible = glow > 0.01
    if (p.glow.visible) p.glow.scale.setScalar((1.3 + 0.2 * w) * CAST)
    if (w > 0.5 && Math.random() < dt * 8) {
      const c = new THREE.Color(SYMBOL_COLOR[p.sym]).multiplyScalar(2)
      this.sparks.emit(x + rnd(-0.4, 0.4), y + rnd(-0.4, 0.4), z + 0.5, rnd(-0.3, 0.3), rnd(0.3, 1.2), 0, c, rnd(0.1, 0.2), rnd(0.4, 0.7), 0, 1)
    }

    // blinking
    if (p.eyes && !happy) {
      if (T > p.blinkAt) {
        p.blink = 1
        p.blinkAt = T + rnd(2, 6)
      }
      p.blink = Math.max(0, p.blink - real / 0.12)
      p.eyes.scale.y = p.blink > 0 ? Math.max(0.08, Math.abs(p.blink * 2 - 1)) : 1
    }
  }

  /** moves a piece along its current move */
  private advance(p: Piece, dt: number) {
    if (p.state === 'idle') return
    if (p.state === 'leave') {
      // let go, the old balloons drift up faster and faster; the new floor rising underneath pushes them on
      if (p.wait > 0) p.wait -= dt
      else p.vy += 14 * dt
      const y = p.wait > 0 ? p.y : p.y + p.vy * dt
      const floor = cellY(p.row) + this.rising[p.col] + 7
      if (y < floor && dt > 0) {
        p.vy = Math.max(p.vy, (floor - p.y) / dt)
        p.y = floor
        p.wait = 0
      } else p.y = y
      p.t += dt
      if (p.y > IN_H + 1) this.release(p)
      return
    }
    if (p.wait > 0) {
      p.wait -= dt
      if (p.wait > 0) return
      dt = -p.wait
      p.wait = 0
    }
    const before = p.t
    p.t += dt
    if (p.state === 'popping') {
      if (p.t >= p.popDur) {
        const f = p.onBurst
        p.onBurst = null
        f?.()
      }
      return
    }
    const m = p.move
    if (p.t < m.rise) {
      p.y = p.y0 + (p.ty + m.over - p.y0) * ease(p.t / m.rise)
      return
    }
    if (before < m.rise) {
      p.squash = 1
      p.squashAmp = m.squash
      const f = p.onArrive
      p.onArrive = null
      f?.()
    }
    const u = (p.t - m.rise) / m.settle
    if (u >= 1) {
      p.y = p.ty
      p.state = 'idle'
      this.untrack(p)
    } else p.y = p.ty + m.over * (1 - u) ** 2 * Math.cos(TAU * m.bobs * u)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerleave', this.onLeave)
    for (const p of [...this.live]) this.release(p)
    for (const list of this.pool.values()) for (const p of list) p.glow.material.dispose()
    // let anything awaiting the scene finish, so the screen code can unwind
    for (const t of this.timers) if (!t.job) t.fn()
    for (const f of this.flights) f.done()
    for (const c of this.conds) c.fn()
    this.timers = []
    this.conds = []
    this.flights = []
    for (const k of this.cones) k.mat.dispose()
    for (const o of this.own) o.dispose()
    // the shared caches would otherwise keep this renderer alive after the game closes (see releaseModels)
    releaseModels()
    ringTexture().dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** a full-screen layer of one colour; `uA` is its strength */
function overlayMaterial(color: string, blending: THREE.Blending) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 0 } },
    vertexShader: SCREEN_VERT,
    fragmentShader: 'uniform vec3 uColor; uniform float uA; void main() { gl_FragColor = vec4(uColor, uA); }',
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending,
  })
}

/** a soft cone of light, narrow at the top */
function coneTexture() {
  const W = 64
  const H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const img = g.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1)
    const half = 0.05 + 0.45 * v
    for (let x = 0; x < W; x++) {
      const u = Math.abs(x / (W - 1) - 0.5) / half
      const a = Math.max(0, 1 - u * u) ** 1.5 * Math.min(1, v * 8) * (1 - 0.6 * v)
      img.data.set([255, 255, 255, Math.round(a * 255)], (y * W + x) * 4)
    }
  }
  g.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(c)
}

/** the 49 positions in a square spiral from the middle outwards */
function spiralOrder() {
  const out: number[] = []
  let c = 3
  let r = 3
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  let d = 0
  let len = 1
  out.push(c * ROWS + r)
  while (out.length < 49) {
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < len; i++) {
        c += dirs[d][0]
        r += dirs[d][1]
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) out.push(c * ROWS + r)
      }
      d = (d + 1) % 4
    }
    len++
  }
  return out
}

/** a point on a rounded rectangle's outline by distance clockwise from the top middle, and its length */
function rrPath(hw: number, hh: number, r: number) {
  const ex = hw - r
  const ey = hh - r
  const arc = (Math.PI / 2) * r
  const lens = [ex, arc, 2 * ey, arc, 2 * ex, arc, 2 * ey, arc, ex]
  const length = lens.reduce((a, b) => a + b, 0)
  const at = (s: number): [number, number] => {
    let i = 0
    while (i < lens.length - 1 && s > lens[i]) s -= lens[i++]
    const corner = (cx: number, cy: number, a0: number): [number, number] => [cx + Math.cos(a0 - s / r) * r, cy + Math.sin(a0 - s / r) * r]
    switch (i) {
      case 0:
        return [s, hh]
      case 1:
        return corner(ex, ey, Math.PI / 2)
      case 2:
        return [hw, ey - s]
      case 3:
        return corner(ex, -ey, 0)
      case 4:
        return [ex - s, -hh]
      case 5:
        return corner(-ex, -ey, -Math.PI / 2)
      case 6:
        return [-hw, -ey + s]
      case 7:
        return corner(-ex, ey, Math.PI)
      default:
        return [-ex + s, hh]
    }
  }
  return { length, at }
}

/** the arch: two staggered rows of balloons round the window, leaving the top middle to the booth */
function archLayout() {
  const balloons: ArchBalloon[] = []
  let length = 0
  ;[
    { off: 0.12, z: 0.06 },
    { off: 0.3, z: -0.08 },
  ].forEach((row, k) => {
    const path = rrPath(IN_W + row.off, IN_H + row.off, 0.44 + row.off)
    const n = Math.round(path.length / 0.29)
    const step = path.length / n
    if (k === 0) length = path.length
    for (let i = 0; i < n; i++) {
      const s = (i + k * 0.5) * step
      const [x, y] = path.at(s)
      if (y > IN_H && Math.abs(x) < 1.05) continue
      const bx = x + rnd(-0.025, 0.025)
      const br = rnd(0.13, 0.165)
      balloons.push({
        x0: bx,
        r0: br,
        x: bx,
        y: y + rnd(-0.03, 0.03),
        z: row.z + rnd(-0.03, 0.03),
        r: br,
        rot: rnd(-0.3, 0.3),
        s: (s / path.length) * length,
        color: i + k * 2,
        w: rnd(0.5, 0.8) * TAU,
        ph: rnd(0, TAU),
      })
    }
  })
  return { balloons, length }
}
