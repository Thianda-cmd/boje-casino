import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Bits, PacedQuality, Sparks, WHITE_HOT, glowTexture, ringTexture, rnd } from '../../lib/three/fx'
import { T, VKit, toonRamp, vkMaterial } from '../../lib/three/toon'
import { MAX_ROWS, REELS, waysOf, type Board, type Cell, type Sym, type WayWin } from './rules'
import { SYMBOL_COLOR } from './meta'
import {
  INK,
  allMaterials,
  buildBarrel,
  buildCannon,
  buildChest,
  buildCrate,
  buildDeck,
  buildFrame,
  buildGull,
  buildHelm,
  buildHost,
  buildLantern,
  buildMast,
  buildMedallion,
  buildRail,
  buildRopeCoil,
  buildStageMap,
  buildSymbol,
  coinGeometry,
  disposeTree,
  flapGull,
  goldMaterial,
  poseHost,
  poseSymbol,
  releaseModels,
  setLanternGlow,
  setUnroll,
  symbolMaterials,
  tickModels,
  warmUp,
  type ChestRig,
  type FrameRig,
  type HelmRig,
  type HostAction as RigAction,
  type HostRig,
  type MastRig,
  type MedallionRig,
} from './models'

/*
  The Plunder Bay stage: a pirate ship's deck at sunset on a rolling sea. Six reels sit in a carved wooden frame with
  rope and brass; every spin each reel lands 2 to 7 symbols, its cells stretching or squeezing to the new height as it
  lands, while the ways counter on the plaque rolls to the new count. Captain Polly perches on the plaque and runs the
  show; gulls wheel over the sea and the lanterns swing as the ship rolls. In Treasure Hunt the sun goes down, the
  moon comes up, the lanterns light and the gold multiplier medallion swings in beside the reels.
  Like the other slots, everything runs on the scene clock, so turbo, hurry and long cascades speed the whole show up;
  only the sea, the sky, the gulls and Polly's idle keep real time.

  For the screen. Every method that animates returns a promise on the scene clock; check that the screen is still
  mounted after each await, as Pop Party does (after dispose() every promise resolves at once and nothing animates).
  Times are at 1× with no turbo (turbo 1.75×, hurry() 3×); they hold the playback budget in tools/plunder-sim.ts.

  Setting up
  - new PlunderScene(el): el is the stage box (position: relative); the canvas fills it. await ready (onProgress
    reports 0..1 while it builds and compiles), then show(calmBoard(rand)). thumbs (data URLs of every Sym and 'host')
    are ready with it, for the paytable.
  - resize(w, h) on every size change (a ResizeObserver). The view fits the frame, its lanterns and Polly across and
    down; setHudRoom(px) (default 52) keeps that many CSS px under the frame for the screen's counters, and any
    height to spare goes there too. A cell at seven rows is 40 px tall on a 349 px wide phone stage (44 px wide), so
    a phone stage of about calc(100vw + 190px) leaves ~130 px under the frame; on a 1440 × 900 desktop (836 × 790)
    cells are 74 px wide and the medallion stands beside the frame.

  A spin (Spin from rules.ts)
  - drop(spin.steps[0].board, teaseReel(board, free ? RETRIGGER_MIN : SCATTER_MIN)): the old symbols drop out of the
    bottom, each reel's cells stretch or squeeze to its new height and the ways counter rolls to the new count reel by
    reel (onWays(ways) on each change), the new symbols drop in, bottom first: 1.25 s. Reels from teaseFrom on (a map
    short of the feature) are held, each 0.55 s longer than the last, under a gold light while Polly watches through
    her spyglass ("One more map…"). onLand(reel, syms) as each reel's last symbol lands; onMapLand(id) as each map
    comes to rest (it unrolls and Polly points at it), here and in cascade.
  - per winning step i (step.wins non-empty): highlight(step.wins) lights the winners reel by reel from the left, a
    comet running across each way, and brings them forward over the dimmed rest: about 0.45 s (Polly squawks, or
    cheers for 3+ symbols or a 5+ reel way; call host() after it to choose). Show the amounts (screenOf(win.ids)).
    In free spins stampMult(step.mult + 1, ids) next: a coin flies from the winners to the medallion, which stamps up
    and flips to the new number: 0.45 s. Then, unless the step capped the round (its drops are empty and nothing
    blasts), blast(ids, onBlast?) bursts every winner (ids = all of the step's win ids; onBlast(i) per symbol):
    0.35 s, and cascade(spin.steps[i + 1].board) lets the rest fall and drops the new symbols in: 0.5 s.
    setChain(k) speeds long cascades up (1..2), setCombo(i + 1) lights gold glints round the tiles from the third.
    clearHighlight() puts winners back (blast does it itself).
  - maps(spin.mapIds, 'trigger' | 'retrigger' | 'pay'): the maps flare with light rays and coins; Polly digs on a
    trigger ("X marks the spot!") or a capped scatter pay, cheers on a retrigger: 0.9 s (retrigger 0.6 s).
  - bigWin(ids): a push-in, slow motion and a flash for a huge step: 0.45 s.

  Treasure Hunt
  - setFree(true): the sun sets into the sea, the moon rises, the lanterns light (onLanterns) and the medallion swings
    in at ×1: 1.4 s. setFree(false): back to the sunset deck, the medallion away: 1.6 s. setMult(n) sets it at once.

  Captain Polly and the big moments
  - host(action, line?): 'squawk' | 'point' | 'cheer' | 'dig' | 'spyglass' | 'gasp', with a stock line in her speech
    bubble (line undefined), that line, or none (null). say(text, seconds = 1.8) is the bubble alone. On her own she
    breathes, sways with the ship, follows the action (a landing reel, a map, the winners), watches the gulls, and now
    and then squawks or scans the horizon when nothing is going on.
  - flash(color, strength), coinShower(seconds) (the chest on deck bursts open; onCoin for clinks) / stopShower(),
    confettiBurst(n), confettiCannons(), fireworks(n).
  - setTurbo(on); hurry() runs the rest of the round 3× and drops tease holds and coin flights; calm() after a round;
    wait(s) waits on the scene clock.

  Where things are, in CSS px of the stage box: screenOf(ids) (where those symbols come to rest), cellScreen(reel,
  row), windowRect() (the reels), frameRect() (the carved frame), plaqueRect() (the ways counter), hostRect()
  (Polly), medallionRect() (where the medallion stands in Treasure Hunt).

  dispose(): resolves everything still awaited and frees every GPU resource, the shared model caches included
  (releaseModels): the renderer holds no geometry, texture or program when it closes.
*/

export type HostAction = Exclude<RigAction, 'idle'>

/* ------------------------------------------------------------------ */
/*  Layout                                                              */
/* ------------------------------------------------------------------ */

/** the reel window: six reels 1 unit wide, 6.5 tall, so a 7-symbol reel has cells 1 × 0.93 */
const W = 6
const H = 6.5
const HALF_H = H / 2
const CW = W / REELS
/** the view fits FIT_W across (the frame and its swinging lanterns) and from the top of Polly's hat down to the
 *  frame's foot, plus the HUD room under it; on a 349 px phone stage that makes a cell 44 px wide, 40 px tall at
 *  seven rows (1440 × 900 desktop: 74 × 69 px) */
const FIT_W = 8
const FOV = 30
const CLIP = [new THREE.Plane(new THREE.Vector3(0, -1, 0), HALF_H - 0.004), new THREE.Plane(new THREE.Vector3(0, 1, 0), HALF_H - 0.004)]
/** Captain Polly is drawn this much bigger than modelled (1 unit tall): on a stage whose height sets the view, and a
 *  little bigger on a narrow one (a phone), where the width does and there is sky to spare */
const HOST_WIDE = 1.45
const HOST_NARROW = 1.62
/** room over Polly's hat (its feather, her hops and the hat jumping) */
const HAT_ROOM = 0.44
/** on a wide stage with room beside the frame Polly perches on the right lantern's iron arm instead, at its corner:
 *  her feet this high (the plaque and the name scroll then set the top of the view, and the reels grow) */
const SIDE_Y = 2.95
const SIDE_X = 3.62
/** the multiplier medallion's size on the frame's top left corner (a 1-unit coin) */
const MEDAL_WIDE = 1.32
const MEDAL_NARROW = 1.5
/** the big treasure map Polly unrolls over the reels when the maps start Treasure Hunt */
const BIG_MAP = 4.6
/** gaps between the cells' tiles */
const GAP = 0.07

/** the mast stands behind the frame on the right, its sail and crow's nest showing beside it on a wide stage */
const MAST = { x: 6.3, z: -4.3, h: 9.5 }

const Z_TILE = -0.43
const Z_DIM = 0.3
const Z_WIN = 0.62

/** gravity for falling symbols, units/s² (a reel's height in about 0.37 s) */
const G = 95
/** the stagger of reels landing, and each held reel's extra wait in a tease */
const REEL_GAP = 0.085
const TEASE = 0.55
const SWEEP = 0.055

const reelX = (r: number) => -W / 2 + (r + 0.5) * CW
const rowY = (row: number, h: number) => HALF_H - (row + 0.5) * (H / h)
/** the world size a symbol is drawn at on a reel of `h` rows: it fills the cell, and grows a little past the cell's
 *  width on tall cells (2 or 3 rows), so short reels read as big symbols */
function symbolSize(h: number) {
  const ch = H / h
  const tall = clamp01((ch / CW - 1) / 2)
  return Math.min(CW * 1.05 * (1 + 0.2 * tall), ch * 0.98)
}
/** how much taller than wide a symbol is drawn on a tall cell: up to 1.3× on a reel of two, a cartoon stretch that
 *  fills more of the panel */
const symbolStretch = (h: number) => 1 + 0.3 * clamp01((H / h / CW - 1.25) / 1.6)

const ease = (t: number) => 1 - (1 - t) ** 3
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
/** 0 → 1 → 0 across u = 0..1: in over the first `a`, out over the last `r` */
const env = (u: number, a = 0.2, r = 0.25) => (u <= 0 || u >= 1 ? 0 : smooth(Math.min(1, u / a, (1 - u) / r)))
const TAU = Math.PI * 2
const pick = <X>(a: readonly X[]) => a[Math.floor(Math.random() * a.length)]

const GOLD = new THREE.Color('#ffc63d')
const GLOW_OF: Record<Sym, string> = { ...SYMBOL_COLOR, flag: '#ffc63d', map: '#ffd36a' }
/** the backing colour of a tall cell under each symbol (linear rgb) */
const BACK_OF = Object.fromEntries(Object.entries(GLOW_OF).map(([s, c]) => [s, new THREE.Color(c).toArray()])) as Record<Sym, number[]>

/* ------------------------------------------------------------------ */
/*  Pieces                                                              */
/* ------------------------------------------------------------------ */

/** pieces moving together; the move is over when n reaches 0 */
interface Batch {
  n: number
}

interface Piece {
  sym: Sym
  id: number
  reel: number
  row: number
  root: THREE.Group
  inner: THREE.Group
  model: THREE.Group
  glow: THREE.Sprite
  /** world size (see symbolSize) */
  size: number
  y: number
  y0: number
  ty: number
  t: number
  wait: number
  dur: number
  vy: number
  state: 'idle' | 'fall' | 'settle' | 'leave' | 'blast'
  batch: Batch | null
  onArrive: (() => void) | null
  onBurst: (() => void) | null
  /** the landing squash, 1 → 0, and its strength */
  squash: number
  squashAmp: number
  /** the hop after landing */
  hop: number
  win: number
  winTo: number
  winT: number
  front: number
  frontTo: number
  glowAmt: number
  glowTo: number
  /** maps: lifted for a trigger, and how far unrolled */
  lift: number
  liftTo: number
  unroll: number
  unrollTo: number
  phase: number
  /** blast: how long it puffs up before it bursts */
  puff: number
}

/** a reel's height (rows) as it shows: eases from `from` to `to` when it changes */
interface Reel {
  h: number
  from: number
  to: number
  t: number
  /** gold shimmer of a reel held back in a tease */
  tease: number
  teaseTo: number
}

/** one reel of a drop in progress */
interface Plan {
  reel: number
  cells: Cell[]
  /** scene seconds after the drop started: the height change, and the new symbols starting to fall */
  morphAt: number
  dropAt: number
  held: boolean
  stage: 0 | 1 | 2
  left: number
}

/* ------------------------------------------------------------------ */
/*  Shaders                                                             */
/* ------------------------------------------------------------------ */

const TILE_VERT = /* glsl */ `
attribute vec2 aSize;
attribute vec4 aFx;
attribute vec3 aHot;
attribute vec4 aBack;
varying vec2 vP;
varying vec2 vS;
varying vec4 vFx;
varying vec3 vHot;
varying vec4 vBack;
varying float vY;
void main() {
  vP = position.xy * aSize;
  vS = aSize;
  vFx = aFx;
  vHot = aHot;
  vBack = aBack;
  vec4 w = modelMatrix * instanceMatrix * vec4(vP, 0.0, 1.0);
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

// aFx: hot (a winner sits on it), tease (gold shimmer up a held reel), flash, -
const TILE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHalfH;
uniform float uDim;
uniform float uNight;
uniform float uHeat;
varying vec2 vP;
varying vec2 vS;
varying vec4 vFx;
varying vec3 vHot;
varying vec4 vBack;
varying float vY;
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  if (abs(vY) > uHalfH) discard;
  float r = min(0.12, 0.2 * min(vS.x, vS.y));
  float d = sdBox(vP, vS * 0.5, r);
  float aa = fwidth(d);
  float inside = smoothstep(aa, -aa, d);
  if (inside < 0.01) discard;
  float e = -d;
  float v = clamp(vP.y / vS.y + 0.5, 0.0, 1.0);
  // a deep sea-blue panel, lighter at the top, purple at night
  vec3 top = mix(vec3(0.052, 0.125, 0.235), vec3(0.06, 0.07, 0.19), uNight);
  vec3 bot = mix(vec3(0.016, 0.05, 0.115), vec3(0.02, 0.022, 0.08), uNight);
  vec3 col = mix(bot, top, v);
  // a soft inner shade along the rim, a lit bevel on top and a dark lip on the very edge
  col *= 0.78 + 0.22 * smoothstep(0.0, 0.09, e);
  col += vec3(0.11, 0.19, 0.3) * smoothstep(0.022, 0.006, abs(e - 0.02)) * (0.25 + 0.75 * v) * (1.0 - 0.4 * uNight);
  col *= mix(0.45, 1.0, smoothstep(0.0, 0.012 + aa, e));
  // a tall cell (a short reel): a soft wash of the resting symbol's colour behind it, a glow round its middle and
  // a few faint rays, so the panel round a big symbol never reads as empty
  float bk = vBack.a;
  if (bk > 0.001) {
    vec2 q = vP / (vS * 0.5);
    float halo = exp(-dot(q * vec2(1.2, 0.85), q * vec2(1.2, 0.85)) * 1.5);
    float ang = atan(vP.y, vP.x);
    float ray = smoothstep(0.55, 1.0, sin(ang * 6.0 + uTime * 0.25)) * smoothstep(0.1, 0.6, length(q)) * (1.0 - smoothstep(0.7, 1.1, length(q * vec2(1.0, 0.7))));
    col = mix(col, col * 0.7 + vBack.rgb * 0.13, bk * 0.65);
    col += vBack.rgb * bk * (0.19 * halo + 0.045 * ray + 0.025 * v);
  }
  // long cascades: a gold glint runs round the rims
  float run = fract((vY + vP.x) * 0.35 - uTime * 0.9);
  col += vec3(1.0, 0.72, 0.28) * uHeat * smoothstep(0.03, 0.0, abs(e - 0.02)) * smoothstep(0.12, 0.0, abs(run - 0.5)) * 0.8;
  // a winner on it: its colour wells up from the rim and the panel lights
  float hot = vFx.x;
  col = mix(col, col * 0.75 + vHot * 0.16, hot);
  col += vHot * hot * (1.25 * exp(-e / 0.04) + 0.2 * exp(-e / 0.18) * (0.6 + 0.4 * v));
  // held in a tease: the panel darkens under gold light running up its rim, warmer towards the top
  float sh = 0.5 + 0.5 * sin(vY * 2.6 - uTime * 7.0);
  col *= 1.0 - 0.25 * vFx.y;
  col += vec3(1.0, 0.62, 0.16) * vFx.y * (0.55 * sh * exp(-e / 0.035) + 0.05 * v * v);
  col += vec3(0.32) * vFx.z;
  // winners' tiles shine through the dimmer in front of the reels
  col /= max(0.3, 1.0 - uDim * hot);
  gl_FragColor = vec4(col, inside);
}`

const SCREEN_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'

/* the sky and the sea, painted behind everything: a sunset over a rolling sea that becomes a moonlit night */
const BACK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFree;
uniform float uAspect;
uniform float uHorizon;
uniform float uRoll;
uniform float uSunX;
uniform float uMoonX;
uniform float uMoonY;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// an sRGB colour (0..255) as linear light
vec3 C(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// an island on the horizon with a palm tree: signed distance (negative inside)
float island(vec2 q, float x0, float w, float h, float lean) {
  float u = (q.x - x0) / w;
  float top = h * sqrt(max(0.0, 1.0 - u * u)) * (0.86 + 0.14 * sin(u * 6.0 + x0 * 9.0));
  float d = max(q.y - top, -q.y - 0.01);
  d = max(d, abs(u) - 1.0);
  vec2 base = vec2(x0 + w * 0.25, h * 0.75);
  vec2 crown = base + vec2(lean, h * 1.6);
  d = min(d, seg(q, base, mix(base, crown, 0.5) + vec2(lean * 0.25, 0.0)) - h * 0.07);
  d = min(d, seg(q, mix(base, crown, 0.5) + vec2(lean * 0.25, 0.0), crown) - h * 0.06);
  for (int i = 0; i < 5; i++) {
    float a = 0.35 + float(i) * 0.6;
    vec2 tip = crown + vec2(cos(a), sin(a) * 0.55 - 0.25) * h * 1.05 * vec2(1.0, 0.9);
    vec2 mid = mix(crown, tip, 0.5) + vec2(0.0, h * 0.18);
    d = min(d, seg(q, crown, mid) - h * 0.075);
    d = min(d, seg(q, mid, tip) - h * 0.05);
  }
  return d;
}
// a puffy cloud: distance, and how far up it the point is (0 bottom .. 1 top)
float cloud(vec2 q, vec2 c, float k) {
  vec2 p = (q - c) / k;
  float d = length(p - vec2(-0.55, 0.0)) - 0.42;
  d = min(d, length(p - vec2(0.0, 0.22)) - 0.55);
  d = min(d, length(p - vec2(0.55, 0.05)) - 0.45);
  d = min(d, length(p - vec2(1.05, -0.05)) - 0.3);
  d = min(d, length(p - vec2(-1.0, -0.08)) - 0.26);
  d = max(d, -(p.y + 0.3));
  return d * k;
}
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float t = uTime;
  float n = smoothstep(0.0, 1.0, uFree);
  // the ship rolls: the horizon tilts and heaves about the middle of the screen
  vec2 q = p - vec2(0.0, uHorizon);
  float cr = cos(uRoll);
  float sr = sin(uRoll);
  q = vec2(cr * q.x + sr * q.y, -sr * q.x + cr * q.y);
  vec3 ink = mix(C(58., 26., 64.), C(10., 10., 30.), n);
  vec3 col;
  float s = q.y;
  vec2 sun = vec2(uSunX, 0.04 - 0.16 * smoothstep(0.0, 0.6, uFree));
  vec2 moon = vec2(uMoonX, mix(-0.14, uMoonY, smoothstep(0.35, 1.0, uFree)));
  if (s >= 0.0) {
    // sky: gold at the horizon through coral and violet to a deep blue; by night ink blue
    vec3 day = mix(C(255., 196., 118.), C(255., 136., 122.), smoothstep(0.0, 0.09, s));
    day = mix(day, C(196., 110., 170.), smoothstep(0.07, 0.22, s));
    day = mix(day, C(92., 82., 168.), smoothstep(0.2, 0.46, s));
    day = mix(day, C(44., 50., 120.), smoothstep(0.42, 0.8, s));
    vec3 night = mix(C(36., 48., 104.), C(14., 18., 56.), smoothstep(0.0, 0.22, s));
    night = mix(night, C(6., 8., 28.), smoothstep(0.2, 0.7, s));
    col = mix(day, night, n);
    // the sun's glow and the sun itself, sinking into the sea when the hunt starts
    float sd = length(q - sun);
    col += C(255., 160., 90.) * exp(-sd * sd * 22.0) * 0.42 * (1.0 - n);
    col += C(255., 210., 140.) * exp(-sd * sd * 160.0) * 0.5 * (1.0 - n);
    float disc = smoothstep(0.081, 0.077, sd);
    vec3 sc = mix(C(255., 140., 60.), C(255., 238., 170.), smoothstep(-0.07, 0.06, q.y - sun.y));
    // three bands cut through its lower half
    float bands = step(0.0, sun.y - q.y) * step(0.5, fract((sun.y - q.y) * 42.0 + 0.2)) * smoothstep(0.0, 0.03, sun.y - q.y);
    col = mix(col, sc, disc * (1.0 - bands * 0.85) * (1.0 - n * 0.6));
    // stars come out
    vec2 g = floor((q + 3.0) * 70.0);
    float h1 = hash(g);
    vec2 f = fract((q + 3.0) * 70.0) - 0.5;
    float tw = 0.55 + 0.45 * sin(t * (1.3 + h1 * 3.0) + h1 * 40.0);
    col += step(0.982, h1) * tw * smoothstep(0.24, 0.0, length(f)) * smoothstep(0.03, 0.18, s) * n * C(255., 245., 220.) * 1.6;
    // the moon, rising
    float md = length(q - moon);
    col += C(170., 190., 255.) * exp(-md * md * 40.0) * 0.28 * n;
    vec3 mc = C(255., 246., 214.);
    mc *= 1.0 - 0.13 * smoothstep(0.018, 0.012, length(q - moon - vec2(-0.015, 0.012)));
    mc *= 1.0 - 0.1 * smoothstep(0.012, 0.008, length(q - moon - vec2(0.02, -0.014)));
    mc *= 1.0 - 0.08 * smoothstep(0.009, 0.006, length(q - moon - vec2(-0.004, -0.024)));
    col = mix(col, mc * 1.15, smoothstep(0.059, 0.055, md) * n);
    // a shooting star every few seconds at night
    float k = floor(t / 5.0);
    float u = fract(t / 5.0) * 5.0;
    vec2 a0 = vec2((hash(vec2(k, 1.0)) - 0.5) * uAspect * 0.9, 0.25 + 0.2 * hash(vec2(k, 2.0)));
    vec2 head = a0 + vec2(0.35, -0.12) * u;
    float trail = seg(q, head, head - vec2(0.12, -0.04));
    col += C(255., 240., 210.) * smoothstep(0.004, 0.0, trail) * step(u, 0.6) * (1.0 - u / 0.6) * n * 1.4;
    // clouds drifting, lit gold and pink from below; moonlit at night
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float span = uAspect + 0.8;
      vec2 c = vec2(mod(t * (0.006 + fi * 0.003) + fi * 0.29 * span, span) - span * 0.5, 0.14 + fi * 0.075 + 0.02 * sin(fi * 3.0));
      float kk = 0.04 + 0.012 * fi;
      float d = cloud(q, c, kk);
      float up = clamp((q.y - c.y) / (kk * 0.8) + 0.4, 0.0, 1.0);
      vec3 lit = mix(C(255., 196., 140.), C(214., 140., 190.), up);
      lit = mix(lit, mix(C(48., 56., 110.), C(28., 32., 74.), up), n);
      col = mix(col, ink, smoothstep(0.0016, -0.0004, d) * 0.55);
      col = mix(col, lit, smoothstep(-0.0012, -0.003, d));
    }
  } else {
    // the sea: violet near the horizon (the sky in it), deepening towards us
    float dd = -s;
    vec3 day = mix(C(150., 112., 168.), C(52., 98., 160.), smoothstep(0.0, 0.08, dd));
    day = mix(day, C(24., 64., 118.), smoothstep(0.07, 0.4, dd));
    vec3 night = mix(C(40., 52., 104.), C(14., 26., 64.), smoothstep(0.0, 0.08, dd));
    night = mix(night, C(6., 14., 40.), smoothstep(0.07, 0.4, dd));
    col = mix(day, night, n);
    col += C(255., 150., 110.) * exp(-dd * 34.0) * 0.32 * (1.0 - n);
    // the sea as a plane: z is how far off a point is
    float z = 1.0 / (dd + 0.015);
    vec2 sp = vec2(q.x * z, z);
    // wave dashes running along the swells, drifting towards us
    float row = sp.y * 0.9 + t * 0.35;
    float band = floor(row);
    float fy = fract(row);
    float sway = sin(sp.x * 0.25 + band * 1.7 + t * 0.8) * 0.6;
    float fx = fract(sp.x * 0.11 + hash(vec2(band, 3.0)) + sway * 0.05 + t * 0.02 * (hash(vec2(band, 5.0)) - 0.5));
    float dash = smoothstep(0.0, 0.04, fx) * smoothstep(0.34, 0.28, fx) * smoothstep(0.1, 0.0, abs(fy - 0.5) - 0.03);
    float fade = smoothstep(0.008, 0.06, dd);
    vec3 crest = mix(C(150., 200., 240.), C(110., 140., 220.), n);
    col = mix(col, crest, dash * fade * 0.55);
    // the long swells: darker troughs
    col *= 1.0 - 0.12 * smoothstep(0.3, 1.0, sin(sp.y * 0.45 + t * 0.9 + sin(sp.x * 0.08) * 1.5)) * fade;
    // the sun's (or the moon's) path of glitter on the water
    float gx = mix(uSunX, uMoonX, n);
    float wdt = 0.025 + dd * 0.55;
    float path = exp(-pow((q.x - gx) / wdt, 2.0));
    vec2 cell = floor(vec2(sp.x * 0.7, sp.y * 2.2 + t * 0.6));
    float h2 = hash(cell);
    float twk = step(0.72, h2) * (0.5 + 0.5 * sin(t * (4.0 + h2 * 6.0) + h2 * 30.0));
    vec2 fc = fract(vec2(sp.x * 0.7, sp.y * 2.2 + t * 0.6)) - 0.5;
    float spark = twk * smoothstep(0.35, 0.0, length(fc * vec2(1.0, 2.2)));
    col += mix(C(255., 214., 140.) * 1.4, C(220., 230., 255.) * 1.3, n) * path * (spark * 1.1 + 0.18) * fade * mix(1.0 - n * 0.4, 1.0, n);
    // glowing plankton at night
    vec2 pc = floor(sp * vec2(0.9, 1.6) + vec2(0.0, t * 0.2));
    float hp = hash(pc + 17.0);
    vec2 pf = fract(sp * vec2(0.9, 1.6) + vec2(0.0, t * 0.2)) - 0.5;
    col += C(90., 255., 220.) * step(0.93, hp) * (0.5 + 0.5 * sin(t * 2.0 + hp * 50.0)) * smoothstep(0.3, 0.0, length(pf)) * n * fade * 0.6;
  }
  // islands on the horizon and a distant ship sailing past
  float isl = min(island(q, -0.5 * uAspect, 0.1, 0.026, 0.012), island(q, 0.36 * uAspect, 0.08, 0.02, -0.01));
  float shipX = mod(t * 0.004 + 0.3, 1.4) - 0.7;
  vec2 sq = q - vec2(shipX * uAspect, 0.0);
  float ship = max(abs(sq.x) - 0.018 + sq.y * 0.6, abs(sq.y - 0.004) - 0.005);
  ship = min(ship, max(max(-sq.x - 0.002, sq.x - 0.011 + (sq.y - 0.01) * 0.3), max(sq.y - 0.034, 0.008 - sq.y)));
  ship = min(ship, max(max(sq.x + 0.012, -sq.x - 0.02 + (sq.y - 0.01) * 0.25), max(sq.y - 0.026, 0.008 - sq.y)));
  float sil = min(isl, ship);
  vec3 silC = mix(C(120., 74., 132.), C(12., 14., 38.), n);
  col = mix(col, silC, smoothstep(0.0012, -0.0006, sil));
  // a lantern on the distant ship at night
  col += C(255., 190., 100.) * exp(-pow(length(sq - vec2(0.0, 0.014)) / 0.004, 2.0)) * n * 1.5;
  // the horizon haze
  col += mix(C(255., 196., 140.), C(80., 100., 170.), n) * exp(-abs(s) * 90.0) * 0.18;
  col *= 1.0 - 0.3 * smoothstep(0.5, 1.05, length(p * vec2(0.62, 1.0)));
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
/*  Polly's speech bubble                                              */
/* ------------------------------------------------------------------ */

const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'
const BUBBLE_TEX_W = 1024
const BUBBLE_TEX_H = 384
/** the speech bubble stays this many CSS px inside the stage */
const BUBBLE_MARGIN = 8

/**
 * A comic speech bubble drawn on a canvas: cream, inked, with a tail at its bottom left (bottom right when flipped,
 * for a bubble to Polly's left). The canvas stays one size (a texture can't change size once uploaded) and each line
 * uses the part of it it needs, so the bubble is drawn at the screen's own resolution and its text stays crisp at any
 * size. It hangs in front of the camera and is placed in screen pixels every frame, so it never leaves the stage.
 */
class Bubble {
  readonly mesh: THREE.Mesh
  readonly texture: THREE.CanvasTexture
  readonly material: THREE.MeshBasicMaterial
  private readonly g: CanvasRenderingContext2D
  text = ''
  /** CSS size of the drawn bubble, tail included; the tail's tip is its bottom left corner (bottom right if flip) */
  cssW = 0
  cssH = 0
  flip = false
  /** seconds since it popped up, and how long it stays */
  t = 0
  life = 0
  on = false

  constructor() {
    const c = document.createElement('canvas')
    c.width = BUBBLE_TEX_W
    c.height = BUBBLE_TEX_H
    this.g = c.getContext('2d')!
    this.texture = new THREE.CanvasTexture(c)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material)
    this.mesh.renderOrder = 15
    this.mesh.visible = false
    this.mesh.frustumCulled = false
  }

  /** draws `text` at most `maxW` CSS px wide (wrapping onto a second line), `px` the font size, `dpr` the pixels per
   *  CSS px; `flip` puts the tail at the bottom right */
  draw(text: string, maxW: number, px: number, dpr: number, flip = false) {
    const g = this.g
    const k = Math.min(dpr, (BUBBLE_TEX_W - 8) / Math.max(60, maxW + 12), (BUBBLE_TEX_H - 8) / (px * 3.2 + 30))
    const padX = 11
    const padY = 7
    const tail = 11
    const lineH = px * 1.18
    g.font = `800 ${px * k}px ${FONT}`
    // words onto at most three lines
    const words = text.split(/\s+/)
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (cur && g.measureText(next).width / k > maxW - padX * 2) {
        lines.push(cur)
        cur = w
      } else cur = next
    }
    if (cur) lines.push(cur)
    lines.splice(3)
    const tw = Math.max(...lines.map((l) => g.measureText(l).width / k))
    const bw = Math.ceil(tw + padX * 2)
    const bh = Math.ceil(lines.length * lineH + padY * 2)
    this.cssW = bw + tail + 4
    this.cssH = bh + tail + 4
    const Wp = Math.ceil(this.cssW * k)
    const Hp = Math.ceil(this.cssH * k)
    g.clearRect(0, 0, BUBBLE_TEX_W, BUBBLE_TEX_H)
    g.save()
    g.scale(k, k)
    // the body sits up and to the right of the tail's tip (the canvas's bottom left); flipped, every x is mirrored
    const cw = this.cssW
    const X = (x: number) => (flip ? cw - x : x)
    const x0 = tail + 2
    const y0 = 2
    const r = Math.min(13, bh / 2)
    const tipX = 1.5
    const tipY = this.cssH - 1.5
    const path = () => {
      g.beginPath()
      g.moveTo(X(x0 + r), y0)
      g.lineTo(X(x0 + bw - r), y0)
      g.arcTo(X(x0 + bw), y0, X(x0 + bw), y0 + r, r)
      g.lineTo(X(x0 + bw), y0 + bh - r)
      g.arcTo(X(x0 + bw), y0 + bh, X(x0 + bw - r), y0 + bh, r)
      // the tail leaves the bottom edge and curls down to its tip, then back up to the near edge
      g.lineTo(X(x0 + Math.min(26, bw * 0.35)), y0 + bh)
      g.quadraticCurveTo(X(x0 + 4), y0 + bh + tail * 0.3, X(tipX), tipY)
      g.quadraticCurveTo(X(x0 + 1), y0 + bh - 1, X(x0), y0 + bh - Math.min(14, bh * 0.45))
      g.lineTo(X(x0), y0 + r)
      g.arcTo(X(x0), y0, X(x0 + r), y0, r)
      g.closePath()
    }
    this.flip = flip
    g.shadowColor = 'rgba(20, 6, 30, 0.35)'
    g.shadowBlur = 6
    g.shadowOffsetY = 2
    path()
    g.fillStyle = '#fff8ea'
    g.fill()
    g.shadowColor = 'transparent'
    g.lineJoin = 'round'
    g.lineWidth = 2.4
    g.strokeStyle = INK
    g.stroke()
    g.font = `800 ${px}px ${FONT}`
    g.textBaseline = 'middle'
    g.textAlign = 'center'
    g.fillStyle = '#2a1430'
    lines.forEach((l, i) => g.fillText(l, X(x0 + bw / 2), y0 + padY + lineH * (i + 0.5) + 0.5))
    g.restore()
    // only the drawn part of the canvas is mapped onto the plane
    this.texture.repeat.set(Wp / BUBBLE_TEX_W, Hp / BUBBLE_TEX_H)
    this.texture.offset.set(0, 1 - Hp / BUBBLE_TEX_H)
    this.texture.needsUpdate = true
    this.text = text
  }

  dispose() {
    this.texture.dispose()
    this.material.dispose()
    this.mesh.geometry.dispose()
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
  done: () => void
}

/** a light running across a way win, through the middle of its cells reel by reel */
interface Comet {
  pts: THREE.Vector3[]
  t: number
  dur: number
  color: THREE.Color
}

interface Gull {
  mesh: THREE.Mesh
  on: boolean
  x: number
  y: number
  z: number
  dir: number
  speed: number
  t: number
  ph: number
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

type Act = HostAction
const ACT_DUR: Record<Act, number> = { squawk: 0.85, point: 1.0, cheer: 1.4, dig: 1.6, spyglass: 2.0, gasp: 0.9 }
const LINES: Record<Act, readonly string[]> = {
  squawk: ['Squawk!', 'Arr!', 'Pieces of eight!', 'Squaaawk!'],
  point: ['Look there!', 'Land ho!', 'A map!'],
  cheer: ['Yo ho ho!', 'Shiver me timbers!', 'Treasure!', 'Rich as a king!'],
  dig: ['X marks the spot!', 'Dig, me hearties!', 'Treasure ahoy!'],
  spyglass: ['One more map…', 'I spy treasure…', 'Steady now…'],
  gasp: ['Blimey!', 'Great barnacles!', 'Sink me!'],
}
const IDLE_LINES = ['Squawk!', 'Arr!', 'Spin, matey!', 'Pieces of eight!', 'Yo ho!']

/** the wing Polly points with: the folded wing's direction from the shoulder, in her body's frame (see host.ts) */
const WING_REST = [Math.atan2(-1, -0.42), Math.atan2(-1, 0.42)]

/* ------------------------------------------------------------------ */
/*  The scene                                                           */
/* ------------------------------------------------------------------ */

export class PlunderScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** a reel's new symbols have all come to rest; syms top to bottom */
  onLand?: (reel: number, syms: Sym[]) => void
  /** a treasure map came to rest (drop or cascade); the screen counts and chimes */
  onMapLand?: (id: number) => void
  /** the ways counter is rolling to a new count (a reel's new height landed) */
  onWays?: (ways: number) => void
  /** a gold coin of the shower went by (for a clink now and then) */
  onCoin?: () => void
  /** the lanterns lit (Treasure Hunt) */
  onLanterns?: () => void
  thumbs: Partial<Record<Sym | 'host', string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
  private readonly key: THREE.DirectionalLight
  private readonly ambient: THREE.AmbientLight
  private readonly lamps: THREE.PointLight[] = []

  private readonly pool = new Map<Sym, Piece[]>()
  private readonly live = new Set<Piece>()
  private readonly byId = new Map<number, Piece>()
  private readonly reels: Reel[] = []
  private plans: Plan[] = []
  private dropAt = 0
  private dropBatch: Batch | null = null
  /** the heights the ways counter has multiplied in so far */
  private readonly counted = new Array<number>(REELS).fill(MAX_ROWS)

  // the reels' tiles
  private readonly tileMesh: THREE.InstancedMesh
  private readonly tileMat: THREE.ShaderMaterial
  private readonly sizeAttr: THREE.InstancedBufferAttribute
  private readonly fxAttr: THREE.InstancedBufferAttribute
  private readonly hotAttr: THREE.InstancedBufferAttribute
  private readonly backAttr: THREE.InstancedBufferAttribute
  /** per reel and row of the current layout: winner glow, eased */
  private readonly hot = new Float32Array(REELS * MAX_ROWS)
  private readonly hotTo = new Float32Array(REELS * MAX_ROWS)
  private readonly flashT = new Float32Array(REELS * MAX_ROWS)
  /** per reel and row: the colour a winner there glows in */
  private readonly hotColor: (number[] | undefined)[] = []
  /** per reel and row: the soft backing in the resting symbol's colour on a tall cell (rgb, amount), eased */
  private readonly back = new Float32Array(REELS * MAX_ROWS * 4)
  private readonly backTo = new Float32Array(REELS * MAX_ROWS * 4)

  // the stage
  private readonly backMat: THREE.ShaderMaterial
  private readonly dimMat: THREE.MeshBasicMaterial
  private readonly dimMesh: THREE.Mesh
  private readonly flashMat: THREE.ShaderMaterial
  private readonly flashMesh: THREE.Mesh
  private readonly frame: FrameRig
  private readonly polly: HostRig
  private readonly medal: MedallionRig
  private readonly medalRoot = new THREE.Group()
  private readonly lanterns: { obj: THREE.Group; swing: number; v: number; ph: number }[] = []
  private readonly ship = new THREE.Group()
  private readonly mast: MastRig
  private readonly chest: ChestRig
  private readonly helm: HelmRig
  private readonly gulls: Gull[] = []
  private readonly beams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = []
  private readonly beamTex: THREE.Texture
  private readonly rays: { sprite: THREE.Sprite; t: number; on: number; at: THREE.Vector3 | null; id: number }[] = []
  private readonly raysTex: THREE.Texture
  private readonly bubble = new Bubble()
  /** the big treasure map of a trigger (an unclipped copy), its rays, and where it is in its show */
  private readonly bigMap: THREE.Group
  private readonly bigRays: THREE.Sprite
  private bigMapT = -1
  private bigMapOut = -1
  private readonly bigMapFrom = new THREE.Vector3()
  private readonly bigMapAt = new THREE.Vector3()

  // effects
  private readonly sparks = new Sparks(1800)
  private readonly rings = new Rings(64)
  private readonly bitMat: THREE.Material
  private readonly splinters: Bits
  private readonly shards: Bits
  private readonly flakes: Bits
  private readonly coins: Bits
  private readonly confetti: Bits
  private readonly flyCoins: THREE.Mesh[] = []
  private flights: Flight[] = []
  private comets: Comet[] = []
  private rockets: Rocket[] = []
  /** scene-time timers: promises from wait(), and jobs from after(), which are dropped on dispose */
  private timers: { at: number; fn: () => void; job: boolean }[] = []
  private conds: { test: () => boolean; fn: () => void }[] = []

  // Captain Polly
  private act: { kind: Act; t: number; dur: number; hold: boolean } | null = null
  private point: { at: THREE.Vector3; t: number } | null = null
  private pointW = 0
  private readonly lookAt = new THREE.Vector3(0, 0, 6)
  private lookYaw = 0
  private lookPitch = 0
  private focus: { at: THREE.Vector3; t: number } | null = null
  private wanderAt = 2
  private idleAt = 18
  private quietSince = 0

  // the ways counter and the medallion
  private waysShown = 0
  private waysPulse = 0
  /** the plaque's big pop when a spin lands a lot of ways (or many more than the last) */
  private waysPop = 0
  private waysLast = 0
  private medalK = 0
  /** a glint across the medallion (a dead run of free spins: the multiplier waits) */
  private medalGlint = 0
  private medalTo = 0
  private medalT = -1
  private medalN = 1
  private medalNext = 1
  private readonly medalAt = new THREE.Vector3()
  private medalScale = 1
  /** a narrow stage (the width sets the view: a phone); a stage with room for Polly on the lantern arm beside the
   *  frame (a desktop); her size and where she perches (x) */
  private narrow = false
  private side = false
  private hostScale = HOST_WIDE
  private perchX = 2.5

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private readonly quality = new PacedQuality()
  private drewLast = false
  private dist = 20
  private camY = 1
  private hudPx = 52
  private viewTop = 5.7
  private viewBottom = -3.7
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
  private heat = 0
  private free = 0
  private freeTo = 0
  private lit = 0
  private dim = 0
  private dimTo = 0
  private shake = 0
  private push = 0
  private pushTo = 0
  private readonly pushAt = new THREE.Vector3()
  private shower = 0
  private coinAt = 0
  private chestOpen = 0
  private chestTo = 0
  private chestShut = 0
  private roll = 0
  private flashA = 0
  private gullAt = 3
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.45, 0.86)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // the light the cast was tuned under, warmed by the sunset; moonlight and two lantern glows at night
    this.key = new THREE.DirectionalLight('#fff0dc', 2)
    this.key.position.set(-3, 5, 6)
    this.ambient = new THREE.AmbientLight('#e2dcff', 0.95)
    this.scene.add(this.key, this.ambient)

    // the sky and the sea
    this.backMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFree: { value: 0 },
        uAspect: { value: 1 },
        uHorizon: { value: 0.1 },
        uRoll: { value: 0 },
        uSunX: { value: -0.3 },
        uMoonX: { value: 0.3 },
        uMoonY: { value: 0.3 },
      },
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

    // the carved frame round the reels, its ways plaque and name scroll, and Captain Polly on her perch beside them
    this.frame = buildFrame({ w: W, h: H, cols: REELS })
    this.scene.add(this.frame.root)
    this.polly = buildHost()
    this.polly.root.position.copy(this.frame.perch)
    this.polly.root.scale.setScalar(HOST_WIDE)
    this.scene.add(this.polly.root)
    this.viewBottom = this.frame.size.bottom - 0.08

    // the tiles: one rounded panel per cell, resized as each reel's height changes
    for (let r = 0; r < REELS; r++) this.reels.push({ h: 5, from: 5, to: 5, t: 1, tease: 0, teaseTo: 0 })
    const tileGeo = new THREE.PlaneGeometry(1, 1)
    const N = REELS * MAX_ROWS
    this.sizeAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage)
    this.fxAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.hotAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.backAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage)
    tileGeo.setAttribute('aSize', this.sizeAttr)
    tileGeo.setAttribute('aFx', this.fxAttr)
    tileGeo.setAttribute('aHot', this.hotAttr)
    tileGeo.setAttribute('aBack', this.backAttr)
    this.tileMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHalfH: { value: HALF_H }, uDim: { value: 0 }, uNight: { value: 0 }, uHeat: { value: 0 } },
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
      transparent: true,
      depthWrite: false,
    })
    this.tileMesh = new THREE.InstancedMesh(tileGeo, this.tileMat, N)
    this.tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.tileMesh.frustumCulled = false
    this.tileMesh.renderOrder = -2
    this.scene.add(this.tileMesh)
    this.own.push(tileGeo, this.tileMat, this.tileMesh)

    // the dimmer in front of the reels while winners show off
    const winGeo = new THREE.PlaneGeometry(W, H)
    this.dimMat = new THREE.MeshBasicMaterial({ color: '#05081a', transparent: true, opacity: 0, depthWrite: false })
    this.dimMesh = new THREE.Mesh(winGeo, this.dimMat)
    this.dimMesh.position.z = Z_DIM
    this.dimMesh.renderOrder = 2
    this.dimMesh.visible = false
    this.scene.add(this.dimMesh)
    this.own.push(winGeo, this.dimMat)

    // the gold glow up a reel held back in a tease
    this.beamTex = beamTexture()
    const beamGeo = new THREE.PlaneGeometry(CW * 1.5, H + 0.5)
    for (let r = 0; r < REELS; r++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.beamTex, color: new THREE.Color('#ffc65a').multiplyScalar(1.15), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      const mesh = new THREE.Mesh(beamGeo, mat)
      mesh.position.set(reelX(r), 0, 0.7)
      mesh.renderOrder = 7
      mesh.visible = false
      this.scene.add(mesh)
      this.beams.push({ mesh, mat })
      this.own.push(mat)
    }
    this.own.push(beamGeo, this.beamTex)

    // light rays behind maps that flare
    this.raysTex = raysTexture()
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.raysTex, color: new THREE.Color('#ffcf5a').multiplyScalar(1.3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }))
      s.renderOrder = 3
      s.visible = false
      this.scene.add(s)
      this.rays.push({ sprite: s, t: 0, on: 0, at: null, id: -1 })
      this.own.push(s.material)
    }
    this.own.push(this.raysTex)

    // the ship: deck, rail, the mast and sail behind on the right, the treasure chest, barrels and the helm
    const deckY = this.frame.size.bottom
    // the deck runs from under the camera back to the rail
    const deck = buildDeck(32, 23)
    deck.position.set(0, deckY, 16.5)
    const rail = buildRail(34)
    rail.position.set(0, deckY, -3.8)
    this.mast = buildMast(MAST.h)
    this.mast.root.position.set(MAST.x, deckY, MAST.z)
    this.chest = buildChest()
    this.chest.root.position.set(-4.28, deckY, 0.1)
    this.chest.root.rotation.y = 0.35
    this.chest.root.scale.setScalar(1.1)
    this.helm = buildHelm()
    this.helm.root.position.set(4.9, deckY, -0.35)
    this.helm.root.rotation.y = -0.35
    this.helm.root.scale.setScalar(1.15)
    const barrelA = buildBarrel()
    barrelA.position.set(-5.25, deckY, -0.6)
    const barrelB = buildBarrel()
    barrelB.position.set(-4.7, deckY, -1.5)
    barrelB.rotation.y = 1
    const crate = buildCrate()
    crate.position.set(-6.05, deckY, 0.2)
    crate.rotation.y = 0.5
    const cannon = buildCannon()
    cannon.position.set(4.35, deckY, 1.15)
    cannon.rotation.y = -0.6
    const coil = buildRopeCoil()
    coil.position.set(-3.95, deckY, 1.5)
    this.ship.add(deck, rail, this.mast.root, this.chest.root, this.helm.root, barrelA, barrelB, crate, cannon, coil)
    this.scene.add(this.ship)

    // lanterns on the frame's hooks and one off the mast's yard, each with a warm light at night
    const spots = [...this.frame.hooks, new THREE.Vector3(MAST.x - 1.45, deckY + MAST.h * 0.72 - 0.05, MAST.z + 0.18)]
    spots.forEach((at, i) => {
      const obj = buildLantern()
      obj.position.copy(at)
      if (i === 2) obj.scale.setScalar(1.2)
      this.scene.add(obj)
      this.lanterns.push({ obj, swing: 0, v: 0, ph: rnd(0, TAU) })
      if (i < 2) {
        const l = new THREE.PointLight('#ffb35a', 0, 4.5, 1.6)
        l.position.copy(at).add(new THREE.Vector3(0, -0.35, 0.3))
        this.scene.add(l)
        this.lamps.push(l)
      }
    })
    setLanternGlow(0)

    // the multiplier medallion, waiting out of sight until the hunt
    this.medal = buildMedallion()
    this.medalRoot.add(this.medal.root)
    this.medalRoot.visible = false
    this.scene.add(this.medalRoot)

    // gulls over the sea
    for (let i = 0; i < 3; i++) {
      const mesh = buildGull()
      mesh.visible = false
      this.scene.add(mesh)
      this.gulls.push({ mesh, on: false, x: 0, y: 0, z: 0, dir: 1, speed: 2, t: 0, ph: 0 })
    }

    // full-screen flash of big moments
    this.flashMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uA: { value: 0 } },
      vertexShader: SCREEN_VERT,
      fragmentShader: 'uniform vec3 uColor; uniform float uA; void main() { gl_FragColor = vec4(uColor, uA); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.flashMesh = new THREE.Mesh(quad, this.flashMat)
    this.flashMesh.frustumCulled = false
    this.flashMesh.renderOrder = 21
    this.flashMesh.visible = false
    this.scene.add(this.flashMesh)
    this.own.push(this.flashMat)

    // the speech bubble hangs in front of the camera, placed in screen pixels every frame
    this.camera.add(this.bubble.mesh)
    this.scene.add(this.camera)
    this.own.push(this.bubble)

    // the big treasure map Polly unrolls over the reels for a trigger, with light rays behind it
    this.bigMap = buildStageMap()
    this.bigMap.visible = false
    this.bigMap.renderOrder = 12
    this.scene.add(this.bigMap)
    this.bigRays = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.raysTex, color: new THREE.Color('#ffcf5a').multiplyScalar(1.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }))
    this.bigRays.visible = false
    this.bigRays.renderOrder = 11
    this.scene.add(this.bigRays)
    this.own.push(this.bigRays.material)

    // bits: wood splinters, shards (glass, shell, brass), flakes (feathers, cloth, paper), coins and confetti
    const ramp = toonRamp([92, 165, 225, 255])
    this.bitMat = vkMaterial(ramp)
    this.splinters = new Bits(bitGeometry('splinter'), this.bitMat, 160, true)
    this.shards = new Bits(bitGeometry('shard'), this.bitMat, 200, true)
    this.flakes = new Bits(bitGeometry('flake'), this.bitMat, 160, true)
    this.coins = new Bits(coinGeometry(), goldMaterial(), 260, false)
    const confGeo = new THREE.PlaneGeometry(0.1, 0.055)
    this.confetti = new Bits(confGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 500, false)
    for (const b of [this.splinters, this.shards, this.flakes]) b.mesh.renderOrder = 9
    this.coins.mesh.renderOrder = 9
    this.confetti.mesh.renderOrder = 9
    this.scene.add(this.splinters.mesh, this.shards.mesh, this.flakes.mesh, this.coins.mesh, this.confetti.mesh, this.sparks.points, this.rings.mesh)
    this.own.push(this.splinters, this.shards, this.flakes, this.coins, this.confetti, this.sparks, this.rings, this.bitMat)
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(coinGeometry(), goldMaterial())
      m.visible = false
      m.renderOrder = 10
      m.scale.setScalar(1.6)
      this.scene.add(m)
      this.flyCoins.push(m)
    }

    this.onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = cv.getBoundingClientRect()
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
    }
    this.onLeave = () => this.pointer.set(0, 0)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerleave', this.onLeave)

    this.setWays(waysOf(this.reels.map((r) => r.to)), false)
    this.flushTiles()
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
    for (const s of SYMS_ALL) {
      const p = this.acquire(s, -1, 0, 5)
      poseSymbol(p.model, 0, 1)
      p.glow.visible = true
      temp.push(p)
      this.scene.remove(p.root)
      warm.add(p.root)
    }
    warm.position.set(0, 0, -30)
    this.scene.add(warm)
    const hidden: THREE.Object3D[] = [this.medalRoot, this.flashMesh, this.bubble.mesh, this.dimMesh, this.bigMap, this.bigRays, ...this.beams.map((b) => b.mesh), ...this.rays.map((r) => r.sprite), ...this.flyCoins, ...this.gulls.map((g) => g.mesh), ...Object.values(this.polly.props), this.polly.joy, this.polly.wow]
    for (const o of hidden) o.visible = true
    // the big map shows its X and its halo too
    setUnroll(this.bigMap, 1)
    poseSymbol(this.bigMap, 0, 1)
    this.bigMap.position.set(0, 0, -30)
    const far = new THREE.Vector3(0, 0, -30)
    for (const b of [this.splinters, this.shards, this.flakes, this.coins, this.confetti]) {
      b.emit(far, new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
      b.update(0)
    }
    this.sparks.emit(0, 0, -30, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.sparks.update(0)
    this.rings.emit(far, new THREE.Color(), 0.1, 0.1, 0.01)
    this.rings.update(0)
    // for the target the scene is drawn into (the composer's linear, untoned buffer), not the canvas
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
    this.polly.eye.visible = true
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

  private clip(m: THREE.Material) {
    if (m.clippingPlanes !== CLIP) {
      m.clippingPlanes = CLIP
      m.needsUpdate = true
    }
  }

  /** small transparent pictures of each symbol (celebrating) and of Captain Polly, for the paytable */
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
    // (the models sit at the origin, well inside the reel window's clipping planes)
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
    cam.position.set(0, 0, 2.55)
    cam.lookAt(0, 0, 0)
    for (const s of SYMS_ALL) {
      const o = buildSymbol(s)
      if (s === 'map') setUnroll(o, 1)
      poseSymbol(o, 0.4, s === 'map' ? 0 : 1)
      shoot(o, s)
    }
    // Polly from the chest up, borrowed from the stage for a moment at her modelled size
    const root = this.polly.root
    poseHost(this.polly, 0, 'idle')
    root.position.set(0, 0, 0)
    root.scale.setScalar(1)
    cam.position.set(0.05, 0.6, 1.95)
    cam.lookAt(0, 0.6, 0)
    shoot(root, 'host')
    this.scene.add(root)
    this.placePolly()
    r.setScissorTest(false)
    r.setViewport(0, 0, this.w, this.h)
    r.setClearColor(clear, alpha)
    return res
  }

  /** room (CSS px) the screen keeps under the frame for its counters; the view grows downwards to make it */
  setHudRoom(px: number) {
    this.hudPx = Math.max(0, px)
    this.resize(this.w, this.h)
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
    // the view fits FIT_W across and, down, from over Polly's hat (she stands on the top beam beside the plaque) to
    // the frame's foot plus the screen's HUD room. A narrow stage (a phone) is set by its width and has sky to spare,
    // so Polly is drawn a little bigger there
    const byW = FIT_W / 2 / (tan * this.camera.aspect)
    const byH = (top: number) => (top - this.viewBottom) / Math.max(0.5, 1 - this.hudPx / h) / 2 / tan
    // first choice: Polly on the lantern arm beside the frame, if the stage is wide enough to show her there
    const sideTop = this.topFor(HOST_WIDE, true)
    const sideDist = Math.max(byH(sideTop), byW)
    this.side = tan * sideDist * this.camera.aspect >= SIDE_X + 0.44 * HOST_WIDE + 0.12
    this.narrow = !this.side && byW >= byH(this.topFor(HOST_WIDE))
    this.hostScale = this.narrow ? HOST_NARROW : HOST_WIDE
    this.viewTop = this.side ? sideTop : this.topFor(this.hostScale)
    this.dist = this.side ? sideDist : Math.max(byH(this.viewTop), byW)
    // the top of the view stays put; any height to spare goes under the frame, to the screen's counters
    this.camY = this.viewTop - tan * this.dist
    this.placeCamera()
    this.sparks.mat.uniforms.scale.value = (h * this.dpr) / (2 * tan)
    this.layout()
    if (this.bubble.on) this.layoutBubble()
    if (this.raf) this.composer.render()
  }

  /** the top of the view with Polly drawn at `scale` (on the top beam, or on the lantern arm): over her hat, and
   *  over the name scroll */
  private topFor(scale: number, side = false) {
    const s = this.frame.size
    return Math.max((side ? SIDE_Y : s.top) + this.frame.perchY + scale + HAT_ROOM, s.titleTop + 0.12)
  }

  /** Polly and her perch rail, at her size for this stage: on the right lantern's arm beside the frame, or on the
   *  top beam beside the plaque */
  private placePolly() {
    const s = this.frame.size
    const z = this.frame.perchAt.z
    let y = s.top
    if (this.side) {
      this.perchX = SIDE_X
      y = SIDE_Y
    } else {
      // just clear of the plaque's scroll end, and inside the frame's corner
      this.perchX = Math.min(s.halfW - 0.42 * this.hostScale - 0.08, s.plaqueHalfW + 0.36 * this.hostScale)
    }
    this.frame.perchRail.position.set(this.perchX, y, this.side ? z + 0.08 : z)
    this.polly.root.position.set(this.perchX, y + this.frame.perchY, this.side ? z + 0.08 : z)
    this.polly.root.scale.setScalar(this.hostScale)
  }

  /** Polly's perch, the medallion (on the frame's top left corner, opposite her), the horizon */
  private layout() {
    this.placePolly()
    const wide = !this.narrow
    const s = this.narrow ? MEDAL_NARROW : MEDAL_WIDE
    this.medalScale = s
    // standing on its rim on the top beam's left end; never over the plaque's scroll end
    const size = this.frame.size
    const x = this.side ? size.halfW - 0.5 * s - 0.12 : this.perchX
    this.medalAt.set(-Math.max(x, size.plaqueHalfW + 0.5 * s), size.top + 0.5 * s - 0.24, 0.55)
    // the horizon: a little above the middle of the reels on a wide stage; just over the frame's top on a narrow
    // one, so the sun sets behind Polly
    const hy = wide ? 1.0 : this.frame.size.top + 0.3
    const v = new THREE.Vector3(0, hy, 0).project(this.camera)
    const u = this.backMat.uniforms
    u.uAspect.value = this.w / this.h
    u.uHorizon.value = v.y * 0.5
    u.uSunX.value = (wide ? -0.41 : -0.17) * (this.w / this.h)
    u.uMoonX.value = (wide ? 0.21 : 0.24) * (this.w / this.h)
    // the moon rises well up the sky, but stays on screen when the horizon is high
    u.uMoonY.value = Math.min(0.31, 0.5 - v.y * 0.5 - 0.08)
  }

  private placeCamera() {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const k = smooth(this.push) * 0.08
    // a gentle heave with the swell
    const heave = Math.sin(this.clock * 0.55) * 0.02
    const at = new THREE.Vector3(this.look.x * 0.3 + sx, this.camY - this.look.y * 0.2 + sy + heave, this.dist)
    const aim = new THREE.Vector3(sx * 0.5, this.camY + sy * 0.5 + heave, 0)
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

  /** the player is impatient: run the rest of the round three times as fast, skip tease holds and coin flights */
  hurry() {
    this.boost = 3
    const t = this.time - this.dropAt
    for (const p of this.plans) {
      if (p.stage >= 2) continue
      p.dropAt = Math.min(p.dropAt, t + 0.04 + p.reel * 0.03)
      p.morphAt = Math.min(p.morphAt, p.dropAt - 0.03)
    }
    for (const r of this.reels) r.teaseTo = 0
    for (const f of this.flights) f.t = 1
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

  /** the cascade count so far: gold glints run round the tiles from the third */
  setCombo(n: number) {
    this.heat = n >= 3 ? Math.min(1, 0.35 + (n - 3) * 0.15) : 0
  }

  /** scene seconds */
  wait(s: number) {
    return new Promise<void>((r) => (this.disposed ? r() : this.timers.push({ at: this.time + s, fn: r, job: false })))
  }

  private until(test: () => boolean) {
    return new Promise<void>((r) => (this.disposed || test() ? r() : this.conds.push({ test, fn: r })))
  }

  /** runs `fn` after `s` scene seconds */
  private after(s: number, fn: () => void) {
    if (this.disposed) return
    if (s <= 0) fn()
    else this.timers.push({ at: this.time + s, fn, job: true })
  }

  /* ---------------- pieces ---------------- */

  private acquire(sym: Sym, id: number, reel: number, h: number): Piece {
    let p = this.pool.get(sym)?.pop()
    if (!p) p = this.make(sym)
    p.id = id
    p.reel = reel
    p.size = symbolSize(h)
    p.model.scale.set(p.size, p.size * symbolStretch(h), p.size)
    p.state = 'idle'
    p.win = p.winTo = p.winT = 0
    p.front = p.frontTo = 0
    p.glowAmt = p.glowTo = 0
    p.lift = p.liftTo = 0
    p.squash = p.hop = p.puff = 0
    p.squashAmp = 1
    p.wait = p.t = p.vy = 0
    p.unroll = p.unrollTo = 1
    p.batch = null
    p.onArrive = p.onBurst = null
    p.phase = Math.random() * 10
    p.root.visible = true
    p.root.scale.setScalar(1)
    p.inner.position.set(0, 0, 0)
    p.inner.rotation.set(0, 0, 0)
    p.inner.scale.setScalar(1)
    if (sym === 'map') setUnroll(p.model, 1)
    this.scene.add(p.root)
    this.live.add(p)
    if (id >= 0) this.byId.set(id, p)
    return p
  }

  private make(sym: Sym): Piece {
    const model = buildSymbol(sym)
    for (const m of symbolMaterials(model)) this.clip(m)
    const inner = new THREE.Group()
    inner.add(model)
    const root = new THREE.Group()
    root.add(inner)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(GLOW_OF[sym]).multiplyScalar(1.15), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
    this.clip(glow.material)
    glow.position.z = -0.3
    glow.renderOrder = 3
    glow.visible = false
    root.add(glow)
    return {
      sym,
      id: -1,
      reel: 0,
      row: 0,
      root,
      inner,
      model,
      glow,
      size: 1,
      y: 0,
      y0: 0,
      ty: 0,
      t: 0,
      wait: 0,
      dur: 0,
      vy: 0,
      state: 'idle',
      batch: null,
      onArrive: null,
      onBurst: null,
      squash: 0,
      squashAmp: 1,
      hop: 0,
      win: 0,
      winTo: 0,
      winT: 0,
      front: 0,
      frontTo: 0,
      glowAmt: 0,
      glowTo: 0,
      lift: 0,
      liftTo: 0,
      unroll: 1,
      unrollTo: 1,
      phase: 0,
      puff: 0,
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
    let list = this.pool.get(p.sym)
    if (!list) this.pool.set(p.sym, (list = []))
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

  /** a piece standing on (reel, row) */
  private place(p: Piece, reel: number, row: number, h: number) {
    p.reel = reel
    p.row = row
    p.y = p.ty = p.y0 = rowY(row, h)
    p.root.position.set(reelX(reel), p.y, 0)
  }

  /** starts a piece falling from y0 onto `row` after `wait` */
  private fall(p: Piece, row: number, y0: number, h: number, wait: number, b: Batch) {
    p.row = row
    p.ty = rowY(row, h)
    p.y = p.y0 = y0
    p.dur = Math.max(0.1, Math.sqrt((2 * Math.max(0.01, y0 - p.ty)) / G))
    p.wait = wait
    p.t = 0
    p.state = 'fall'
    p.root.position.set(reelX(p.reel), p.y, 0)
    this.track(p, b)
  }

  private worldOf(p: Piece) {
    return new THREE.Vector3(reelX(p.reel), p.y, p.front * Z_WIN)
  }

  private centroid(ps: Piece[]) {
    const c = new THREE.Vector3()
    for (const p of ps) c.add(this.worldOf(p))
    return ps.length ? c.divideScalar(ps.length) : c
  }

  private pieces(ids: readonly number[]) {
    return [...new Set(ids)].map((id) => this.byId.get(id)).filter((p): p is Piece => !!p)
  }

  /* ---------------- the reels and the ways ---------------- */

  /** starts a reel's height changing to `h` (its tiles stretch or squeeze over 0.2 s) */
  private setHeight(r: number, h: number, instant = false) {
    const reel = this.reels[r]
    if (instant) {
      reel.h = reel.from = reel.to = h
      reel.t = 1
      return
    }
    if (reel.to === h) return
    reel.from = reel.h
    reel.to = h
    reel.t = 0
  }

  /** the ways counter shows `n`: at once, or (as a reel's new height lands) snapping to it with a tick, so it only
   *  ever shows counts the reels can make */
  private setWays(n: number, animate: boolean) {
    if (!animate) {
      this.waysShown = this.waysLast = n
      this.frame.ways.set(n, 0)
      return
    }
    if (n === this.waysShown) return
    this.waysShown = n
    this.waysPulse = 1
    this.onWays?.(n)
  }

  /** every reel has its new height: a big count (10,000 or more, or four times the last spin's) pops the plaque */
  private waysLanded(n: number) {
    if (n >= 10000 || n >= this.waysLast * 4) {
      this.waysPop = 1
      const at = this.frame.plaque.getWorldPosition(new THREE.Vector3()).setZ(0.7)
      this.sparks.burst(at, GOLD, n >= 46656 ? 26 : 14, 3.2, 0.2, 0.6)
      this.rings.emit(at, GOLD.clone().multiplyScalar(1.5), 0.5, n >= 46656 ? 2.4 : 1.7, 0.45)
    }
    this.waysLast = n
  }

  private updateReels(dt: number) {
    for (let r = 0; r < REELS; r++) {
      const reel = this.reels[r]
      if (reel.t < 1) {
        reel.t = Math.min(1, reel.t + dt / 0.2)
        reel.h = reel.from + (reel.to - reel.from) * smooth(reel.t)
      }
      reel.tease += (reel.teaseTo - reel.tease) * Math.min(1, dt * 7)
      const b = this.beams[r]
      b.mat.opacity = reel.tease * (0.6 + 0.15 * Math.sin(this.clock * 9 + r))
      b.mesh.visible = b.mat.opacity > 0.01
      if (reel.tease > 0.3 && Math.random() < dt * 30) {
        const c = new THREE.Color('#ffd27a').multiplyScalar(2)
        this.sparks.emit(reelX(r) + rnd(-0.42, 0.42), rnd(-HALF_H, HALF_H * 0.6), 0.5, 0, rnd(0.6, 1.6), 0, c, rnd(0.1, 0.2), rnd(0.5, 0.8))
      }
    }
    // the ways counter: a tick as each reel's height lands, a big pop for a big count
    this.waysPulse = Math.max(0, this.waysPulse - dt * 4.5)
    this.waysPop = Math.max(0, this.waysPop - dt * 1.6)
    this.frame.ways.set(this.waysShown, this.waysPulse > 0.5 || this.waysPop > 0.4 ? 1 : 0)
    const pu = this.waysPulse
    const pp = this.waysPop
    this.frame.plaque.scale.setScalar(1 + 0.06 * Math.sin(pu * Math.PI) + 0.2 * Math.sin((1 - pp) * Math.PI * 3) * pp)
    this.updateTiles(dt)
  }

  /** the soft backings: every symbol resting on a tall cell (a short reel) washes its tile in its colour */
  private updateBacks(dt: number) {
    const to = this.backTo
    const back = this.back
    to.fill(0)
    for (const p of this.live) {
      if (p.state === 'leave' || p.state === 'blast') continue
      if (p.state === 'fall' && (p.wait > 0 || p.t < p.dur * 0.55)) continue
      const tall = clamp01((H / this.reels[p.reel].to / CW - 1.45) / 1.1)
      if (tall <= 0) continue
      const j = (p.reel * MAX_ROWS + p.row) * 4
      const c = BACK_OF[p.sym]
      to[j] = c[0]
      to[j + 1] = c[1]
      to[j + 2] = c[2]
      to[j + 3] = tall
    }
    const k = Math.min(1, dt * 8)
    for (let j = 0; j < back.length; j += 4) {
      const a = back[j + 3]
      if (to[j + 3] > 0) {
        // a new colour takes over at once on an empty tile, or blends in over the last one
        const kc = a < 0.05 ? 1 : Math.min(1, dt * 12)
        for (let c = 0; c < 3; c++) back[j + c] += (to[j + c] - back[j + c]) * kc
      }
      back[j + 3] = a + (to[j + 3] - a) * k
    }
  }

  private updateTiles(dt: number) {
    this.updateBacks(dt)
    const m = new THREE.Matrix4()
    const size = this.sizeAttr.array as Float32Array
    const fx = this.fxAttr.array as Float32Array
    const backs = this.backAttr.array as Float32Array
    const k = Math.min(1, dt * 10)
    let n = 0
    for (let r = 0; r < REELS; r++) {
      const reel = this.reels[r]
      const ch = H / reel.h
      const rows = Math.min(MAX_ROWS, Math.ceil(reel.h - 1e-3))
      for (let i = 0; i < rows; i++) {
        const slot = r * MAX_ROWS + i
        this.hot[slot] += (this.hotTo[slot] - this.hot[slot]) * k
        this.flashT[slot] = Math.max(0, this.flashT[slot] - dt * 4)
        m.makeTranslation(reelX(r), HALF_H - (i + 0.5) * ch, Z_TILE)
        this.tileMesh.setMatrixAt(n, m)
        size[n * 2] = CW - GAP
        size[n * 2 + 1] = Math.max(0.05, ch - GAP)
        fx[n * 4] = this.hot[slot]
        fx[n * 4 + 1] = reel.tease
        fx[n * 4 + 2] = this.flashT[slot]
        ;(this.hotAttr.array as Float32Array).set(this.hotColor[slot] ?? [0, 0, 0], n * 3)
        for (let c = 0; c < 4; c++) backs[n * 4 + c] = this.back[slot * 4 + c]
        n++
      }
    }
    this.tileMesh.count = n
    this.tileMesh.instanceMatrix.needsUpdate = true
    this.sizeAttr.needsUpdate = this.fxAttr.needsUpdate = this.hotAttr.needsUpdate = this.backAttr.needsUpdate = true
  }

  private flushTiles() {
    this.updateTiles(0)
  }

  /* ---------------- the board ---------------- */

  /** places a board at rest: its heights, its symbols and the ways count, no animation */
  show(board: Board) {
    if (this.disposed) return
    for (const p of [...this.live]) this.release(p)
    this.plans = []
    board.forEach((cells, r) => {
      this.setHeight(r, cells.length, true)
      this.counted[r] = cells.length
      cells.forEach((cell, row) => {
        const p = this.acquire(cell.sym, cell.id, r, cells.length)
        this.place(p, r, row, cells.length)
      })
    })
    this.setWays(waysOf(board.map((c) => c.length)), false)
    this.clearHighlight()
    this.flushTiles()
  }

  /**
   * A new spin: the old symbols drop out of the bottom reel by reel, each reel's cells stretch or squeeze to its new
   * height (the ways counter rolling as each lands) and the new symbols drop in from above, the bottom one first.
   * Reels from `teaseFrom` on are held back under a gold glow (a map short of the feature), each 0.55 s longer than
   * the last. Resolves when every symbol has come to rest: 1.25 s at 1×, plus the holds.
   */
  async drop(board: Board, teaseFrom = -1) {
    if (this.disposed) return
    this.clearHighlight()
    const batch: Batch = { n: 0 }
    for (const p of this.live) {
      if (p.state === 'leave' || p.state === 'blast') continue
      if (this.byId.get(p.id) === p) this.byId.delete(p.id)
      const rows = this.reels[p.reel].to
      p.state = 'leave'
      p.wait = 0.035 * p.reel + (rows - 1 - p.row) * 0.008
      p.vy = 1.4
      p.t = 0
      this.track(p, batch)
    }
    for (let r = 0; r < REELS; r++) this.counted[r] = this.reels[r].to
    this.dropAt = this.time
    this.dropBatch = batch
    const held = (r: number) => teaseFrom >= 0 && r >= teaseFrom && !this.hurried
    this.plans = board.map((cells, r) => {
      const hold = held(r) ? TEASE * (r - teaseFrom + 1) : 0
      return { reel: r, cells, morphAt: 0.17 + REEL_GAP * r + hold, dropAt: 0.2 + REEL_GAP * r + hold, held: held(r), stage: 0, left: cells.length }
    })
    if (teaseFrom >= 0 && !this.hurried) {
      // the tease starts when the first held reel would have dropped
      this.after(0.2 + REEL_GAP * teaseFrom, () => {
        if (this.hurried) return
        for (const p of this.plans) if (p.held && p.stage < 2) this.reels[p.reel].teaseTo = 1
        this.startAct('spyglass', true)
        this.say(Math.random() < 0.6 ? LINES.spyglass[0] : pick(LINES.spyglass), 1.8)
      })
    }
    await this.until(() => this.plans.every((p) => p.stage === 2) && batch.n <= 0)
    this.plans = []
    this.dropBatch = null
    if (this.act?.kind === 'spyglass' && this.act.hold) this.act.hold = false
    for (const r of this.reels) r.teaseTo = 0
  }

  /** moves the drop along: each reel's height change, then its new symbols falling in */
  private updatePlans() {
    const batch = this.dropBatch
    if (!this.plans.length || !batch) return
    const t = this.time - this.dropAt
    for (const pl of this.plans) {
      if (pl.stage === 0 && t >= pl.morphAt) {
        pl.stage = 1
        const h = pl.cells.length
        this.setHeight(pl.reel, h)
        this.counted[pl.reel] = h
        this.setWays(waysOf(this.counted), true)
        if (this.plans.every((x) => x.stage > 0)) {
          this.waysLanded(waysOf(this.counted))
          if (waysOf(this.counted) >= 46656) this.maxWaysFx()
        }
      }
      if (pl.stage === 1 && t >= pl.dropAt) {
        pl.stage = 2
        const h = pl.cells.length
        const fresh: Piece[] = []
        pl.cells.forEach((cell, row) => {
          const p = this.acquire(cell.sym, cell.id, pl.reel, h)
          if (cell.sym === 'map') {
            p.unroll = 0.12
            p.unrollTo = 0.12
            setUnroll(p.model, 0.12)
          }
          this.fall(p, row, rowY(row, h) + H + 0.4, h, (h - 1 - row) * 0.022, batch)
          fresh.push(p)
          p.onArrive = () => {
            if (cell.sym === 'map') this.mapLanded(p)
            if (--pl.left === 0) {
              this.reels[pl.reel].teaseTo = 0
              this.focusOn(new THREE.Vector3(reelX(pl.reel), 0, 0), 0.4)
              this.onLand?.(pl.reel, pl.cells.map((c) => c.sym))
              if (pl.held && fresh.some((x) => x.sym === 'map')) this.shake = Math.max(this.shake, 0.25)
            }
          }
        })
        if (pl.held) this.focusOn(new THREE.Vector3(reelX(pl.reel), 0, 0), 0.8)
      }
    }
  }

  /** a map came to rest: it unrolls with a twirl and a sparkle, and Polly points at it */
  private mapLanded(p: Piece) {
    p.unrollTo = 1
    const at = this.worldOf(p).setZ(0.4)
    this.sparks.burst(at, new THREE.Color('#ffd36a'), 12, 2.8, 0.2, 0.55)
    this.rings.emit(at, new THREE.Color('#ffcf5a').multiplyScalar(1.6), 0.25, 0.9 * p.size, 0.4)
    this.pointAt(at)
    this.onMapLand?.(p.id)
  }

  /** the board reached a lot of ways: the plaque sparkles (and Polly squawks at the full 117,649) */
  private maxWaysFx() {
    const at = this.frame.plaque.getWorldPosition(new THREE.Vector3()).setZ(0.6)
    const full = waysOf(this.counted) >= 117649
    this.after(0.3, () => {
      this.sparks.burst(at, GOLD, full ? 24 : 12, full ? 4 : 3, 0.22, 0.7)
      this.rings.emit(at, GOLD.clone().multiplyScalar(1.6), 0.4, full ? 2.2 : 1.5, 0.5)
      if (full) {
        this.startAct('squawk')
        this.say('Max ways!', 1.4)
      }
    })
  }

  /**
   * The winners light up reel by reel from the left, a light running across each way, come forward and dance while
   * the rest of the reels dim. About 0.5 s.
   */
  async highlight(wins: readonly WayWin[]) {
    if (this.disposed) return
    if (!wins.length) return
    this.dimTo = 1
    const colorOf = new Map<number, string>()
    for (const w of wins) for (const id of w.ids) if (!colorOf.has(id)) colorOf.set(id, GLOW_OF[w.sym])
    const all = this.pieces([...colorOf.keys()])
    let last = 0
    for (let r = 0; r < REELS; r++) {
      const here = all.filter((p) => p.reel === r)
      if (!here.length) continue
      last = Math.max(last, r)
      this.after(r * SWEEP, () => {
        for (const p of here) {
          p.winTo = 1
          p.frontTo = 1
          p.glowTo = 1
          p.squash = 0.6
          p.squashAmp = 0.5
          const slot = p.reel * MAX_ROWS + p.row
          this.hotTo[slot] = 1
          this.flashT[slot] = 0.6
          this.hotColor[slot] = new THREE.Color(colorOf.get(p.id) ?? '#ffffff').toArray()
          const at = this.worldOf(p).setZ(0.7)
          this.sparks.burst(at, new THREE.Color(colorOf.get(p.id) ?? '#ffffff'), 5, 2.2, 0.14, 0.4)
        }
      })
    }
    // a comet across each way, through the middle of that symbol's cells on each reel
    for (const w of wins.slice(0, 4)) {
      const ps = this.pieces(w.ids)
      const pts: THREE.Vector3[] = []
      for (let r = 0; r < w.len; r++) {
        const here = ps.filter((p) => p.reel === r)
        if (!here.length) continue
        pts.push(new THREE.Vector3(reelX(r), here.reduce((a, p) => a + p.ty, 0) / here.length, 0.85))
      }
      if (pts.length < 2) continue
      pts.unshift(pts[0].clone().add(new THREE.Vector3(-0.5, 0, 0)))
      pts.push(pts[pts.length - 1].clone().add(new THREE.Vector3(0.5, 0, 0)))
      this.comets.push({ pts, t: 0, dur: SWEEP * (w.len + 1) + 0.1, color: new THREE.Color(GLOW_OF[w.sym]) })
    }
    this.focusOn(this.centroid(all), 1.2)
    const big = wins.length >= 3 || wins.some((w) => w.len >= 5)
    if (!this.act || this.act.kind === 'spyglass') this.startAct(big ? 'cheer' : 'squawk')
    await this.wait(last * SWEEP + 0.26)
  }

  /** winners settle back and the reels brighten again */
  clearHighlight() {
    this.dimTo = 0
    for (const p of this.live) {
      p.winTo = 0
      p.frontTo = 0
      p.glowTo = 0
      p.liftTo = 0
    }
    this.hotTo.fill(0)
  }

  /**
   * The winners burst: each puffs up and blows apart into a splash, a pop of coins and wood splinters, with its own
   * bits (feathers, glass, shell, brass...), reel by reel from the left. `onBlast(i)` fires per symbol as it goes.
   * About 0.35 s; the bits keep flying through the cascade.
   */
  async blast(ids: readonly number[], onBlast?: (i: number) => void) {
    if (this.disposed) return
    const ps = this.pieces(ids).sort((a, b) => a.reel - b.reel || a.row - b.row)
    if (!ps.length) return
    let k = 0
    let end = 0
    for (const p of ps) {
      const at = p.reel * 0.03 + rnd(0, 0.025)
      end = Math.max(end, at)
      if (this.byId.get(p.id) === p) this.byId.delete(p.id)
      p.state = 'blast'
      p.t = 0
      p.wait = at
      p.puff = 0.1
      p.onBurst = () => {
        const slot = p.reel * MAX_ROWS + p.row
        this.hotTo[slot] = 0
        this.flashT[slot] = 1
        this.shatter(p)
        this.release(p)
        onBlast?.(k++)
      }
    }
    if (ps.length >= 8) this.shake = Math.max(this.shake, 0.3)
    await this.wait(end + 0.1 + 0.12)
    this.clearHighlight()
  }

  private shatter(p: Piece) {
    const at = this.worldOf(p)
    const s = p.size
    const c = new THREE.Color(GLOW_OF[p.sym])
    this.sparks.emit(at.x, at.y, at.z + 0.3, 0, 0, 0, WHITE_HOT, 0.42 * s, 0.09, 0, 0, 0.6)
    this.rings.emit(at.clone().setZ(at.z + 0.3), c.clone().multiplyScalar(1.5), 0.2 * s, 0.68 * s, 0.24)
    this.sparks.burst(at, c, 6, 4.2 * s, 0.12, 0.4)
    // the splash: droplets thrown up and falling back
    const water = new THREE.Color('#bfe6ff').multiplyScalar(1.8)
    for (let i = 0; i < 9; i++) {
      const a = rnd(0.25, Math.PI - 0.25)
      const v = rnd(2.2, 4.6) * s
      this.sparks.emit(at.x + rnd(-0.15, 0.15) * s, at.y, at.z + 0.35, Math.cos(a) * v * 0.8, Math.sin(a) * v, rnd(0, 1.5), i % 3 ? water : WHITE_HOT, rnd(0.09, 0.16) * s, rnd(0.45, 0.7), -12, 0.6)
    }
    // a pop of coins and wood splinters off the tile
    const spray = (bits: Bits, n: number, color: () => THREE.Color, speed: number, grav: number, scale: number, life = 0.9) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU
        const v = speed * rnd(0.45, 1) * s
        bits.emit(at, new THREE.Vector3(Math.cos(a) * v, Math.sin(a) * v + speed * 0.4, rnd(0.5, 3)), color(), scale * rnd(0.75, 1.25) * s, life * rnd(0.75, 1.1), grav, rnd(6, 16))
      }
    }
    const woods = ['#8f4e2a', '#b06a3a', '#6d3a1d']
    spray(this.splinters, 4, () => new THREE.Color(pick(woods)), 4.5, -14, 1)
    spray(this.coins, 2, () => new THREE.Color(1, 1, 1), 3.6, -13, 0.9, 1)
    const col = (h: string) => () => new THREE.Color(h)
    switch (p.sym) {
      case 'captain':
        spray(this.flakes, 4, col('#ff5a4e'), 2.2, -3, 1, 1.4)
        spray(this.flakes, 3, () => new THREE.Color(pick(['#2f7bff', '#ffcf33'])), 2.2, -3, 0.9, 1.4)
        break
      case 'shark':
        for (let i = 0; i < 12; i++) {
          const a = rnd(0.5, Math.PI - 0.5)
          const v = rnd(3.5, 6) * s
          this.sparks.emit(at.x, at.y - 0.1 * s, at.z + 0.4, Math.cos(a) * v * 0.6, Math.sin(a) * v, rnd(0, 2), water, rnd(0.12, 0.2) * s, rnd(0.5, 0.8), -14, 0.5)
        }
        this.rings.emit(at.clone().setZ(at.z + 0.32), water, 0.25 * s, 0.9 * s, 0.32)
        break
      case 'monkey':
        spray(this.flakes, 4, () => new THREE.Color(pick(['#24346e', '#ffffff', '#ef3b3b'])), 2.6, -5, 0.8, 1.2)
        spray(this.shards, 1, col('#ffe14d'), 3, -10, 1.6)
        break
      case 'crab':
        spray(this.shards, 7, () => new THREE.Color(pick(['#ff8a3d', '#e8642a', '#ffb47a'])), 4, -12, 1.1)
        break
      case 'anchor':
        spray(this.shards, 5, () => new THREE.Color(pick(['#cfe0f5', '#93a9cc', '#e8b04a'])), 4, -14, 1)
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * TAU
          this.sparks.emit(at.x, at.y, at.z + 0.35, Math.cos(a) * 5 * s, Math.sin(a) * 5 * s, rnd(0, 2), new THREE.Color('#fff1c0').multiplyScalar(2.2), rnd(0.07, 0.12), rnd(0.2, 0.35), -6, 1)
        }
        break
      case 'compass':
        spray(this.shards, 6, () => new THREE.Color(pick(['#e8b04a', '#ffd77a', '#fff3d6'])), 4, -12, 1)
        break
      case 'spyglass':
        spray(this.shards, 5, () => new THREE.Color(pick(['#b88cff', '#e8b04a', '#cdeeff'])), 4, -12, 1)
        this.sparks.emit(at.x, at.y, at.z + 0.4, 0, 0, 0, new THREE.Color('#cdeeff').multiplyScalar(2.6), 0.6 * s, 0.14, 0, 0, 0.4)
        break
      case 'bottle':
        spray(this.shards, 8, () => new THREE.Color(pick(['#3fd6a0', '#8ff0c8', '#2fb27f'])), 4.4, -12, 1.05)
        spray(this.flakes, 1, col('#f2f0d0'), 1.6, -2.2, 1.5, 1.6)
        break
      case 'flag':
        spray(this.flakes, 6, () => new THREE.Color(pick(['#262b3f', '#262b3f', '#fff6e2'])), 2.8, -4, 1.1, 1.3)
        spray(this.coins, 2, () => new THREE.Color(1, 1, 1), 4, -13, 0.9, 1)
        break
      default:
        break
    }
  }

  /**
   * After a blast: the symbols left fall to their new rows and new ones drop in from above, per `next` (the next
   * step's board). About 0.55 s.
   */
  async cascade(next: Board) {
    if (this.disposed) return
    const batch: Batch = { n: 0 }
    const keep = new Set<Piece>()
    next.forEach((cells, r) => {
      const h = cells.length
      const ch = H / h
      const fresh = cells.filter((c) => !this.byId.has(c.id)).length
      cells.forEach((cell, row) => {
        let p = this.byId.get(cell.id)
        if (p) {
          keep.add(p)
          if (p.row !== row || p.state !== 'idle') this.fall(p, row, p.y, h, 0.012 * r, batch)
          return
        }
        p = this.acquire(cell.sym, cell.id, r, h)
        keep.add(p)
        if (cell.sym === 'map') {
          p.unroll = p.unrollTo = 0.12
          setUnroll(p.model, 0.12)
          p.onArrive = () => this.mapLanded(p!)
        }
        this.fall(p, row, rowY(row, h) + fresh * ch + 0.3, h, 0.012 * r + (fresh - 1 - row) * 0.02, batch)
      })
    })
    for (const p of [...this.live]) if (!keep.has(p) && (p.state === 'idle' || p.state === 'settle')) this.release(p)
    await this.until(() => batch.n <= 0)
  }

  /**
   * The treasure maps flare: they come forward and swell, light rays turn behind them and coins burst from their X.
   * A trigger (or a pay) also has Polly dig for the treasure. 0.9 s, a retrigger 0.6 s.
   */
  async maps(ids: readonly number[], kind: 'trigger' | 'retrigger' | 'pay' = 'trigger') {
    if (this.disposed) return
    const ps = this.pieces(ids)
    this.flareMaps(ps)
    this.flash('#ffc65a', kind === 'retrigger' ? 0.25 : 0.4)
    if (kind === 'retrigger') this.startAct('cheer')
    else {
      this.startAct('dig')
      if (kind === 'trigger') this.say(pick(LINES.dig), 1.6)
    }
    await this.wait(kind === 'retrigger' ? 0.6 : 0.9)
    this.settleMaps(ps)
  }

  /**
   * The maps start Treasure Hunt: about 2 s (a third of that hurried). They flare, a streak of gold flies from each
   * to Polly, she sends a big treasure map unrolling over the reels, its X stamps down with a boom (a shake, a flash,
   * confetti) and she digs, then the map rolls up and flies off. onBeat calls out each beat for the sounds.
   */
  async trigger(ids: readonly number[], onBeat?: (beat: 'fly' | 'unroll' | 'boom' | 'away') => void) {
    if (this.disposed) return
    const ps = this.pieces(ids)
    this.flareMaps(ps)
    this.flash('#ffc65a', 0.35)
    this.pointAt(this.centroid(ps))
    await this.wait(0.4)
    if (this.disposed) return
    // a streak of gold from each map to Polly
    onBeat?.('fly')
    const chest = this.polly.root.position.clone().add(new THREE.Vector3(-0.05 * this.hostScale, 0.5 * this.hostScale, 0.35))
    ps.forEach((p, i) => {
      const from = this.worldOf(p).setZ(0.9)
      const ctrl = from.clone().lerp(chest, 0.5).add(new THREE.Vector3(0, 1.3, 1.4))
      this.after(i * 0.035, () => this.fly(from, ctrl, chest.clone(), 0.36, null, GOLD))
    })
    this.focusOn(chest, 0.6)
    await this.wait(0.38 + Math.min(6, ps.length) * 0.035)
    if (this.disposed) return
    // she sends the big map unrolling over the reels
    onBeat?.('unroll')
    this.sparks.burst(chest, GOLD, 18, 3, 0.2, 0.6)
    this.startAct('cheer')
    this.bigMapFrom.copy(chest)
    this.bigMapAt.set(0, 0.3, 1.9)
    this.bigMapT = 0
    this.bigMapOut = -1
    this.bigMap.visible = this.bigRays.visible = true
    this.say(LINES.dig[0], 1.5)
    await this.wait(0.5)
    if (this.disposed) return
    // the X stamps down
    onBeat?.('boom')
    this.shake = Math.max(this.shake, 0.55)
    this.flash('#ffd36a', 0.4)
    this.confettiBurst(50)
    const x = this.bigMap.localToWorld(new THREE.Vector3(0.165, -0.04, 0.06))
    this.sparks.emit(x.x, x.y, x.z + 0.2, 0, 0, 0, WHITE_HOT, 1.6, 0.18, 0, 0, 1)
    this.sparks.burst(x, new THREE.Color('#ff6a4e'), 22, 4.5, 0.22, 0.7)
    this.rings.emit(x, GOLD.clone().multiplyScalar(1.8), 0.3, 2.4, 0.5)
    this.pointAt(x)
    this.after(0.12, () => this.startAct('dig'))
    await this.wait(0.48)
    if (this.disposed) return
    // it rolls up and flies off; the maps on the reels settle
    onBeat?.('away')
    this.bigMapOut = 0
    this.settleMaps(ps)
    await this.wait(0.22)
  }

  /** maps come forward, swell and glow, with light rays turning behind them and coins bursting from their X */
  private flareMaps(ps: Piece[]) {
    for (const p of ps) {
      p.liftTo = 1
      p.frontTo = 1
      p.glowTo = 1
      p.winTo = 1
      p.unrollTo = 1
      const ray = this.rays.find((x) => x.on <= 0) ?? this.rays[0]
      ray.on = 1
      ray.t = 0
      ray.id = p.id
      ray.at = this.worldOf(p)
      const at = this.worldOf(p).setZ(0.9)
      this.rings.emit(at, new THREE.Color('#ffd36a').multiplyScalar(1.8), 0.3, 1.3 * p.size, 0.5)
      for (let i = 0; i < 5; i++) this.coins.emit(at, new THREE.Vector3(rnd(-2, 2), rnd(3.5, 6), rnd(1, 3)), new THREE.Color(1, 1, 1), rnd(0.9, 1.3), 1.1, -12, rnd(6, 14))
      this.sparks.burst(at, new THREE.Color('#ffd36a'), 14, 3.4, 0.22, 0.7)
    }
  }

  /** flared maps settle back and their rays fade */
  private settleMaps(ps: Piece[]) {
    const ids = new Set<number>()
    for (const p of ps) {
      p.liftTo = 0
      p.frontTo = 0
      p.glowTo = 0
      p.winTo = 0
      ids.add(p.id)
    }
    for (const r of this.rays) if (ids.has(r.id)) r.on = Math.min(r.on, 0.999)
  }

  /** a glint across the medallion and a little wobble: the multiplier is waiting (a run of dead free spins) */
  glintMedal() {
    if (this.disposed || this.medalK < 0.5) return
    this.medalGlint = 1
    const at = this.medalRoot.position.clone().setZ(this.medalRoot.position.z + 0.45)
    this.sparks.burst(at, GOLD, 10, 2.4, 0.16, 0.5)
  }

  /** the push-in for a huge step: slow motion, a gasp, a flash, and back */
  async bigWin(ids: readonly number[]) {
    if (this.disposed) return
    const ps = this.pieces(ids)
    this.pushAt.copy(ps.length ? this.centroid(ps) : new THREE.Vector3())
    this.pushTo = 1
    this.slowmo = 0.5
    this.startAct('gasp')
    await this.wait(0.2)
    this.slowmo = 1
    this.flash('#ffffff', 0.6)
    this.shake = Math.max(this.shake, 0.4)
    this.pushTo = 0
    await this.wait(0.25)
  }

  /* ---------------- Treasure Hunt ---------------- */

  /** sails into the night (the sun sets, the moon rises, the lanterns light, the medallion swings in) or back */
  async setFree(on: boolean) {
    if (this.disposed) return
    this.clearHighlight()
    if (on) {
      this.freeTo = 1
      this.setMult(1)
      this.after(0.5, () => this.onLanterns?.())
      this.after(0.55, () => (this.medalTo = 1))
      await this.until(() => this.free >= 1 && this.medalK >= 1)
      this.startAct('cheer')
    } else {
      this.freeTo = 0
      this.medalTo = 0
      await this.until(() => this.free <= 0 && this.medalK <= 0)
    }
  }

  /** shows ×n on the medallion at once */
  setMult(n: number) {
    this.medalN = this.medalNext = n
    this.medalT = -1
    this.medal.set(n)
  }

  /**
   * The medallion stamps up to ×n: a coin flies to it from the winners `fromIds` (skipped when hurried), then it
   * punches up, flips over to the new number and showers sparks. About 0.45 s (0.17 s without the coin).
   */
  async stampMult(n: number, fromIds?: readonly number[]) {
    if (this.disposed) return
    const ps = fromIds ? this.pieces(fromIds) : []
    const to = this.medalRoot.position.clone().setZ(this.medalRoot.position.z + 0.3)
    if (ps.length && !this.hurried && this.medalK > 0.5) {
      const from = this.centroid(ps).setZ(0.9)
      const coin = this.flyCoins.find((c) => !c.visible) ?? this.flyCoins[0]
      coin.visible = true
      const ctrl = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 1.4, 1.2))
      await new Promise<void>((r) =>
        this.fly(from, ctrl, to, 0.28, coin, GOLD, () => {
          coin.visible = false
          r()
        }),
      )
      if (this.disposed) return
    }
    this.medalNext = n
    this.medalT = 0
    const c = GOLD.clone().multiplyScalar(1.8)
    this.rings.emit(to, c, 0.5 * this.medalScale, 1.5 * this.medalScale, 0.4)
    this.sparks.burst(to, GOLD, n % 5 === 0 ? 22 : 12, 3.4, 0.2, 0.6)
    if (n % 5 === 0) {
      this.startAct('cheer')
      this.rings.emit(to, new THREE.Color('#fff2b0').multiplyScalar(2), 0.6 * this.medalScale, 2.4 * this.medalScale, 0.6)
    }
    await this.wait(0.17)
  }

  /* ---------------- Captain Polly ---------------- */

  /** one of Polly's moves, with a line in her speech bubble (a stock line for the move if `line` is undefined, none if null) */
  host(action: HostAction, line?: string | null) {
    if (this.disposed) return
    this.startAct(action)
    if (action === 'point' && !(this.point && this.point.t > 0)) this.pointAt(new THREE.Vector3(reelX(4), 0, 0))
    const text = line === undefined ? pick(LINES[action]) : line
    if (text) this.say(text)
  }

  /** a line in Polly's speech bubble for `seconds` (scene time, at least 1 s of real time) */
  say(text: string, seconds = 1.8) {
    if (this.disposed) return
    const b = this.bubble
    b.t = 0
    b.life = seconds
    b.on = true
    if (b.text !== text || !b.mesh.visible) this.layoutBubble(text)
    b.mesh.visible = true
    this.quietSince = this.clock
  }

  /** where the bubble's tail points, in CSS px: just off Polly's beak */
  private bubbleAnchor() {
    this.polly.root.updateWorldMatrix(true, true)
    return this.project(this.polly.beakTip.getWorldPosition(new THREE.Vector3()))
  }

  /** draws the bubble for `text` on the side of Polly with room for it (her right, else her left) */
  private layoutBubble(text = this.bubble.text) {
    const b = this.bubble
    if (!text) return
    const a = this.bubbleAnchor()
    const roomR = this.w - BUBBLE_MARGIN - (a.x + 10)
    const roomL = a.x - 10 - BUBBLE_MARGIN
    const right = roomR >= Math.min(200, roomL)
    const room = right ? roomR : roomL
    const px = this.w < 520 ? 13 : this.w < 760 ? 14 : 15
    b.draw(text, Math.max(90, Math.min(250, room)), px, this.dpr, !right)
  }

  /**
   * Puts the bubble on screen at scale `s` (its pop): the tail's tip just off Polly's beak, up and away from her,
   * the whole bubble kept BUBBLE_MARGIN px inside the stage whatever the camera does (a push-in, a shake). It hangs
   * in front of the camera, so it is placed in screen pixels.
   */
  private placeBubble(s: number) {
    const b = this.bubble
    const a = this.bubbleAnchor()
    const m = BUBBLE_MARGIN
    const tipX = b.flip ? a.x - 8 : a.x + 8
    const tipY = a.y - 4
    // the full-size bubble, kept inside the stage
    const left = Math.min(this.w - m - b.cssW, Math.max(m, b.flip ? tipX - b.cssW : tipX))
    const top = Math.min(this.h - m - b.cssH, Math.max(m, tipY - b.cssH))
    // it pops from its tail's corner
    const cx = b.flip ? left + b.cssW : left
    const cy = top + b.cssH
    const w = b.cssW * s
    const h = b.cssH * s
    const midX = b.flip ? cx - w / 2 : cx + w / 2
    const midY = cy - h / 2
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const D = 1
    const unit = (2 * tan * D) / this.h
    b.mesh.position.set((midX - this.w / 2) * unit, (this.h / 2 - midY) * unit, -D)
    b.mesh.scale.set(Math.max(1e-4, w * unit), Math.max(1e-4, h * unit), 1)
  }

  private startAct(kind: Act, hold = false) {
    this.act = { kind, t: 0, dur: ACT_DUR[kind], hold }
    this.quietSince = this.clock
  }

  /** points at a spot for a moment */
  private pointAt(at: THREE.Vector3) {
    this.point = { at: at.clone(), t: 0.9 }
    this.focusOn(at, 0.9)
  }

  /** Polly looks at a spot for `t` seconds */
  private focusOn(at: THREE.Vector3, t: number) {
    this.focus = { at: at.clone(), t }
  }

  private updateHost(dt: number, real: number) {
    const rig = this.polly
    const a = this.act
    let kind: RigAction = 'idle'
    let k = 0
    let phase = 0
    if (a) {
      a.t += dt
      const u = a.t / a.dur
      k = a.hold ? smooth(Math.min(1, a.t / 0.25)) : env(u, 0.15, 0.25)
      phase = a.t
      kind = a.kind === 'point' ? 'idle' : a.kind
      if (a.hold && a.t > a.dur) a.t = a.dur * 0.5
      if (!a.hold && a.t >= a.dur) this.act = null
    }
    // (the props show only while a move that uses them is on: poseHost shows them, never hides them)
    for (const o of Object.values(rig.props)) o.visible = false
    poseHost(rig, this.clock, kind, k, phase)

    // she sways against the ship's roll
    rig.body.rotation.z += this.roll * 0.6
    // looks at what matters (a reel landing, a map, the winners), else wanders: the reels, a gull, us
    if (this.focus) {
      this.focus.t -= real
      if (this.focus.t <= 0) this.focus = null
    }
    if (!this.focus && this.clock > this.wanderAt) {
      this.wanderAt = this.clock + rnd(2.5, 5)
      const g = this.gulls.find((x) => x.on)
      const r = Math.random()
      if (g && r < 0.35) this.lookAt.set(g.x, g.y, g.z)
      else if (r < 0.65) this.lookAt.set(0, this.camY, this.dist)
      else this.lookAt.set(rnd(-3, 3), rnd(-2.5, 2.5), 0)
    }
    const target = this.focus ? this.focus.at : this.lookAt
    const head = rig.head.getWorldPosition(new THREE.Vector3())
    const d = target.clone().sub(head)
    const fz = Math.max(2.5, d.z + 3)
    const yaw = Math.max(-0.75, Math.min(0.75, Math.atan2(d.x, fz)))
    const pitch = Math.max(-0.25, Math.min(0.5, Math.atan2(-d.y, fz) * 0.7))
    const kl = Math.min(1, real * 5)
    this.lookYaw += (yaw - this.lookYaw) * kl
    this.lookPitch += (pitch - this.lookPitch) * kl
    const busyHead = a && (a.kind === 'cheer' || a.kind === 'squawk' || a.kind === 'gasp')
    rig.head.rotation.y += this.lookYaw * (busyHead ? 0.4 : 1)
    rig.head.rotation.x += this.lookPitch * (busyHead ? 0.3 : 1)
    rig.body.rotation.y += this.lookYaw * 0.25

    // pointing with the wing on the spot's side
    if (this.point) this.point.t -= real
    const pt = this.point && this.point.t > 0 ? this.point.at : null
    this.pointW += ((pt ? 1 : 0) - this.pointW) * Math.min(1, real * 9)
    if (this.pointW > 0.01 && this.point) {
      const side = this.point.at.x < this.polly.root.position.x ? 0 : 1
      const wing = side ? rig.wingR : rig.wingL
      const sh = wing.getWorldPosition(new THREE.Vector3())
      const dir = Math.atan2(this.point.at.y - sh.y, this.point.at.x - sh.x)
      let turn = dir - WING_REST[side]
      turn -= TAU * Math.round(turn / TAU)
      // keep it a clear point: well out from the side, never folded back
      turn = side ? Math.max(0.75, Math.min(2.4, turn)) : Math.min(-0.75, Math.max(-2.4, turn))
      wing.rotation.z += turn * this.pointW + 0.05 * Math.sin(this.clock * 7) * this.pointW
      rig.body.rotation.z += (side ? -0.1 : 0.1) * this.pointW
      rig.jaw.rotation.x += 0.12 * this.pointW * Math.max(0, Math.sin(this.clock * 9))
      rig.brow.position.y += 0.012 * this.pointW
    }

    // now and then on her own: a squawk, a look through the spyglass
    if (!a && !this.busyStage() && this.clock > this.idleAt && this.clock - this.quietSince > 10) {
      this.idleAt = this.clock + rnd(16, 28)
      if (Math.random() < 0.55) {
        this.startAct('squawk')
        if (Math.random() < 0.6) this.say(pick(IDLE_LINES), 1.4)
      } else {
        this.startAct('spyglass')
        this.lookAt.set(rnd(-6, 6), 2, -10)
      }
    }

    // the speech bubble: pops in, wobbles, pops out
    const b = this.bubble
    if (b.on) {
      b.t += Math.max(dt, real)
      const u = b.t
      const out = b.life + 0.14
      const s = u < 0.22 ? ease(u / 0.22) * (1 + 0.16 * Math.sin((u / 0.22) * Math.PI)) : u > b.life ? Math.max(0, 1 - (u - b.life) / 0.14) : 1 + 0.015 * Math.sin(u * 6)
      this.placeBubble(s)
      b.mesh.visible = s > 0.01
      if (u > out) {
        b.on = false
        b.mesh.visible = false
      }
    }
  }

  /** anything going on that Polly shouldn't interrupt with idle chatter */
  private busyStage() {
    return this.plans.length > 0 || this.dimTo > 0 || this.freeTo !== this.free || this.shower > 0 || this.moving()
  }

  /* ---------------- big moments ---------------- */

  /** a full-screen flash of colour */
  flash(color: string, strength = 1) {
    this.flashMat.uniforms.uColor.value.set(color)
    this.flashA = Math.max(this.flashA, strength)
  }

  /** gold coins rain down in front of the stage and the treasure chest on deck bursts open */
  coinShower(seconds = 2.5) {
    this.shower = Math.max(this.shower, seconds)
    this.chestTo = 1
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
    const pal = ['#e8344a', '#ffc63d', '#2f7bff', '#ffffff', '#2fb7c9', '#ff8a3d', '#3fd6a0']
    for (let i = 0; i < n; i++) {
      const z = rnd(0.8, 2.5)
      const v = this.viewHalf(z)
      this.confetti.emit(new THREE.Vector3(rnd(-v.w, v.w), this.camY + v.h + rnd(0, 1.5), z), new THREE.Vector3(rnd(-1, 1), rnd(-3, -0.5), 0), new THREE.Color(pal[i % pal.length]), rnd(0.8, 1.4), rnd(2.5, 3.5), -3, rnd(4, 10))
    }
  }

  /** two cannons fire confetti and coins up from the bottom corners */
  confettiCannons() {
    const pal = ['#e8344a', '#ffc63d', '#2f7bff', '#ffffff', '#2fb7c9']
    const z = 1.5
    const v = this.viewHalf(z)
    for (const s of [-1, 1]) {
      const at = new THREE.Vector3(s * (v.w - 0.3), this.camY - v.h + 0.2, z)
      this.sparks.emit(at.x, at.y, at.z, 0, 0, 0, new THREE.Color('#fff2c0').multiplyScalar(2), 2, 0.25, 0, 0, 1)
      for (let i = 0; i < 70; i++) this.confetti.emit(at, new THREE.Vector3(-s * rnd(1, 4.5), rnd(7, 12), rnd(-1, 1)), new THREE.Color(pal[i % pal.length]), rnd(0.8, 1.4), rnd(2.4, 3.2), -7, rnd(5, 12))
      for (let i = 0; i < 10; i++) this.coins.emit(at, new THREE.Vector3(-s * rnd(1, 3.5), rnd(7, 11), rnd(-1, 1)), new THREE.Color(1, 1, 1), rnd(1, 1.4), 2.4, -9, rnd(6, 14))
    }
    this.startAct('cheer')
  }

  /** rockets burst over the sea; Polly cheers */
  fireworks(rockets: number) {
    const pal = ['#ffd23f', '#ff5a4e', '#4aa3ff', '#3fd6a0', '#ff8a3d', '#ffffff']
    for (let i = 0; i < rockets; i++) {
      // behind the frame, so they rise past it and burst in the sky
      const z = rnd(-4.5, -1.2)
      const v = this.viewHalf(z)
      // they burst in the sky: beside the frame on a wide stage, over it on a narrow one
      const wide = this.viewHalf(0).w - this.frame.size.halfW > 1.7
      const lo = wide ? this.camY - 0.1 * v.h : this.frame.size.top + 0.5
      this.rockets.push({ x: rnd(-v.w * 0.85, v.w * 0.85), y: this.camY - v.h - 0.3, z, vy: rnd(12, 15), top: rnd(lo, this.camY + 0.85 * v.h), wait: i * rnd(0.12, 0.22), color: new THREE.Color(pal[i % pal.length]) })
    }
    this.startAct('cheer')
  }

  private fly(from: THREE.Vector3, ctrl: THREE.Vector3, to: THREE.Vector3, dur: number, obj: THREE.Object3D | null, color: THREE.Color, done: () => void = () => {}) {
    if (this.disposed) done()
    else this.flights.push({ from, ctrl, to, t: 0, dur, obj, color, done })
  }

  /* ---------------- coordinates ---------------- */

  private project(v: THREE.Vector3) {
    const q = v.clone().project(this.camera)
    return { x: ((q.x + 1) / 2) * this.w, y: ((1 - q.y) / 2) * this.h }
  }

  private rectOf(x0: number, y0: number, x1: number, y1: number, z = 0) {
    const a = this.project(new THREE.Vector3(x0, y1, z))
    const b = this.project(new THREE.Vector3(x1, y0, z))
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  /** the average screen position of some symbols where they come to rest, in CSS pixels */
  screenOf(ids: readonly number[]) {
    const ps = this.pieces(ids)
    if (!ps.length) return null
    const c = new THREE.Vector3()
    for (const p of ps) c.add(new THREE.Vector3(reelX(p.reel), p.ty, 0))
    return this.project(c.divideScalar(ps.length).setZ(0.5))
  }

  /** a cell's centre on screen at its reel's current height, in CSS pixels */
  cellScreen(reel: number, row: number) {
    return this.project(new THREE.Vector3(reelX(reel), rowY(row, this.reels[reel].to), 0))
  }

  /** the reel window on screen */
  windowRect() {
    return this.rectOf(-W / 2, -HALF_H, W / 2, HALF_H, 0)
  }

  /** the outside of the carved frame on screen (without the plaque or the lanterns) */
  frameRect() {
    const s = this.frame.size
    return this.rectOf(-s.halfW, s.bottom, s.halfW, s.top, s.front)
  }

  /** the frame's bottom beam on screen (the screen's counters may sit over it) */
  railRect() {
    const s = this.frame.size
    return this.rectOf(-s.halfW, s.bottom, s.halfW, -HALF_H, s.front)
  }

  /** the ways plaque on screen */
  plaqueRect() {
    const s = this.frame.size
    return this.rectOf(-s.plaqueHalfW, s.top - 0.12, s.plaqueHalfW, s.plaqueTop, s.front)
  }

  /** Captain Polly on screen */
  hostRect() {
    const p = this.polly.root.position
    const k = this.hostScale
    return this.rectOf(p.x - 0.42 * k, p.y, p.x + 0.42 * k, p.y + k, p.z)
  }

  /** the medallion on screen (where it stands in Treasure Hunt) */
  medallionRect() {
    const c = this.medalAt
    const r = 0.5 * this.medalScale
    return this.rectOf(c.x - r, c.y - r, c.x + r, c.y + r, c.z)
  }

  /* ---------------- frame loop ---------------- */

  private busy() {
    return (
      this.timers.length > 0 ||
      this.conds.length > 0 ||
      this.plans.length > 0 ||
      this.flights.length > 0 ||
      this.comets.length > 0 ||
      this.rockets.length > 0 ||
      this.sparks.list.length > 0 ||
      this.splinters.list.length > 0 ||
      this.shards.list.length > 0 ||
      this.flakes.list.length > 0 ||
      this.coins.list.length > 0 ||
      this.confetti.list.length > 0 ||
      this.rings.active ||
      this.act !== null ||
      this.bubble.on ||
      this.shower > 0 ||
      this.shake > 0 ||
      this.flashA > 0 ||
      this.waysPop > 0 ||
      this.waysPulse > 0 ||
      this.medalGlint > 0 ||
      this.bigMapT >= 0 ||
      this.medalT >= 0 ||
      this.free !== this.freeTo ||
      this.medalK !== this.medalTo ||
      Math.abs(this.chestOpen - this.chestTo) > 0.002 ||
      Math.abs(this.dim - this.dimTo) > 0.002 ||
      Math.abs(this.push - this.pushTo) > 0.002 ||
      this.reels.some((r) => r.t < 1 || r.tease > 0.01) ||
      this.rays.some((r) => r.on > 0) ||
      this.moving()
    )
  }

  private moving() {
    for (const p of this.live) if (p.state !== 'idle' || p.win > 0.01 || p.lift > 0.01 || p.unroll !== p.unrollTo) return true
    return false
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // at rest the stage only sways, blinks and rolls with the sea; 30 frames a second is plenty for that
    if (!this.busy() && this.acc < 1 / 31) {
      this.drewLast = false
      return
    }
    const real = Math.min(0.05, this.acc)
    this.acc = 0
    const dt = real * this.speed
    this.time += dt
    this.clock += real
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
    // camera: drifts towards the mouse, shakes on big hits, pushes in for a huge step
    this.shake = Math.max(0, this.shake - real * 2.2)
    this.look.lerp(this.pointer, Math.min(1, real * 3))
    this.push = this.pushTo > this.push ? Math.min(this.pushTo, this.push + dt / 0.25) : Math.max(this.pushTo, this.push - dt / 0.3)
    this.placeCamera()

    this.updatePlans()
    for (const p of [...this.live]) this.animate(p, dt, real)
    this.updateReels(dt)
    this.updateShip(dt, real)
    this.updateHost(dt, real)
    this.updateFx(dt, real)
    this.updateBigMap(dt)

    if (this.conds.length) {
      const done = this.conds.filter((c) => c.test())
      if (done.length) {
        this.conds = this.conds.filter((c) => !done.includes(c))
        for (const c of done) c.fn()
      }
    }
  }

  private updateMood(dt: number, real: number) {
    // Treasure Hunt: the sky turns over 1.4 s (back in 1.6 s); the lanterns catch at the halfway mark
    this.free = this.freeTo > this.free ? Math.min(1, this.free + dt / 1.4) : Math.max(0, this.free - dt / 1.6)
    const n = smooth(this.free)
    const litTo = this.free > 0.35 ? 1 : 0
    this.lit += (litTo - this.lit) * Math.min(1, dt * (litTo ? 5 : 3))
    const flicker = 0.5 + 0.5 * Math.sin(this.clock * 13) * Math.sin(this.clock * 7.3)
    setLanternGlow(this.lit, flicker * 0.6)
    for (const l of this.lamps) l.intensity = this.lit * (2.6 + 0.5 * flicker)

    // moonlight, but bright enough that the cast keeps its colours
    this.key.color.set('#fff0dc').lerp(new THREE.Color('#cdd6ff'), n)
    this.key.intensity = 2 - 0.15 * n
    this.ambient.color.set('#e2dcff').lerp(new THREE.Color('#aab0f2'), n)
    this.ambient.intensity = 0.95 - 0.05 * n
    // while winners show off the bloom eases off, so they stay crisp in front of the dimmer
    this.bloom.strength = (0.32 + 0.12 * n) * (1 - 0.5 * this.dim)

    this.roll = 0.032 * Math.sin(this.clock * 0.55) + 0.011 * Math.sin(this.clock * 1.27 + 1)
    const u = this.backMat.uniforms
    u.uTime.value = this.clock
    u.uFree.value = this.free
    u.uRoll.value = this.roll

    this.flashA = Math.max(0, this.flashA - real * 3)
    this.flashMat.uniforms.uA.value = this.flashA
    this.flashMesh.visible = this.flashA > 0.003

    this.dim += (this.dimTo - this.dim) * Math.min(1, dt * 10)
    if (Math.abs(this.dim - this.dimTo) < 0.002) this.dim = this.dimTo
    this.dimMat.opacity = this.dim * 0.5
    this.dimMesh.visible = this.dimMat.opacity > 0.004
    const tu = this.tileMat.uniforms
    tu.uTime.value = this.clock
    tu.uDim.value = this.dim * 0.5
    tu.uNight.value = n
    tu.uHeat.value += (this.heat - tu.uHeat.value) * Math.min(1, real * 4)
    tickModels(this.clock)
  }

  /** the medallion, the lanterns swinging, the chest, the helm and the gulls */
  private updateShip(dt: number, real: number) {
    // the medallion swings down on its ribbon when the hunt starts, and back up after
    const step = this.medalTo > this.medalK ? dt / 0.7 : dt / 0.6
    this.medalK = this.medalTo > this.medalK ? Math.min(1, this.medalK + step) : Math.max(0, this.medalK - step)
    const mk = this.medalK
    const m = this.medalRoot
    m.visible = mk > 0
    if (m.visible) {
      // in: falls past its place on the ribbon and springs back; out: lifts away
      const k = this.medalTo > 0 ? (mk < 0.65 ? ease(mk / 0.65) * 1.06 : 1.06 - 0.06 * smooth((mk - 0.65) / 0.35)) : smooth(mk)
      const drop = (1 - k) * 5
      m.position.set(this.medalAt.x, this.medalAt.y + drop, this.medalAt.z)
      this.medalGlint = Math.max(0, this.medalGlint - dt * 1.6)
      const gl = this.medalGlint
      m.rotation.z = (this.medalTo > 0 ? 0.25 * (1 - mk) * Math.sin(mk * 12) : 0) + 0.03 * Math.sin(this.clock * 1.1) + this.roll * 0.5 + 0.14 * Math.sin((1 - gl) * Math.PI * 4) * gl
      let s = this.medalScale * (1 + 0.06 * Math.sin((1 - gl) * Math.PI) * gl)
      let flip = 0
      if (this.medalT >= 0) {
        this.medalT += dt
        const u = Math.min(1, this.medalT / 0.42)
        s *= 1 + 0.32 * Math.sin(Math.min(1, u / 0.5) * Math.PI) * (1 - u) + 0.08 * Math.exp(-u * 6) * Math.sin(u * 30)
        flip = u < 0.7 ? ease(u / 0.7) * TAU : TAU
        if (u >= 0.25 && this.medalN !== this.medalNext) {
          this.medalN = this.medalNext
          this.medal.set(this.medalN)
        }
        if (u >= 1) this.medalT = -1
      }
      m.scale.setScalar(s)
      this.medal.coin.rotation.y = flip
      const glow = this.medal.glow.material
      glow.opacity = (0.45 + 0.15 * Math.sin(this.clock * 2.4) + (this.medalT >= 0 ? 0.5 * (1 - Math.min(1, this.medalT / 0.42)) : 0) + 0.5 * gl) * mk
    }

    // lanterns swing against the roll, each a little out of step
    for (const l of this.lanterns) {
      const target = -this.roll * 2.2 + 0.04 * Math.sin(this.clock * 1.7 + l.ph)
      l.v += ((target - l.swing) * 18 - l.v * 2.5) * real
      l.swing += l.v * real
      l.obj.rotation.z = l.swing
    }
    // the chest bursts open for a coin shower and shuts a moment after it
    if (this.shower > 0) this.chestShut = this.clock + 1.4
    else if (this.chestTo > 0 && this.clock > this.chestShut) this.chestTo = 0
    this.chestOpen += (this.chestTo - this.chestOpen) * Math.min(1, dt * (this.chestTo ? 9 : 3))
    this.chest.lid.rotation.x = -1.9 * ease(this.chestOpen) + (this.chestTo ? 0.05 * Math.sin(this.clock * 20) * (1 - this.chestOpen) : 0)
    if (this.chestOpen > 0.6 && this.shower > 0 && Math.random() < dt * 14) {
      const at = this.chest.root.position.clone().add(new THREE.Vector3(0, 0.6, 0))
      this.coins.emit(at, new THREE.Vector3(rnd(-1.2, 1.2), rnd(4, 6.5), rnd(0, 1.5)), new THREE.Color(1, 1, 1), rnd(0.9, 1.2), 1.4, -11, rnd(6, 14))
    }
    this.helm.wheel.rotation.z = 0.35 * Math.sin(this.clock * 0.42) + this.roll * 3

    // gulls cross the sky by day, flapping and gliding; at night they've gone to roost
    if (this.free < 0.3 && this.clock > this.gullAt) {
      this.gullAt = this.clock + rnd(5, 11)
      const g = this.gulls.find((x) => !x.on)
      if (g) {
        const half = this.viewHalf(-5).w
        g.on = true
        g.dir = Math.random() < 0.5 ? 1 : -1
        g.z = rnd(-7, -3)
        const v = this.viewHalf(g.z)
        const top = this.camY + v.h
        const wide = half - this.frame.size.halfW > 2
        const lo = wide ? 0.5 : this.frame.size.top + 0.8
        g.y = rnd(Math.min(lo, top - 1), top - 0.6)
        g.x = -g.dir * (v.w + 1)
        g.speed = rnd(1.4, 2.2)
        g.t = 0
        g.ph = rnd(0, 10)
        g.mesh.scale.setScalar(rnd(0.75, 0.95))
        g.mesh.visible = true
      }
    }
    for (const g of this.gulls) {
      if (!g.on) continue
      g.t += real
      g.x += g.dir * g.speed * real
      const glide = smooth(clamp01((Math.sin(g.t * 0.9 + g.ph) - 0.2) * 2))
      g.mesh.position.set(g.x, g.y + 0.25 * Math.sin(g.t * 0.8 + g.ph), g.z)
      g.mesh.rotation.set(0.12 * Math.sin(g.t * 1.3), g.dir > 0 ? -0.7 : Math.PI + 0.7, 0.1 * Math.sin(g.t * 0.9) * g.dir)
      flapGull(g.mesh, g.t + g.ph, 2.4, glide)
      const v = this.viewHalf(g.z)
      if (Math.abs(g.x) > v.w + 1.5 || this.free > 0.6) {
        g.on = false
        g.mesh.visible = false
      }
    }
  }

  private updateFx(dt: number, real: number) {
    // coins flying to the medallion
    if (this.flights.length) {
      const pos = new THREE.Vector3()
      for (const f of this.flights) {
        f.t = Math.min(1, f.t + dt / f.dur)
        const a = 1 - f.t
        pos.set(0, 0, 0).addScaledVector(f.from, a * a).addScaledVector(f.ctrl, 2 * a * f.t).addScaledVector(f.to, f.t * f.t)
        if (f.obj) {
          f.obj.position.copy(pos)
          f.obj.rotation.set(f.t * 9, f.t * 14, 0)
        }
        if (Math.random() < dt * 60) this.sparks.emit(pos.x, pos.y, pos.z, rnd(-0.3, 0.3), rnd(-0.3, 0.3), 0, f.color.clone().multiplyScalar(1.8), rnd(0.12, 0.22), rnd(0.25, 0.4), 0, 1)
      }
      const done = this.flights.filter((f) => f.t >= 1)
      this.flights = this.flights.filter((f) => f.t < 1)
      for (const f of done) f.done()
    }

    // comets across way wins
    if (this.comets.length) {
      const at = new THREE.Vector3()
      for (const c of this.comets) {
        const t0 = c.t
        c.t = Math.min(1, c.t + dt / c.dur)
        const steps = 4
        for (let i = 1; i <= steps; i++) {
          const u = t0 + ((c.t - t0) * i) / steps
          const f = u * (c.pts.length - 1)
          const k = Math.min(c.pts.length - 2, Math.floor(f))
          at.copy(c.pts[k]).lerp(c.pts[k + 1], smooth(f - k))
          this.sparks.emit(at.x, at.y, at.z, rnd(-0.2, 0.2), rnd(-0.2, 0.2), 0, i === steps ? WHITE_HOT : c.color.clone().multiplyScalar(2.2), i === steps ? 0.32 : rnd(0.14, 0.22), rnd(0.2, 0.35), 0, 2)
        }
      }
      this.comets = this.comets.filter((c) => c.t < 1)
    }

    // light rays behind flaring maps
    for (const r of this.rays) {
      if (r.on <= 0) {
        r.sprite.visible = false
        continue
      }
      r.t += dt
      if (r.on < 1) r.on = Math.max(0, r.on - dt * 3)
      const p = this.byId.get(r.id)
      if (p) r.at = this.worldOf(p)
      if (r.at) r.sprite.position.set(r.at.x, r.at.y, Math.max(0.2, r.at.z - 0.2))
      const s = (1.6 + 0.4 * ease(Math.min(1, r.t / 0.3))) * (p ? p.size : 1)
      r.sprite.scale.set(s, s, 1)
      r.sprite.material.rotation = r.t * 0.8
      r.sprite.material.opacity = Math.min(1, r.t * 5) * Math.min(1, r.on) * 0.85
      r.sprite.visible = true
    }

    // fireworks over the sea
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

    // coin shower
    if (this.shower > 0) {
      this.shower -= real
      const n = Math.random() < (real * 80) % 1 ? Math.ceil(real * 80) : Math.floor(real * 80)
      for (let i = 0; i < n; i++) {
        const z = rnd(0.6, 3.2)
        const v = this.viewHalf(z)
        this.coins.emit(new THREE.Vector3(rnd(-v.w, v.w), this.camY + v.h + 0.4, z), new THREE.Vector3(rnd(-0.6, 0.6), rnd(-4, -1), 0), new THREE.Color(1, 1, 1), rnd(1.1, 1.6), 2.6, -7, rnd(5, 13))
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
      [this.splinters, dt],
      [this.shards, dt],
      [this.flakes, dt],
      [this.coins, real],
      [this.confetti, real],
    ] as const) {
      b.update(t)
      b.mesh.visible = b.list.length > 0
    }
  }

  /** Polly's big map in a trigger: it flies out of her wing to the middle of the reels, unrolling as it grows, its X
   *  bouncing; then it rolls up and flies off upwards */
  private updateBigMap(dt: number) {
    if (this.bigMapT < 0) return
    this.bigMapT += dt
    const t = this.bigMapT
    const u = clamp01(t / 0.42)
    const e = ease(u)
    const m = this.bigMap
    m.position.lerpVectors(this.bigMapFrom, this.bigMapAt, e)
    m.position.y += Math.sin(u * Math.PI) * 0.7
    let s = BIG_MAP * (0.12 + 0.88 * e)
    let unroll = 0.12 + 0.88 * smooth(clamp01((t - 0.12) / 0.36))
    let spin = (1 - e) * 0.5
    let rays = e
    if (this.bigMapOut >= 0) {
      this.bigMapOut += dt
      const o = clamp01(this.bigMapOut / 0.34)
      unroll += (0.12 - unroll) * smooth(clamp01(o * 2))
      m.position.y += ease(o) * 4
      s *= 1 - 0.55 * ease(o)
      spin -= ease(o) * 0.4
      rays *= 1 - o
      if (o >= 1) {
        m.visible = this.bigRays.visible = false
        this.bigMapT = this.bigMapOut = -1
        return
      }
    }
    // a little wobble in the wind while it hangs there
    m.rotation.set(0.08 * Math.sin(t * 2.3), 0, spin + 0.04 * Math.sin(t * 3.1))
    m.scale.setScalar(s)
    setUnroll(m, unroll)
    // the X bounces once it is open (the symbol's win dance)
    poseSymbol(m, this.clock, unroll > 0.9 ? 1 : 0)
    const r = this.bigRays
    r.position.set(m.position.x, m.position.y, m.position.z - 0.4)
    r.scale.setScalar(BIG_MAP * 1.55 * Math.max(0.01, rays))
    r.material.rotation = t * 0.6
    r.material.opacity = 0.75 * rays
  }

  private animate(p: Piece, dt: number, real: number) {
    this.advance(p, dt)
    if (!this.live.has(p)) return
    const T0 = this.clock + p.phase
    p.win += (p.winTo - p.win) * Math.min(1, dt * 12)
    if (p.win < 0.002 && p.winTo === 0) p.win = 0
    p.winT = p.winTo > 0 ? p.winT + dt : 0
    p.front += (p.frontTo - p.front) * Math.min(1, dt * 12)
    p.lift += (p.liftTo - p.lift) * Math.min(1, dt * 10)
    p.squash = Math.max(0, p.squash - dt * 3)
    const w = smooth(clamp01(p.win))

    let x = reelX(p.reel)
    let y = p.y + Math.sin(T0 * 1.6) * 0.012 * p.size
    let z = p.front * Z_WIN + p.lift * 0.25
    // a hop after landing
    if (p.state === 'settle') y += p.hop
    if (p.state === 'leave') x += Math.sin(p.t * 9 + p.phase) * 0.03

    // squash and stretch: the landing, the win wobble, the puff before a blast
    const sq = p.squashAmp * p.squash * p.squash * Math.cos((1 - p.squash) * Math.PI * 2.5)
    const wob = p.winTo > 0 ? 0.08 * Math.exp(-p.winT * 4) * Math.sin(p.winT * 6.5 * TAU) : 0
    const puff = p.state === 'blast' && p.wait <= 0 ? 1 + 0.32 * ease(Math.min(1, p.t / p.puff)) : 1
    const grow = (1 + 0.1 * w + 0.28 * p.lift) * puff
    // stretched a little by speed as it falls
    const fast = p.state === 'fall' && p.wait <= 0 ? 0.1 * (p.t / p.dur) : p.state === 'leave' && p.wait <= 0 ? Math.min(0.12, -p.vy * 0.01) : 0
    const sx = grow * (1 - wob) * (1 + 0.14 * sq) * (1 - fast * 0.5)
    const sy = grow * (1 + wob) * (1 - 0.17 * sq) * (1 + fast)
    let rz = 0
    if (p.state === 'blast' && p.wait <= 0) rz += Math.sin(p.t * 90) * 0.07
    if (p.sym === 'map' && p.unroll < p.unrollTo) rz += 0.25 * Math.sin(p.unroll * Math.PI * 2) * (1 - p.unroll)
    p.root.position.set(x, y, z)
    p.inner.rotation.set(0, 0, rz)
    p.inner.scale.set(sx, sy, grow)

    // the model's own idle and win dance
    poseSymbol(p.model, this.clock + p.phase, w)
    if (p.sym === 'map' && p.unroll !== p.unrollTo) {
      p.unroll = Math.min(p.unrollTo, p.unroll + real / 0.34)
      if (p.unroll > p.unrollTo - 0.001) p.unroll = p.unrollTo
      setUnroll(p.model, ease(p.unroll))
    }

    // the glow behind winners and flaring maps
    p.glowAmt += (p.glowTo - p.glowAmt) * Math.min(1, dt * 10)
    const glow = p.glowAmt * (0.32 + 0.08 * Math.sin(this.clock * 9))
    p.glow.material.opacity = glow
    p.glow.visible = glow > 0.01
    if (p.glow.visible) p.glow.scale.setScalar((1.35 + 0.2 * w) * p.size)
    if (w > 0.5 && Math.random() < dt * 7) {
      const c = new THREE.Color(GLOW_OF[p.sym]).multiplyScalar(2)
      this.sparks.emit(x + rnd(-0.4, 0.4) * p.size, y + rnd(-0.4, 0.4) * p.size, z + 0.5, rnd(-0.3, 0.3), rnd(0.3, 1.2), 0, c, rnd(0.1, 0.18), rnd(0.4, 0.7), 0, 1)
    }
  }

  /** moves a piece along: falling onto its row (and its hop after), dropping out of the window, puffing up to blast */
  private advance(p: Piece, dt: number) {
    if (p.state === 'idle') return
    if (p.state === 'leave') {
      if (p.wait > 0) {
        p.wait -= dt
        return
      }
      p.t += dt
      p.vy -= G * 1.1 * dt
      p.y += p.vy * dt
      if (p.y < -HALF_H - p.size) this.release(p)
      return
    }
    if (p.wait > 0) {
      p.wait -= dt
      if (p.wait > 0) return
      dt = -p.wait
      p.wait = 0
    }
    p.t += dt
    if (p.state === 'blast') {
      if (p.t >= p.puff) {
        const f = p.onBurst
        p.onBurst = null
        f?.()
      }
      return
    }
    if (p.state === 'fall') {
      if (p.t < p.dur) {
        const u = p.t / p.dur
        p.y = p.y0 + (p.ty - p.y0) * u * u
        return
      }
      // landed: a squash, a little hop, and its tile flashes
      p.y = p.ty
      p.state = 'settle'
      this.flashT[p.reel * MAX_ROWS + p.row] = Math.max(this.flashT[p.reel * MAX_ROWS + p.row], 0.3)
      p.t -= p.dur
      p.squash = 1
      p.squashAmp = 1
      const f = p.onArrive
      p.onArrive = null
      f?.()
    }
    if (p.state === 'settle') {
      const S = 0.17
      const u = Math.min(1, p.t / S)
      p.hop = 0.07 * p.size * Math.sin(Math.PI * u) * (1 - u * 0.4)
      if (u >= 1) {
        p.hop = 0
        p.state = 'idle'
        this.untrack(p)
      }
    }
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
    this.plans = []
    for (const o of this.own) o.dispose()
    this.frame.ways.dispose()
    this.frame.title.dispose()
    this.medal.dispose()
    disposeTree(this.frame.root)
    disposeTree(this.polly.root)
    disposeTree(this.ship)
    for (const l of this.lanterns) disposeTree(l.obj)
    // the shared caches would otherwise keep this renderer alive after the game closes (see releaseModels)
    releaseModels()
    ringTexture().dispose()
    for (const pass of this.composer.passes) pass.dispose()
    // three's bloom pass leaves its bright-pass material out of its own dispose()
    this.bloom.materialHighPassFilter.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const SYMS_ALL: Sym[] = ['captain', 'shark', 'monkey', 'crab', 'anchor', 'compass', 'spyglass', 'bottle', 'flag', 'map']

/** the geometry of a flying bit, white (each bit is tinted), with a thin ink outline */
function bitGeometry(kind: 'splinter' | 'shard' | 'flake') {
  const k = new VKit(INK, 0.008)
  if (kind === 'splinter') k.add(new THREE.BoxGeometry(0.17, 0.034, 0.03), '#ffffff', T([0, 0, 0], [0, 0, 0.1]))
  else if (kind === 'shard') k.add(new THREE.OctahedronGeometry(0.055, 0), '#ffffff', T([0, 0, 0], [0, 0, 0], [1, 0.62, 0.42]))
  else {
    const leaf = new THREE.Shape()
    leaf.moveTo(0, -0.07)
    leaf.quadraticCurveTo(0.045, -0.01, 0, 0.08)
    leaf.quadraticCurveTo(-0.045, -0.01, 0, -0.07)
    k.add(new THREE.ExtrudeGeometry(leaf, { depth: 0.008, bevelEnabled: false, curveSegments: 4 }), '#ffffff', T([0, 0, -0.004]))
  }
  return k.geometry()
}

/** a shaft of light falling from the top: brightest along its middle and at the top, gone two thirds of the way down */
function beamTexture() {
  const W = 64
  const Hh = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = Hh
  const g = c.getContext('2d')!
  const img = g.createImageData(W, Hh)
  for (let y = 0; y < Hh; y++) {
    const v = y / (Hh - 1)
    const fade = Math.min(1, v * 6) * Math.max(0, 1 - v * 1.45) ** 1.6
    for (let x = 0; x < W; x++) {
      const u = Math.abs(x / (W - 1) - 0.5) * 2
      const a = Math.max(0, 1 - u * u) ** 2 * fade
      img.data.set([255, 255, 255, Math.round(a * 255)], (y * W + x) * 4)
    }
  }
  g.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(c)
}

/** sun rays: soft wedges round a bright middle */
function raysTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5
      const dy = (y + 0.5) / S - 0.5
      const r = Math.hypot(dx, dy) * 2
      const a = Math.atan2(dy, dx)
      const ray = Math.max(0, Math.cos(a * 12)) ** 3
      const v = Math.max(0, 1 - r) ** 1.5 * (0.35 + 0.65 * ray) + Math.max(0, 1 - r * 2.2) ** 2 * 0.6
      img.data.set([255, 255, 255, Math.round(Math.min(1, v) * 255)], (y * S + x) * 4)
    }
  g.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(c)
}
