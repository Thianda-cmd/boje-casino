import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Bits, PacedQuality, Sparks, WHITE_HOT, glowTexture, ringTexture, rnd } from '../../lib/three/fx'
import { BOTS, CELLS, COLS, ROWS, colOf, isBonus, rowOf, type Action, type Cell, type Grid, type Hit, type PaySym, type Placed, type SurgeChange, type Sym } from './rules'
import { SYMBOL_COLOR, valueColor } from './meta'
import {
  Arcs,
  SocketField,
  allMaterials,
  bitGeometries,
  bitMaterial,
  buildHost,
  buildLever,
  buildMachine,
  buildSymbol,
  disposeModels,
  disposeTree,
  formatValue,
  hasFace,
  makeLights,
  openClaw,
  previewSymbol,
  releaseSymbol,
  setAlert,
  setFace,
  setHostFace,
  setHostTint,
  setValue as writeValue,
  shadowMaterial,
  tickModels,
  useEnvironment,
  valueAnchor,
  valueText,
  warmUp,
  ValueLabels,
  type Expr,
  type HostRig,
  type LeverRig,
  type MachineRig,
} from './models'

/*
  The Robo Riot stage: an arcade machine in a neon workshop at night. Five glass tubes hold the robots; on a spin
  Volt yanks his lever, each tube sucks its robots up and out of the top and a new column drops in and bounces.
  When the Power Grid starts the lights cut to red alert, Volt's beacon turns, the glass slides away and the tubes
  become 25 charging sockets: empty ones spin like little slot windows, arrivals slam in and the latches clamp,
  zap bots fire lightning, boost bots send shockwaves and magnet bots pull every value in along their field lines.
  Like the other slots everything runs on the scene clock, so turbo, hurry and long rounds speed the whole show
  up; only idle life (blinks, rotors, the city outside) keeps real time.
*/

export type HostAction = 'cheer' | 'dance' | 'facepalm' | 'gasp' | 'nervous' | 'wave' | 'clap' | 'shrug' | 'lever' | 'magnet' | 'zap'
/** paytable pictures: every symbol, the gold bots and Volt */
export type ThumbKey = Sym | 'magnetGold' | 'zapGold' | 'boostGold' | 'host'
export interface ScreenPoint {
  x: number
  y: number
}

const FOV = 30
/**
 * The view fits FIT_W across and FIT_H up with its top at VIEW_TOP: the machine (6.2 across with its pipes, from
 * its base at -3.02 to the marquee at 3.82), Volt's head and antennae over the marquee (up to about 5.5) and 0.92
 * under the base for the counters (the screen needs about 65 px there). The cabinet is compact so the board gets
 * the screen: a cell is about 84 px on a 1440 × 900 desktop and 57 px on a 375 px phone. On narrow screens the
 * width rules and any height to spare goes under the machine, so the top stays put (see resize).
 */
const FIT_W = 6.24
const FIT_H = 9.58
const VIEW_TOP = 5.64
const CAM_Y = VIEW_TOP - FIT_H / 2
/** the room the screen's counters need under the machine, in CSS px (with a little for the perspective) */
const HUD_PX = 76
/** the tubes' window: pieces are clipped above and below it, so they leave through the tops and drop in from them */
const WIN_H = 2.62
const CLIP = [new THREE.Plane(new THREE.Vector3(0, -1, 0), WIN_H), new THREE.Plane(new THREE.Vector3(0, 1, 0), WIN_H)]

const cellX = (c: number) => c - (COLS - 1) / 2
const cellY = (r: number) => (ROWS - 1) / 2 - r
/** depths: winners come forward past the dimmer; the sockets sit a little behind the pieces they hold */
const Z_WIN = 0.55
const Z_DIM = 0.34
const SOCK_Z = 0.4
/** pieces in the Power Grid stand this far forward, in their sockets, and this much bigger, filling them */
const GRID_Z = 0.42
const GRID_GROW = 0.05
/** the bonus symbols' numbers: their place on the model, and the pop they give when they change */
const ANCHOR = Object.fromEntries((['cell', 'magnet', 'zap', 'boost'] as const).map((s) => [s, valueAnchor(s)])) as Record<string, ReturnType<typeof valueAnchor>>
const POP = 0.34
/** sockets wait this far back while the tubes are up */
const SOCK_BACK = -0.9
/** the cast is modelled to fit 0.9 of a cell; this fills a tube */
const CAST = 1.02
/**
 * Volt stands behind the marquee, leaning on it: his chest hidden by the sign, his head and shoulders over it, drawn
 * this much bigger than modelled. His moves are laid out for him at DESIGN scale and scaled with him (vp).
 */
const VOLT_SCALE = 1.1
const DESIGN = 1.3
const VK = VOLT_SCALE / DESIGN
const VOLT_AT = new THREE.Vector3(0, 3.32, -0.6)
/** his lever sticks up from behind the marquee on his right; it is mirrored, so a pull swings it down towards him */
const LEVER_AT = new THREE.Vector3(2.5 * VK, VOLT_AT.y + 0.25, VOLT_AT.z + 0.15 * VK)
const LEVER_SCALE = DESIGN * VK
const LEVER_REST = 0.1
const LEVER_PULL = -0.9
/** the lever's knob in the arm's own frame */
const KNOB = new THREE.Vector3(0, 0.95, 0.12)
/** Volt's arm in his own units: shoulder to elbow, and elbow to the grip between his claws with the wrist straight */
const ARM_L1 = 0.48
const ARM_L2 = 0.82
/** the grip point in a claw's frame */
const GRIP = new THREE.Vector3(0, -0.3, 0)

/** a spin: tube to tube, top robot to the next, how hard the vacuum pulls, when a tube is clear for the new column */
const VAC_GAP = 0.06
const VAC_ROW = 0.015
const VAC_ACC = 80
const VAC_CLEAR = 0.32
/** the new column falls this far in this long (accelerating), then settles */
const FALL_H = 5.6
const FALL_T = 0.3
const SETTLE_T = 0.28
/** each held tube waits this much longer than the one before */
const HOLD = 0.75
/** an arrival flies in from the front this long */
const SLAM_T = 0.15

const ease = (t: number) => 1 - (1 - t) ** 3
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
/** 0 → 1 → 0 across u = 0..1: in over the first `a`, out over the last `r` */
const env = (u: number, a = 0.2, r = 0.25) => (u <= 0 || u >= 1 ? 0 : smooth(Math.min(1, u / a, (1 - u) / r)))
const TAU = Math.PI * 2
const Z = new THREE.Vector3(0, 0, 1)
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const col3 = (c: THREE.ColorRepresentation, k = 1) => new THREE.Color(c).multiplyScalar(k)

const CYAN = col3('#5cf2ff')
const RED = col3('#ff2a1f')
const GOLD = col3('#ffc94a')
const HOT = col3('#ff7a2e')
const WHITE = new THREE.Color(1, 1, 1)
const HEART = col3('#ff3a2a')
/** the lights by night and in the alarm */
const KEY_NIGHT = col3('#ffe7cc')
const KEY_ALARM = col3('#ffb4a4')
const RIM_NIGHT = col3('#5ce8ff')
const RIM_ALARM = col3('#ff3a2a')
const RIM2_NIGHT = col3('#ff4fd8')
const RIM2_ALARM = col3('#ff2a50')
/** an empty socket's rim: dim steel, so the full ones stand out */
const SOCK_IDLE = col3('#7f90b4')
const COIN_GOLD = col3('#ffc94a')
const TUBE_BASE = 1.6
/** colours by their hex string, parsed once */
const colors = new Map<string, THREE.Color>()
const colorOf = (hex: string) => {
  let c = colors.get(hex)
  if (!c) colors.set(hex, (c = new THREE.Color(hex)))
  return c
}
const BUTTONS = ['#ff3b4f', '#ffd21f', '#3fe46a', '#3ea2ff', '#ff3fd2'].map((c) => col3(c))

/* ------------------------------------------------------------------ */
/*  Shaders                                                             */
/* ------------------------------------------------------------------ */

const SCREEN_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'

/**
 * The workshop at night. A wall of ribbed steel with a big factory window onto a neon city (moon, drifting blimp,
 * searchlights, three layers of skyline with lit windows and signs), a counter of spare parts under it (boxes,
 * gears and sleeping robot heads whose eyes blink), two hanging work lamps with dust in their beams, and the floor.
 * uAlert turns it to red alert: the room goes dark red, Volt's beacon sweeps it, lightning flickers over the city.
 */
const BACK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlert;
uniform float uAspect;
uniform vec2 uBeacon;
uniform float uBeamA;
uniform float uFlash;
uniform float uBoltX;
uniform float uPulse;
uniform float uHot;
uniform float uFloor;
varying vec2 vUv;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
// an sRGB colour (0..255) as linear light
vec3 C(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float rbox(vec2 p, vec2 b, float r) { return box(p, b - r) - r; }

// one layer of skyline: buildings w wide standing on the line y0, up to h tall; returns the coverage, the roof line and the building index
float skyline(vec2 p, float w, float y0, float h, float seed, out float top, out float k) {
  k = floor(p.x / w);
  float hk = hash(k + seed);
  float bw = w * (0.72 + 0.28 * hash(k + seed + 7.0));
  top = y0 + h * (0.25 + 0.75 * hk * hk);
  // some get a stepped crown or a spire
  float cx = (k + 0.5) * w;
  float crown = step(0.7, hash(k + seed + 3.0)) * step(abs(p.x - cx), bw * 0.22) * h * 0.18;
  float spire = step(0.86, hash(k + seed + 5.0)) * step(abs(p.x - cx), w * 0.03) * h * 0.4;
  float t = top + max(crown, spire);
  float inside = step(abs(p.x - cx), bw * 0.5) * step(p.y, t) * step(y0 - 0.2, p.y);
  return inside;
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float t = uTime;
  float A = uAlert;

  // ---- the wall: ribbed steel panels, a little lighter at the top
  vec3 col = mix(C(9., 10., 26.), C(24., 22., 54.), smoothstep(-0.5, 0.5, p.y));
  col *= 0.84 + 0.16 * (0.5 + 0.5 * cos(p.x * 150.0));
  float seam = smoothstep(0.003, 0.0, abs(fract(p.y / 0.22 + 0.37) - 0.5) * 0.22);
  col *= 1.0 - 0.3 * seam;

  // ---- the big window, most of the width, from above the counter to near the top
  float ww = min(0.47 * uAspect, 0.95);
  float wy0 = -0.13;
  float wy1 = 0.46;
  vec2 wc = vec2(0.0, (wy0 + wy1) * 0.5);
  vec2 wh = vec2(ww, (wy1 - wy0) * 0.5);
  float dWin = box(p - wc, wh);
  if (dWin < 0.0) {
    // the sky: deep indigo, a magenta glow on the horizon
    vec3 sky = mix(C(96., 30., 112.), C(20., 18., 62.), smoothstep(-0.06, 0.2, p.y));
    sky = mix(sky, C(6., 8., 30.), smoothstep(0.2, 0.46, p.y));
    sky += C(40., 150., 190.) * 0.12 * exp(-pow((p.y + 0.02) * 18.0, 2.0));
    // stars
    vec2 g = floor((p + 2.0) * 90.0);
    float s = hash2(g);
    vec2 f = fract((p + 2.0) * 90.0) - 0.5;
    sky += step(0.985, s) * (0.5 + 0.5 * sin(t * (1.0 + s * 3.0) + s * 50.0)) * smoothstep(0.2, 0.0, length(f)) * smoothstep(0.08, 0.3, p.y) * 0.9;
    // the moon, with a soft halo and two craters
    vec2 mc = vec2(-ww * 0.72, 0.36);
    float md = length(p - mc);
    sky += C(150., 170., 255.) * exp(-md * md * 300.0) * 0.35;
    float moon = smoothstep(0.034, 0.031, md);
    vec3 mcol = mix(C(255., 244., 220.), C(205., 200., 220.), smoothstep(0.0, 0.03, length(p - mc - vec2(0.008, -0.006))));
    mcol *= 1.0 - 0.18 * smoothstep(0.009, 0.006, length(p - mc - vec2(-0.01, 0.008))) - 0.12 * smoothstep(0.006, 0.004, length(p - mc - vec2(0.012, -0.01)));
    sky = mix(sky, mcol * 1.25, moon);
    // wisps of cloud drifting past
    float cl = noise(p.x * 9.0 + t * 0.05) * noise(p.x * 23.0 - t * 0.03 + 4.0);
    sky += C(120., 90., 170.) * 0.18 * cl * exp(-pow((p.y - 0.3 - 0.03 * sin(p.x * 3.0)) * 30.0, 2.0));
    // searchlights sweeping up from the city
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 o = vec2((fi * 2.0 - 1.0) * ww * 0.55, -0.06);
      vec2 d = p - o;
      float aim = (fi * 2.0 - 1.0) * -0.35 + 0.45 * sin(t * (0.23 + 0.11 * fi) + fi * 2.0);
      float a = atan(d.x, d.y);
      float beam = smoothstep(0.06, 0.0, abs(a - aim)) * smoothstep(0.7, 0.05, length(d)) * step(0.0, d.y);
      sky += mix(C(170., 210., 255.), C(255., 80., 60.), A) * beam * 0.12;
    }
    // lightning over the city in the Power Grid
    sky += C(170., 190., 255.) * uFlash * 0.55 * smoothstep(-0.1, 0.4, p.y);
    float bx = uBoltX + 0.025 * (noise(p.y * 40.0 + uBoltX * 30.0) - 0.5) + 0.012 * (noise(p.y * 140.0) - 0.5);
    sky += vec3(1.2, 1.25, 1.6) * uFlash * exp(-abs(p.x - bx) * 900.0) * step(0.02, p.y);
    // a blimp drifting across with a lit sign and a blinking light
    float span = ww * 2.0 + 0.4;
    vec2 bc = vec2(ww + 0.2 - mod(t * 0.012 + 0.3, span), 0.27 + 0.006 * sin(t * 0.4));
    vec2 q = p - bc;
    float body = length(q / vec2(0.095, 0.027)) - 1.0;
    float fin = box(q - vec2(0.088, 0.0), vec2(0.014, 0.024 - abs(q.x - 0.088) * 0.5));
    float gond = rbox(q - vec2(0.0, -0.03), vec2(0.022, 0.006), 0.003);
    float bd = min(min(body * 0.027, fin), gond);
    if (bd < 0.002) {
      vec3 bcol = mix(C(30., 26., 62.), C(92., 84., 150.), smoothstep(-0.025, 0.025, q.y));
      bcol += C(150., 140., 220.) * 0.5 * smoothstep(0.006, 0.0, abs(body + 0.12)) * step(0.0, q.y);
      float sign = step(abs(q.x + 0.005), 0.05) * step(abs(q.y + 0.002), 0.009);
      float scroll = step(0.5, fract((q.x + t * 0.02) * 40.0)) * 0.6 + 0.4;
      bcol += mix(C(92., 242., 255.), C(255., 63., 210.), step(0.5, fract(t * 0.25))) * sign * scroll * 1.4;
      sky = mix(sky, bcol, smoothstep(0.002, 0.0, bd));
    }
    sky += C(255., 40., 30.) * smoothstep(0.005, 0.0, length(q - vec2(-0.09, 0.0))) * step(0.5, fract(t * 0.8)) * 2.0;
    // the skyline: far, mid and near
    float top; float k;
    float far = skyline(p, 0.032, -0.08, 0.17, 1.0, top, k);
    sky = mix(sky, mix(C(58., 34., 98.), C(40., 26., 70.), smoothstep(-0.1, 0.1, p.y)), far * 0.9);
    float mid = skyline(p + vec2(0.013, 0.0), 0.048, -0.1, 0.22, 11.0, top, k);
    if (mid > 0.5) {
      vec3 b = C(18., 14., 40.);
      // lit windows on a grid; some flicker, and the city browns out in the alarm
      vec2 wg = floor((p + vec2(0.013, 0.0)) / vec2(0.007, 0.011));
      vec2 wf = fract((p + vec2(0.013, 0.0)) / vec2(0.007, 0.011));
      float on = step(0.66, hash2(wg + k * 3.1)) * step(abs(wf.x - 0.5), 0.28) * step(abs(wf.y - 0.5), 0.26) * step(p.y, top - 0.008);
      on *= 1.0 - A * step(0.5, hash2(wg + floor(t * 3.0)));
      vec3 wcol = mix(C(255., 196., 120.), C(120., 220., 255.), step(0.6, hash2(wg + 9.0)));
      b += wcol * on * (0.7 + 0.3 * sin(t * 2.0 + hash2(wg) * 30.0));
      sky = mix(sky, b, mid);
    }
    float near = skyline(p + vec2(0.031, 0.0), 0.075, -0.13, 0.15, 23.0, top, k);
    if (near > 0.5) {
      vec3 b = C(9., 8., 22.);
      // a neon sign on some of them, and a red light on every roof
      float cx = (k + 0.5) * 0.075 - 0.031;
      float hs = hash(k + 41.0);
      vec2 sq = p - vec2(cx + (hs - 0.5) * 0.02, top - 0.03 - hs * 0.03);
      float sgn = step(0.45, hs) * smoothstep(0.003, 0.0, rbox(sq, vec2(0.006, 0.018), 0.003));
      vec3 sc = hs < 0.6 ? C(255., 63., 210.) : hs < 0.8 ? C(92., 242., 255.) : C(255., 210., 60.);
      b += sc * sgn * (1.3 + 0.5 * step(0.5, fract(t * (0.5 + hs)))) * (1.0 - 0.6 * A * step(0.5, fract(t * 4.0 + hs * 7.0)));
      sky = mix(sky, b, near);
    }
    // the glass: a faint sheen and two diagonal reflections
    float sheen = smoothstep(0.02, 0.0, abs(fract((p.x - p.y * 0.6) * 2.2 + 0.2) - 0.5) - 0.02) * 0.04;
    sky += vec3(0.6, 0.8, 1.0) * sheen;
    col = sky * mix(1.0, 0.85, smoothstep(-0.03, 0.0, dWin + 0.03));
  }
  // the frame and its mullions: six panes across, three down
  float mul = min(abs(fract((p.x / ww) * 3.0 + 0.5) - 0.5) * ww / 3.0, min(abs(p.y - 0.08), abs(p.y - 0.27)));
  float frame = max(smoothstep(0.006, 0.003, abs(dWin) - 0.004), step(dWin, 0.0) * smoothstep(0.0045, 0.002, mul));
  col = mix(col, C(14., 15., 32.), frame);
  col += C(60., 70., 120.) * 0.25 * smoothstep(0.003, 0.0, abs(dWin + 0.008)) * step(dWin, 0.0) * step(0.0, p.y - wy1 + 0.02);

  // ---- the counter under the window and the spare parts on it
  float cy = -0.165;
  if (p.y < cy + 0.07 && p.y > cy - 0.2) {
    float k = floor(p.x / 0.06);
    float h = hash(k + 3.0);
    float x0 = (k + 0.5) * 0.06 + (hash(k + 8.0) - 0.5) * 0.02;
    vec2 q = p - vec2(x0, cy);
    vec3 sil = C(7., 7., 18.);
    float d = 1.0;
    float eye = 0.0;
    if (h < 0.32) {
      // a crate
      float bh = 0.012 + 0.03 * hash(k + 1.0);
      d = box(q - vec2(0.0, bh), vec2(0.02 + 0.008 * hash(k + 2.0), bh));
    } else if (h < 0.58) {
      // a robot head left on the shelf, eyes glowing; now and then it blinks
      d = rbox(q - vec2(0.0, 0.019), vec2(0.019, 0.016), 0.006);
      d = min(d, box(q - vec2(0.0, 0.04), vec2(0.0015, 0.008)));
      vec2 e = vec2(abs(q.x) - 0.0075, q.y - 0.021);
      float blink = step(0.985, fract(t * 0.13 + h * 7.0));
      eye = smoothstep(0.0035, 0.0015, length(e / vec2(1.0, 1.0 - 0.9 * blink))) * (1.0 - A * 0.5);
    } else if (h < 0.72) {
      // a gear standing on edge
      vec2 g = q - vec2(0.0, 0.022);
      float a = atan(g.y, g.x);
      d = length(g) - 0.02 - 0.004 * step(0.0, sin(a * 9.0 + k));
      d = max(d, -(length(g) - 0.006));
    } else if (h < 0.84) {
      // an oil can
      d = min(rbox(q - vec2(0.0, 0.016), vec2(0.011, 0.016), 0.003), box(q - vec2(0.012, 0.03), vec2(0.008, 0.0015)));
    }
    col = mix(col, sil, smoothstep(0.0015, -0.0005, d));
    vec3 ec = mix(C(92., 242., 255.), C(255., 60., 40.), A);
    col += ec * eye * 1.6;
    // the counter top, lit along its edge, and the cabinet under it
    col = mix(col, C(16., 15., 34.), step(p.y, cy) * step(cy - 0.012, p.y));
    col += C(255., 190., 120.) * 0.12 * smoothstep(0.003, 0.0, abs(p.y - cy)) * (1.0 - A);
    if (p.y < cy - 0.012) {
      vec3 cab = C(12., 11., 26.);
      float door = abs(fract(p.x / 0.11) - 0.5) * 0.11;
      cab *= 1.0 - 0.35 * smoothstep(0.002, 0.0, door - 0.001);
      cab += C(80., 80., 110.) * 0.15 * smoothstep(0.0025, 0.0, length(vec2(door - 0.012, p.y - cy + 0.06)));
      col = cab;
    }
  }

  // ---- the floor, from the machine's feet down (on tall phones that is higher up)
  float fy = max(cy - 0.19, uFloor + 0.004);
  if (p.y < fy) {
    vec3 fl = mix(C(16., 14., 34.), C(5., 5., 14.), smoothstep(fy, -0.5, p.y));
    // planks in perspective
    float z = 1.0 / max(0.02, fy - p.y + 0.06);
    fl *= 0.9 + 0.1 * step(0.5, fract(p.x * z * 0.35));
    // the machine's neon spills onto the floor
    fl += mix(C(40., 160., 200.), C(255., 40., 30.), A) * 0.18 * exp(-pow(p.x / (0.35 * max(0.6, uAspect * 0.6)), 2.0)) * smoothstep(-0.5, fy, p.y);
    col = fl;
  }

  // ---- two work lamps hanging from the ceiling, dust drifting in their beams
  for (int i = 0; i < 2; i++) {
    float sgn = i == 0 ? -1.0 : 1.0;
    float lx = sgn * min(0.62 * uAspect * 0.5 + 0.12, ww * 0.82);
    float ly = 0.43;
    // the cord and the shade
    col = mix(col, C(6., 6., 14.), smoothstep(0.0015, 0.0005, abs(p.x - lx)) * step(ly, p.y));
    vec2 sq = p - vec2(lx, ly);
    float shade = max(abs(sq.x) - (0.018 + (ly - p.y) * 0.9), max(sq.y - 0.012, -(sq.y + 0.02)));
    col = mix(col, C(30., 32., 50.), smoothstep(0.0015, -0.0005, shade));
    float on = 1.0 - A * 0.85;
    col += C(255., 214., 150.) * smoothstep(0.012, 0.0, length(sq + vec2(0.0, 0.02))) * 2.5 * on;
    // the beam
    vec2 d = p - vec2(lx, ly - 0.02);
    float a = abs(atan(d.x, -d.y));
    float beam = smoothstep(0.42, 0.18, a) * step(d.y, 0.0) * smoothstep(0.75, 0.0, -d.y);
    col += C(255., 200., 140.) * beam * 0.07 * on;
    // dust motes in it
    vec2 mg = (p + vec2(0.0, t * 0.006)) * 70.0;
    vec2 cell = floor(mg);
    vec2 mf = fract(mg) - 0.5 - (vec2(hash2(cell + 1.3), hash2(cell + 7.1)) - 0.5) * 0.6;
    float mote = step(0.86, hash2(cell + float(i) * 17.0)) * smoothstep(0.09, 0.0, length(mf));
    col += C(255., 225., 180.) * mote * beam * 0.9 * (0.6 + 0.4 * sin(t * 1.3 + hash2(cell) * 20.0)) * on;
  }

  // ---- red alert: the room drops to dark red, Volt's beacon sweeps it, the whole place throbs
  if (A > 0.0) {
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(lum * 1.5, lum * 0.24, lum * 0.22) + C(30., 2., 6.) * 0.4, A * 0.68);
    vec2 d = p - uBeacon;
    float ang = atan(d.y, d.x);
    float beam = 0.0;
    for (int i = 0; i < 2; i++) {
      float da = abs(mod(ang - uBeamA - float(i) * 3.14159 + 3.14159, 6.28318) - 3.14159);
      beam += smoothstep(0.32, 0.0, da) * smoothstep(1.6, 0.0, length(d));
    }
    col += C(255., 40., 25.) * beam * 0.22 * A;
    col *= 1.0 + 0.12 * A * sin(t * 7.0);
  }
  // overclocked: a warm glow rises behind the machine
  col += C(255., 110., 40.) * 0.07 * uHot * exp(-pow(p.x / 0.5, 2.0)) * smoothstep(0.2, -0.4, p.y);
  // the heartbeat of a last respin, and celebrations: the edges pulse
  float edge = smoothstep(0.3, 0.9, length(p * vec2(0.8, 1.0)));
  col += C(255., 30., 30.) * 0.14 * uPulse * edge;
  col *= 1.0 - 0.42 * edge;
  gl_FragColor = vec4(col, 1.0);
}`

/** additive or soft billboards (rings, glows, puffs, coin ghosts): one instanced draw each */
const BILL_VERT = /* glsl */ `
attribute vec4 aTint;
varying vec4 vTint;
varying vec2 vUv;
void main() {
  vTint = aTint;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`
const BILL_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec4 vTint;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vTint.rgb * t.rgb, t.a * vTint.a);
}`

/**
 * A socket's slot window while it spins: ghost power cells scroll down through it, smeared by their speed, then it
 * snaps shut with a flash. aWin: scroll (in slots), blur 0..1, alpha, flash.
 */
const WIN_VERT = /* glsl */ `
attribute vec4 aWin;
attribute vec3 aTint;
varying vec2 vUv;
varying vec4 vWin;
varying vec3 vTint;
void main() {
  vUv = uv;
  vWin = aWin;
  vTint = aTint;
  gl_Position = aWin.z + aWin.w < 0.002 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`
const WIN_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vWin;
varying vec3 vTint;
float capsule(vec2 p, float h, float r) { p.y -= clamp(p.y, -h, h); return length(p) - r; }
float rbox(vec2 p, vec2 b, float r) { vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
// the ghosts that scroll past: a power cell, a bot's head with two eyes, or a value gem
float ghost(vec2 q, float h) {
  if (h < 0.42) return capsule(q.yx, 0.13, 0.12);
  if (h < 0.78) {
    float d = rbox(q, vec2(0.21, 0.15), 0.06);
    return max(d, -(min(length(q - vec2(-0.075, 0.015)), length(q - vec2(0.075, 0.015))) - 0.035));
  }
  return (abs(q.x) * 1.15 + abs(q.y) - 0.17) * 0.75;
}
vec3 tone(float h) {
  float k = fract(h * 7.31);
  return k < 0.4 ? vec3(0.36, 0.95, 1.0) : k < 0.6 ? vec3(0.24, 0.55, 1.0) : k < 0.75 ? vec3(0.71, 0.42, 1.0) : k < 0.9 ? vec3(1.0, 0.31, 0.85) : vec3(1.0, 0.81, 0.23);
}
void main() {
  float y = vUv.y * 2.2 + vWin.x;
  float k = floor(y);
  float h = fract(sin(k * 91.73) * 4375.85);
  vec2 q = vec2((vUv.x - 0.5) * 2.2, fract(y) - 0.5);
  float blur = vWin.y;
  q.y /= 1.0 + blur * 2.2;
  float d = ghost(q, h);
  float fill = smoothstep(0.04 + blur * 0.1, -0.02, d);
  float rim = smoothstep(0.025 + blur * 0.08, 0.0, abs(d + 0.012));
  // kept dim, so a spinning socket never looks like a full one
  vec3 c = mix(vTint, tone(h), 0.6);
  vec3 col = c * (fill * 0.13 + rim * 0.42);
  // streaks of light smeared by the speed, and a payline across the middle
  col += vTint * 0.12 * blur * smoothstep(0.55, 0.0, abs(q.x)) * (0.6 + 0.4 * sin(vUv.y * 40.0 + vWin.x * 9.0));
  col += vTint * 0.16 * exp(-pow((vUv.y - 0.5) * 26.0, 2.0)) * vWin.z;
  // darker towards the top and bottom, like a drum behind glass
  float drum = 0.35 + 0.65 * sin(vUv.y * 3.14159);
  float edge = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  col = (col * drum * vWin.z + vec3(0.75, 0.85, 1.0) * vWin.w * 0.45) * edge;
  gl_FragColor = vec4(col, 1.0);
}`

/** the energy column in a held tube: light flowing up the middle, brighter at the core */
const BEAM_VERT = /* glsl */ `
attribute vec4 aBeam;
varying vec2 vUv;
varying vec4 vBeam;
void main() {
  vUv = uv;
  vBeam = aBeam;
  gl_Position = aBeam.w < 0.002 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vBeam;
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  float core = exp(-x * x * 5.0);
  float flow = 0.5 + 0.5 * sin(vUv.y * 22.0 - uTime * 10.0 + sin(vUv.y * 6.0 + uTime * 2.3) * 1.6 + x * 2.5);
  float flow2 = 0.5 + 0.5 * sin(vUv.y * 37.0 - uTime * 14.0 - x * 4.0);
  float a = core * (0.35 + 0.65 * pow(flow, 3.0)) + exp(-x * x * 30.0) * 0.6 + core * pow(flow2, 6.0) * 0.5;
  a *= smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
  gl_FragColor = vec4(vBeam.rgb * a * vBeam.w, 1.0);
}`

/* ------------------------------------------------------------------ */
/*  Billboards: rings, glows, steam and coin ghosts                     */
/* ------------------------------------------------------------------ */

interface Bill {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** size from s0 to s1 over its life */
  s0: number
  s1: number
  a: number
  t: number
  life: number
  c: THREE.Color
  rot: number
  spin: number
  grav: number
  drag: number
  /** 0 ring: grows fast and fades out; 1 puff: grows, fades in and out; 2 held: steady, moved by its owner;
   *  3 shockwave: grows at a steady speed and fades out */
  kind: 0 | 1 | 2 | 3
  stretch: number
}

class Billboards {
  readonly mesh: THREE.InstancedMesh
  readonly list: Bill[] = []
  private readonly tint: THREE.InstancedBufferAttribute
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()

  constructor(map: THREE.Texture, private readonly cap: number, additive: boolean, order: number) {
    const geo = new THREE.PlaneGeometry(1, 1)
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aTint', this.tint)
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: BILL_VERT,
      fragmentShader: BILL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = order
  }

  emit(o: Partial<Bill>): Bill {
    if (this.list.length >= this.cap) this.list.shift()
    const b: Bill = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.2, s1: 1, a: 1, t: 0, life: 0.5, c: new THREE.Color(1, 1, 1), rot: 0, spin: 0, grav: 0, drag: 0, kind: 0, stretch: 1, ...o }
    b.c = b.c.clone()
    this.list.push(b)
    return b
  }

  /** a ring growing from size r0 to r1 (diameters) while it fades */
  ring(at: THREE.Vector3, c: THREE.Color, r0: number, r1: number, life: number) {
    return this.emit({ x: at.x, y: at.y, z: at.z, s0: r0, s1: r1, life, c, kind: 0 })
  }

  update(dt: number) {
    let n = 0
    for (const b of this.list) {
      b.t += dt
      if (b.t >= b.life) continue
      const k = b.t / b.life
      const dk = Math.max(0, 1 - b.drag * dt)
      b.vx *= dk
      b.vy = b.vy * dk + b.grav * dt
      b.vz *= dk
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.z += b.vz * dt
      b.rot += b.spin * dt
      let s = b.s0
      let a = b.a
      if (b.kind === 0) {
        s = b.s0 + (b.s1 - b.s0) * ease(k)
        a = b.a * (1 - k) ** 1.5
      } else if (b.kind === 3) {
        s = b.s0 + (b.s1 - b.s0) * k
        a = b.a * (1 - k) ** 1.2
      } else if (b.kind === 1) {
        s = b.s0 + (b.s1 - b.s0) * (1 - (1 - k) ** 2)
        a = b.a * Math.min(1, k * 6) * (1 - k) ** 1.3
      }
      this.q.setFromAxisAngle(Z, b.rot)
      this.mesh.setMatrixAt(n, this.m.compose(this.p.set(b.x, b.y, b.z), this.q, this.s.set(s, s * b.stretch, 1)))
      this.tint.setXYZW(n, b.c.r, b.c.g, b.c.b, a)
      this.list[n++] = b
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
/*  Floating labels: ×2, +5, GOLD!                                      */
/* ------------------------------------------------------------------ */

interface Floater {
  sprite: THREE.Sprite
  t: number
  life: number
  at: THREE.Vector3
  size: number
  rise: number
}

/** a drawn label, shared by every floater showing the same text in the same colour */
interface Label {
  tex: THREE.CanvasTexture
  used: number
}

class Floaters {
  readonly group = new THREE.Group()
  private readonly pool: Floater[] = []
  /** labels drawn so far (a boost puts the same +5 on twenty cells at once: drawn and uploaded once) */
  private readonly labels = new Map<string, Label>()
  private stamp = 0

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.label('1', '#ffffff').tex, transparent: true, depthTest: false, depthWrite: false, color: new THREE.Color(0.92, 0.92, 0.92) })
      const sprite = new THREE.Sprite(mat)
      sprite.renderOrder = 14
      sprite.visible = false
      this.group.add(sprite)
      this.pool.push({ sprite, t: 1, life: 1, at: new THREE.Vector3(), size: 1, rise: 0.5 })
    }
  }

  get active() {
    return this.pool.some((f) => f.t < f.life)
  }

  /** the texture for a label, drawn on first use; the least recently used ones are dropped past 40 */
  private label(text: string, color: string): Label {
    const key = text + '|' + color
    let l = this.labels.get(key)
    if (l) {
      l.used = ++this.stamp
      return l
    }
    if (this.labels.size >= 40) {
      const showing = new Set(this.pool.filter((f) => f.t < f.life).map((f) => f.sprite.material.map))
      let old: string | null = null
      let oldest = Infinity
      for (const [k, v] of this.labels)
        if (v.used < oldest && !showing.has(v.tex)) {
          oldest = v.used
          old = k
        }
      if (old) {
        this.labels.get(old)!.tex.dispose()
        this.labels.delete(old)
      }
    }
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 128
    const g = c.getContext('2d')!
    let fs = 88
    g.font = `800 ${fs}px Manrope, system-ui, sans-serif`
    while (g.measureText(text).width > 222 && fs > 30) {
      fs -= 6
      g.font = `800 ${fs}px Manrope, system-ui, sans-serif`
    }
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    // a soft halo in the label's colour (wide translucent strokes rather than a canvas blur, which is slow)
    g.strokeStyle = color
    for (const [w, a] of [
      [fs * 0.5, 0.12],
      [fs * 0.34, 0.2],
    ]) {
      g.globalAlpha = a
      g.lineWidth = w
      g.strokeText(text, 128, 68)
    }
    g.globalAlpha = 1
    g.lineWidth = Math.max(8, fs * 0.2)
    g.strokeStyle = 'rgba(6,8,20,0.94)'
    g.strokeText(text, 128, 68)
    const grad = g.createLinearGradient(0, 68 - fs / 2, 0, 68 + fs / 2)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.55, color)
    grad.addColorStop(1, color)
    g.fillStyle = grad
    g.fillText(text, 128, 68)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    l = { tex, used: ++this.stamp }
    this.labels.set(key, l)
    return l
  }

  /** a label popping up at `at` and rising as it fades; size 1 is half a cell tall */
  show(at: THREE.Vector3, text: string, color: string, size = 1, life = 0.95, rise = 0.5) {
    const f = this.pool.reduce((a, b) => (b.t / b.life > a.t / a.life ? b : a))
    f.sprite.material.map = this.label(text, color).tex
    f.t = 0
    f.life = life
    f.at.copy(at)
    f.size = size
    f.rise = rise
    f.sprite.visible = true
    this.place(f)
  }

  private place(f: Floater) {
    const k = f.t / f.life
    const pop = k < 0.18 ? 0.55 + 0.75 * ease(k / 0.18) : 1.3 - 0.3 * smooth(Math.min(1, (k - 0.18) / 0.2))
    const s = f.size * pop
    f.sprite.scale.set(s, s * 0.5, 1)
    f.sprite.position.set(f.at.x, f.at.y + f.rise * ease(k), f.at.z)
    f.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3
  }

  update(dt: number) {
    for (const f of this.pool) {
      if (f.t >= f.life) continue
      f.t = Math.min(f.life, f.t + dt)
      this.place(f)
      if (f.t >= f.life) f.sprite.visible = false
    }
  }

  dispose() {
    for (const f of this.pool) f.sprite.material.dispose()
    for (const l of this.labels.values()) l.tex.dispose()
    this.labels.clear()
  }
}

/** a soft puff of steam or dust */
function puffTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.32)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/** a thin bright ring for shockwaves that cross the whole board */
function thinRingTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0.8, 'rgba(255,255,255,0)')
  grad.addColorStop(0.9, 'rgba(255,255,255,0.35)')
  grad.addColorStop(0.955, 'rgba(255,255,255,1)')
  grad.addColorStop(0.985, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}

/** a ghostly coin stamped with a bolt, for the magnet's pull */
function coinTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const halo = g.createRadialGradient(64, 64, 30, 64, 64, 64)
  halo.addColorStop(0, 'rgba(255,220,120,0.5)')
  halo.addColorStop(1, 'rgba(255,200,80,0)')
  g.fillStyle = halo
  g.fillRect(0, 0, 128, 128)
  const face = g.createRadialGradient(54, 50, 4, 64, 64, 40)
  face.addColorStop(0, '#fff6cf')
  face.addColorStop(0.6, '#ffc94a')
  face.addColorStop(1, '#c47a10')
  g.fillStyle = face
  g.beginPath()
  g.arc(64, 64, 38, 0, TAU)
  g.fill()
  g.lineWidth = 5
  g.strokeStyle = '#fff0b8'
  g.beginPath()
  g.arc(64, 64, 31, 0, TAU)
  g.stroke()
  g.fillStyle = '#8a4e00'
  g.beginPath()
  const bolt = [
    [70, 38],
    [50, 68],
    [62, 68],
    [56, 90],
    [78, 58],
    [66, 58],
  ]
  bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
  g.fill()
  return new THREE.CanvasTexture(c)
}

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

/* ------------------------------------------------------------------ */
/*  Pieces and stage state                                              */
/* ------------------------------------------------------------------ */

/** pieces moving together; the move is over when n reaches 0 */
interface Batch {
  n: number
}

/**
 * idle: standing in its tube or socket; fall: dropping in from above the window; settle: the bounce after it;
 * vacuum: sucked up and out of the top; slam: flying into a socket from the front; appear: zapped into being;
 * vanish: zapped out of it
 */
type PState = 'idle' | 'fall' | 'settle' | 'vacuum' | 'slam' | 'appear' | 'vanish'

interface Piece {
  key: string
  sym: Sym
  gold: boolean
  id: number
  /** bonus symbols: the value on its display */
  value: number
  /** the number on show: it counts from `countFrom` to `value` as countT goes 0 → 1 over countDur seconds */
  shown: number
  countFrom: number
  countT: number
  countDur: number
  /** the number's pop when it changes (1 → 0) and its white flash */
  pop: number
  flashV: number
  /** the text last written for it, and for which value (so a frame builds no strings) */
  text: string
  textV: number
  /** how far it has grown into its socket in the Power Grid (0..1) */
  sockK: number
  root: THREE.Group
  inner: THREE.Group
  model: THREE.Group
  parts: Record<string, THREE.Object3D>
  glow: THREE.Sprite
  col: number
  row: number
  y: number
  z: number
  ty: number
  y0: number
  z0: number
  vy: number
  state: PState
  t: number
  wait: number
  batch: Batch | null
  onArrive: (() => void) | null
  squash: number
  punch: number
  shake: number
  win: number
  winTo: number
  winT: number
  front: number
  frontTo: number
  glowAmt: number
  glowTo: number
  /** a bot winding up to fire */
  charge: number
  phase: number
  face: Expr
  mood: Expr
  moodUntil: number
  blinkAt: number
  blinkEnd: number
  hopAt: number
  hop: number
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

/** one of the 25 charging sockets */
interface Sock {
  /** how lit its rim is, easing towards litTo from litAt (scene time) on */
  lit: number
  litTo: number
  litAt: number
  /** a white flash on the rim, fading */
  flash: number
  latch: number
  latchTo: number
  /** its slot window: spinning, when it shuts (Infinity while it spins), the scroll, how far it has shut */
  spin: boolean
  stopAt: number
  off: number
  shut: number
  hit: boolean
  /** the rim colour last written (rgb × intensity) */
  rim: [number, number, number]
  /** the backlight last written (rgb × intensity), and the housing's brightness (eased, and last written) */
  glow: [number, number, number]
  tint: number
  tintW: number
}

interface Flight {
  from: THREE.Vector3
  ctrl: THREE.Vector3
  to: THREE.Vector3
  t: number
  dur: number
  bill: Bill | null
  color: THREE.Color
  /** sparks shed per second along the way */
  trail: number
  /** orbs can be cut short by hurry() */
  orb: boolean
  done: () => void
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

type Act = HostAction | 'point' | 'surge'
const ACT_DUR: Record<Act, number> = { cheer: 0.9, dance: 2.4, facepalm: 1.5, gasp: 0.9, nervous: 1.3, wave: 1.3, clap: 1.0, shrug: 1.1, lever: 0.6, magnet: 1.2, zap: 0.8, point: 0.9, surge: 1.4 }

interface ActState {
  kind: Act
  t: number
  dur: number
  /** where a point, a zap or the surge aims */
  at: THREE.Vector3 | null
  /** which claw leads (0 left, 1 right) */
  side: number
  /** the lever's clunk has sounded */
  fired: boolean
}

/** Volt's body for one frame: claw targets (world), how open the claws are, and the rest of him */
interface Pose {
  claw: [THREE.Vector3, THREE.Vector3]
  open: [number, number]
  hop: number
  lean: number
  twist: number
  nod: number
  tilt: number
  yaw: number
  face: Expr | null
  magnet: boolean
  /** how hard the claws follow their targets: 0 smooth, 1 locked on (gripping the lever) */
  snap: number
}

/** a point relative to where Volt stands, laid out for him at DESIGN scale */
const vp = (x: number, y: number, z: number) => new THREE.Vector3(VOLT_AT.x + x * VK, VOLT_AT.y + y * VK, VOLT_AT.z + z * VK)
/** his claws resting on the marquee's top edge (he leans on it: it comes up to his chest) */
const REST_CLAW = [vp(-1.05, 0.78, 0.85), vp(1.05, 0.78, 0.85)]
/** robot dance poses, one per beat: left claw, right claw */
const DANCE: [THREE.Vector3, THREE.Vector3][] = [
  [vp(-1.35, 1.9, 0.25), vp(1.6, 0.85, 0.55)],
  [vp(-1.6, 0.85, 0.55), vp(1.35, 1.9, 0.25)],
  [vp(-1.35, 1.9, 0.25), vp(1.6, 0.85, 0.55)],
  [vp(-1.6, 0.85, 0.55), vp(1.35, 1.9, 0.25)],
  [vp(-0.55, 1.1, 1.2), vp(0.55, 1.1, 1.2)],
  [vp(-1.25, 2.05, 0.05), vp(1.25, 2.05, 0.05)],
  [vp(-0.55, 1.1, 1.2), vp(0.55, 1.1, 1.2)],
  [vp(-1.25, 2.05, 0.05), vp(1.25, 2.05, 0.05)],
]

/* ------------------------------------------------------------------ */
/*  The scene                                                           */
/* ------------------------------------------------------------------ */

export class RoboScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** Volt's lever hits the bottom of its pull (the clunk); the tubes start sucking right after */
  onLever?: () => void
  /** a tube starts sucking its robots out */
  onVacuum?: (col: number) => void
  /** a dropped column came to rest; syms top to bottom */
  onLand?: (col: number, syms: Sym[]) => void
  /** a bonus symbol came to rest in a drop: its id and how many have landed so far in this drop */
  onBonusLand?: (id: number, n: number) => void
  /** a spinning socket shut, empty or with an arrival */
  onSpinStop?: (pos: number, landed: boolean) => void
  /** a socket's latches clamped on a cell (Power Grid starts and arrivals) */
  onClamp?: (pos: number, cell: Cell) => void
  onCoin?: () => void
  thumbs: Partial<Record<ThumbKey, string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 90)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
  private readonly key: THREE.DirectionalLight
  private readonly rim: THREE.DirectionalLight
  private readonly rim2: THREE.DirectionalLight
  private readonly ambient: THREE.AmbientLight
  private readonly beaconLight: THREE.PointLight

  private readonly pool = new Map<string, Piece[]>()
  private readonly live = new Set<Piece>()
  private readonly byId = new Map<number, Piece>()

  // the stage
  private readonly backMat: THREE.ShaderMaterial
  private readonly machine: MachineRig
  private readonly volt: HostRig
  private readonly lever: LeverRig
  private readonly glassMat: THREE.MeshPhysicalMaterial
  private readonly glassRim: THREE.Color
  private readonly glassEnv: number
  private readonly tubeNeon: THREE.MeshBasicMaterial[]
  private readonly lettersMat: THREE.MeshBasicMaterial
  private readonly beamMesh: THREE.InstancedMesh
  private readonly beamAttr: THREE.InstancedBufferAttribute
  private readonly beamMat: THREE.ShaderMaterial
  private readonly dimMat: THREE.MeshBasicMaterial
  private readonly dimMesh: THREE.Mesh
  private readonly shadows: THREE.InstancedMesh
  private readonly blackMat: THREE.ShaderMaterial
  private readonly flashMat: THREE.ShaderMaterial
  private readonly overlays: THREE.Mesh[] = []

  // the Power Grid
  private readonly sockets: SocketField
  private readonly winMesh: THREE.InstancedMesh
  private readonly winAttr: THREE.InstancedBufferAttribute
  private readonly winTint: THREE.InstancedBufferAttribute
  private readonly socks: Sock[] = []
  /** what each socket holds in the Power Grid */
  private readonly board: (Piece | null)[] = new Array<Piece | null>(CELLS).fill(null)
  private inGrid = false
  /** the sockets out (1) or back behind the tubes (0) */
  private sock = 0
  private sockTo = 0
  private heart = false
  private fullOn = false

  // effects
  private readonly sparks = new Sparks(2400)
  private readonly arcs = new Arcs(48, 18)
  private readonly wayArcs = new Arcs(64, 10)
  private readonly rings: Billboards
  private readonly glows: Billboards
  private readonly puffs: Billboards
  private readonly ghosts: Billboards
  private readonly waves: Billboards
  private readonly floaters = new Floaters(28)
  /** the big value numbers on every bonus symbol */
  private readonly labels = new ValueLabels(200)
  private readonly gears: Bits
  private readonly bolts: Bits
  private readonly nuts: Bits
  private readonly coins: Bits
  private flights: Flight[] = []
  private rockets: Rocket[] = []
  /** scene-time timers: promises from wait(), and jobs from after(), which are dropped on dispose */
  private timers: { at: number; fn: () => void; job: boolean }[] = []
  private conds: { test: () => boolean; fn: () => void }[] = []
  /** links between the winners on neighbouring reels, crackling while a win shows */
  private links: { a: Piece; b: Piece; c: THREE.Color }[] = []
  private linkAt = 0

  // Volt
  private act: ActState | null = null
  private readonly claw = [new THREE.Vector3(), new THREE.Vector3()]
  private readonly open = [0.3, 0.3]
  private readonly body = { hop: 0, lean: 0, twist: 0, nod: 0, tilt: 0, yaw: 0 }
  private look: { at: THREE.Vector3; until: number } | null = null
  private glanceAt = 4
  private glance = new THREE.Vector2()
  private hostFace: Expr = 'idle'
  private hostBlinkAt = 2
  private hostBlinkEnd = 0
  private hostTint = ''
  private moodFace: { e: Expr; until: number } | null = null
  /** when anything last happened; Volt dozes off after a while */
  private awake = 0
  private zzzAt = 0
  private leverAngle = LEVER_REST
  private leverSpring = -1
  private beacon = 0
  private surgeSide = 0
  private surgeKick = 0

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private readonly quality = new PacedQuality()
  private drewLast = false
  private frame = 0
  private dist = 20
  private camY = CAM_Y
  private raf = 0
  private last = 0
  private acc = 0
  /** scene time (runs at the scene speed) and real time */
  private time = 0
  private clock = 0
  private base = 1
  private hurryK = 1
  private chain = 1
  private alert = 0
  private alertTo = 0
  private hot = 0
  private hotTo = 0
  private black = 0
  private blackTo = 0
  private flashA = 0
  private dim = 0
  private dimTo = 0
  private tease = 0
  private teaseTo = 0
  /** the held tubes of a drop, and the first one still waiting */
  private teaseCols: number[] = []
  private readonly tubeFlash = new Array<number>(COLS).fill(0)
  private readonly tubeTease = new Array<number>(COLS).fill(0)
  private readonly tubeWin = new Array<THREE.Color | null>(COLS).fill(null)
  private readonly btnFlash = new Array<number>(COLS).fill(0)
  private readonly tubeBase = new THREE.Color()
  private readonly tubeCol = new THREE.Color()
  private readonly tubeTmp = new THREE.Color()
  private needle = 0.2
  private needleV = 0
  private needleTo = 0.2
  private needleKick = 0
  private shake = 0
  private push = 0
  private pushTo = 0
  private readonly pushAt = new THREE.Vector3()
  // scratch objects for the frame loop, so a frame allocates next to nothing
  private readonly camAt = new THREE.Vector3()
  private readonly camAim = new THREE.Vector3()
  private readonly beaconAt = new THREE.Vector3()
  private readonly floorAt = new THREE.Vector3()
  private readonly flyAt = new THREE.Vector3()
  private readonly sockCol = new THREE.Color()
  private readonly sockGlow = new THREE.Color()
  private readonly shadowM = new THREE.Matrix4()
  private shower = 0
  private coinAt = 0
  private pulse = 0
  private boltFlash = 0
  private boltX = 0
  private boltAt = 3
  private crawlAt = 0
  private flickerAt = 6
  private flicker = 0
  private steamAt = 0
  private bonusN = 0
  private readonly pointer = new THREE.Vector2()
  private readonly lookCam = new THREE.Vector2()
  private disposed = false
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void

  constructor(private readonly el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.localClippingEnabled = true
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none'
    el.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.85)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // the reflections every PBR material in the models uses, made once for this renderer
    useEnvironment(this.renderer)
    const lights = makeLights()
    this.key = lights.getObjectByName('key') as THREE.DirectionalLight
    this.rim = lights.getObjectByName('rim') as THREE.DirectionalLight
    this.rim2 = lights.getObjectByName('rim2') as THREE.DirectionalLight
    this.ambient = lights.getObjectByName('ambient') as THREE.AmbientLight
    // the light thrown by Volt's beacon in the alarm; always there (at 0 when off) so no shader recompiles
    this.beaconLight = new THREE.PointLight(RED, 0, 9, 1.4)
    this.scene.add(lights, this.beaconLight)

    // the workshop
    this.backMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlert: { value: 0 },
        uAspect: { value: 1 },
        uBeacon: { value: new THREE.Vector2(0, 0.45) },
        uBeamA: { value: 0 },
        uFlash: { value: 0 },
        uBoltX: { value: 0 },
        uPulse: { value: 0 },
        uHot: { value: 0 },
        uFloor: { value: -0.36 },
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

    // the machine, Volt behind its marquee and his lever
    this.machine = buildMachine({ cols: COLS, rows: ROWS, cell: 1 })
    this.scene.add(this.machine.root)
    this.glassMat = this.machine.tubes[0].glass.material as THREE.MeshPhysicalMaterial
    this.glassRim = (this.glassMat.userData.rim as { value: THREE.Color }).value.clone()
    this.glassEnv = this.glassMat.envMapIntensity
    this.tubeNeon = this.machine.tubes.map((t) => t.neon.material as THREE.MeshBasicMaterial)
    this.lettersMat = this.machine.letters.material as THREE.MeshBasicMaterial
    this.volt = buildHost()
    this.volt.root.position.copy(VOLT_AT)
    this.volt.root.scale.setScalar(VOLT_SCALE)
    this.scene.add(this.volt.root)
    this.lever = buildLever()
    this.lever.root.position.copy(LEVER_AT)
    this.lever.root.scale.set(-LEVER_SCALE, LEVER_SCALE, LEVER_SCALE)
    this.lever.arm.rotation.z = LEVER_REST
    this.scene.add(this.lever.root)
    for (const o of [this.machine.root, this.volt.root, this.lever.root]) this.own.push({ dispose: () => disposeTree(o) })
    for (let s = 0; s < 2; s++) this.claw[s].copy(REST_CLAW[s])

    // the energy columns that rise in held tubes
    const beamGeo = new THREE.PlaneGeometry(0.84, 5.15)
    this.beamAttr = new THREE.InstancedBufferAttribute(new Float32Array(COLS * 4), 4).setUsage(THREE.DynamicDrawUsage)
    beamGeo.setAttribute('aBeam', this.beamAttr)
    this.beamMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    this.beamMesh = new THREE.InstancedMesh(beamGeo, this.beamMat, COLS)
    const m = new THREE.Matrix4()
    for (let c = 0; c < COLS; c++) this.beamMesh.setMatrixAt(c, m.makeTranslation(cellX(c), 0, -0.12))
    this.beamMesh.frustumCulled = false
    this.beamMesh.renderOrder = 4
    this.beamMesh.visible = false
    this.scene.add(this.beamMesh)
    this.own.push(beamGeo, this.beamMat, this.beamMesh)

    // the dimmer in front of the tubes while a win shows off
    this.dimMat = new THREE.MeshBasicMaterial({ color: '#03040b', transparent: true, opacity: 0, depthWrite: false })
    const dimGeo = new THREE.PlaneGeometry(COLS + 0.25, ROWS * 1 + 0.3)
    this.dimMesh = new THREE.Mesh(dimGeo, this.dimMat)
    this.dimMesh.position.z = Z_DIM
    this.dimMesh.renderOrder = 2
    this.dimMesh.visible = false
    this.scene.add(this.dimMesh)
    this.own.push(dimGeo, this.dimMat)

    // a soft contact shadow behind every robot, on the back of its tube
    const shGeo = new THREE.PlaneGeometry(1, 1)
    this.shadows = new THREE.InstancedMesh(shGeo, shadowMaterial(), 64)
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.shadows.count = 0
    this.shadows.frustumCulled = false
    this.shadows.renderOrder = 1
    this.scene.add(this.shadows)
    this.own.push(shGeo, this.shadows)

    // the 25 charging sockets, waiting behind the tubes, each with its slot window
    const at: THREE.Vector3[] = []
    for (let pos = 0; pos < CELLS; pos++) at.push(V3(cellX(colOf(pos)), cellY(rowOf(pos)), 0))
    this.sockets = new SocketField(at, 1)
    this.sockets.root.position.z = SOCK_BACK
    this.sockets.root.visible = false
    this.scene.add(this.sockets.root)
    this.own.push(this.sockets)
    const winGeo = new THREE.PlaneGeometry(0.74, 0.74)
    this.winAttr = new THREE.InstancedBufferAttribute(new Float32Array(CELLS * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.winTint = new THREE.InstancedBufferAttribute(new Float32Array(CELLS * 3), 3).setUsage(THREE.DynamicDrawUsage)
    winGeo.setAttribute('aWin', this.winAttr)
    winGeo.setAttribute('aTint', this.winTint)
    const winMat = new THREE.ShaderMaterial({ vertexShader: WIN_VERT, fragmentShader: WIN_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    this.winMesh = new THREE.InstancedMesh(winGeo, winMat, CELLS)
    for (let pos = 0; pos < CELLS; pos++) {
      this.winMesh.setMatrixAt(pos, m.makeTranslation(at[pos].x, at[pos].y, -0.015))
      this.winTint.setXYZ(pos, CYAN.r, CYAN.g, CYAN.b)
      this.socks.push({ lit: 0, litTo: 0, litAt: 0, flash: 0, latch: 0, latchTo: 0, spin: false, stopAt: Infinity, off: 0, shut: 1, hit: false, rim: [-1, -1, -1], glow: [-1, -1, -1], tint: 0.5, tintW: -1 })
    }
    this.winMesh.frustumCulled = false
    this.winMesh.renderOrder = 3
    this.sockets.root.add(this.winMesh)
    this.own.push(winGeo, winMat, this.winMesh)

    // full-screen layers: the blackout as the alarm hits, and the flash of big moments
    this.blackMat = overlayMaterial('#05020a', THREE.NormalBlending)
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

    // effects
    const puffTex = puffTexture()
    const coinTex = coinTexture()
    this.rings = new Billboards(ringTexture(), 96, true, 9)
    this.glows = new Billboards(glowTexture(), 96, true, 9)
    this.puffs = new Billboards(puffTex, 160, false, 8)
    this.ghosts = new Billboards(coinTex, 64, true, 12)
    const waveTex = thinRingTexture()
    this.waves = new Billboards(waveTex, 16, true, 9)
    this.own.push(puffTex, coinTex, waveTex, this.rings, this.glows, this.puffs, this.ghosts, this.waves, this.floaters, this.sparks, this.arcs, this.wayArcs, this.labels)
    // the numbers are clipped to the tubes' window like the pieces they sit on
    this.labels.clip = WIN_H
    this.scene.add(this.labels.group)
    const bits = bitGeometries()
    const metal = bitMaterial()
    this.gears = new Bits(bits.gear, metal, 160, false)
    this.bolts = new Bits(bits.bolt, metal, 160, false)
    this.nuts = new Bits(bits.nut, metal, 120, false)
    this.coins = new Bits(bits.coin, metal, 240, false)
    for (const b of [this.gears, this.bolts, this.nuts, this.coins]) {
      b.mesh.renderOrder = 9
      // the material is the models' shared one (disposeModels frees it); only the geometry and mesh are ours
      this.own.push(b.mesh.geometry, b.mesh)
    }
    this.sparks.points.renderOrder = 10
    this.arcs.mesh.renderOrder = 11
    this.wayArcs.mesh.renderOrder = 6
    this.scene.add(this.sparks.points, this.arcs.mesh, this.wayArcs.mesh, this.rings.mesh, this.glows.mesh, this.puffs.mesh, this.ghosts.mesh, this.waves.mesh, this.floaters.group)
    this.scene.add(this.gears.mesh, this.bolts.mesh, this.nuts.mesh, this.coins.mesh)

    this.onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = cv.getBoundingClientRect()
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
    }
    this.onLeave = () => this.pointer.set(0, 0)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerleave', this.onLeave)

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
    this.clip(shadowMaterial())
    await step(0.4)
    if (this.disposed) return
    // one of everything, out of sight, so every shader is compiled before the first spin
    const warm = new THREE.Group()
    const temp: Piece[] = []
    const all: [Sym, boolean][] = [...(['rex', 'dot', 'clank', 'zip', 'nut', 'gear', 'battery', 'chip', 'wild', 'cell', 'magnet', 'zap', 'boost'] as Sym[]).map((s): [Sym, boolean] => [s, false]), ...BOTS.map((s): [Sym, boolean] => [s, true])]
    for (const [sym, gold] of all) {
      const p = this.acquire({ id: -1, sym, value: 5, gold })
      p.glow.visible = true
      p.root.position.set(cellX(temp.length % COLS), 0, 0)
      temp.push(p)
      this.scene.remove(p.root)
      warm.add(p.root)
    }
    warm.position.set(0, 0, -30)
    this.scene.add(warm)
    const hidden: THREE.Object3D[] = [this.sockets.root, this.beamMesh, this.dimMesh, this.volt.magnet, ...this.overlays]
    for (const o of hidden) o.visible = true
    const far = V3(0, 0, -30)
    for (const b of [this.gears, this.bolts, this.nuts, this.coins]) {
      b.emit(far, V3(), new THREE.Color(), 1, 0.01, 0)
      b.update(0)
    }
    this.sparks.emit(0, 0, -30, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.sparks.update(0)
    for (const b of [this.rings, this.glows, this.puffs, this.ghosts, this.waves]) {
      b.emit({ x: 0, y: 0, z: -30, life: 0.01 })
      b.update(0)
    }
    this.arcs.emit(far, V3(1, 0, -30), '#ffffff', { life: 0.01 })
    this.arcs.update(0)
    this.wayArcs.emit(far, V3(1, 0, -30), '#ffffff', { life: 0.01 })
    this.wayArcs.update(0)
    this.floaters.show(far, '1', '#ffffff')
    this.labels.begin()
    this.labels.add('1×', 0, 0, -30, 0.2, 1, WHITE)
    this.labels.end()
    this.shadows.count = 1
    try {
      // for the target the scene is drawn into (the composer's linear, untoned buffer), not the canvas
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
    this.shadows.count = 0
    this.labels.begin()
    this.labels.end()
    this.scene.remove(warm)
    for (const p of temp) {
      warm.remove(p.root)
      this.release(p)
    }
    this.floaters.update(10)
    // a stock of pieces built ahead (about 150 ms), so no round stops to build one
    const stock: [Sym, number, boolean][] = [
      ['rex', 6, false],
      ['dot', 6, false],
      ['clank', 6, false],
      ['zip', 6, false],
      ['nut', 8, false],
      ['gear', 8, false],
      ['battery', 8, false],
      ['chip', 8, false],
      ['wild', 5, false],
      ['cell', 12, false],
      ['magnet', 3, false],
      ['zap', 3, false],
      ['boost', 3, false],
      ['magnet', 1, true],
      ['zap', 1, true],
      ['boost', 1, true],
    ]
    for (const [sym, n, gold] of stock) {
      const key = gold ? `${sym}-gold` : sym
      const list = this.pool.get(key) ?? []
      while (list.length < n) list.push(this.make(key, sym, gold))
      this.pool.set(key, list)
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

  /** small transparent pictures of each symbol (happy faces, bonus symbols with a value), the gold bots and Volt */
  private makeThumbs() {
    const r = this.renderer
    const cv = r.domElement
    const size = Math.floor(Math.min(160, cv.width / 4, cv.height / 3))
    if (size < 40) return {}
    const ts = new THREE.Scene()
    ts.add(makeLights())
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20)
    const out = document.createElement('canvas')
    out.width = out.height = size
    const g = out.getContext('2d')!
    const css = size / this.dpr
    const res: Partial<Record<ThumbKey, string>> = {}
    const clear = r.getClearColor(new THREE.Color())
    const alpha = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    r.setScissorTest(true)
    r.setViewport(0, 0, css, css)
    r.setScissor(0, 0, css, css)
    const shoot = (o: THREE.Object3D, name: ThumbKey) => {
      ts.add(o)
      r.clear()
      r.render(ts, cam)
      g.clearRect(0, 0, size, size)
      g.drawImage(cv, 0, cv.height - size, size, size, 0, 0, size, size)
      res[name] = out.toDataURL('image/png')
      ts.remove(o)
    }
    cam.position.set(0, 0, 2.5)
    cam.lookAt(0, 0, 0)
    const sample: Partial<Record<Sym, number>> = { cell: 5, magnet: 25, zap: 2, boost: 3 }
    const shots: [Sym, boolean, ThumbKey][] = [
      ...(['rex', 'dot', 'clank', 'zip', 'nut', 'gear', 'battery', 'chip', 'wild', 'cell', 'magnet', 'zap', 'boost'] as Sym[]).map((s): [Sym, boolean, ThumbKey] => [s, false, s]),
      ['magnet', true, 'magnetGold'],
      ['zap', true, 'zapGold'],
      ['boost', true, 'boostGold'],
    ]
    // the bonus symbols' numbers, written as on the board
    const tl = new ValueLabels(8)
    ts.add(tl.group)
    for (const [s, gold, name] of shots) {
      const v = sample[s] ?? (gold ? 10 : undefined)
      const o = previewSymbol(s, 'happy', v, gold)
      tl.begin()
      if (v !== undefined) {
        const a = valueAnchor(s)
        tl.add(valueText(v), 0, a.y, a.z, a.size, a.maxW, colorOf(valueColor(v)))
      }
      tl.end()
      shoot(o, name)
      releaseSymbol(o)
    }
    tl.begin()
    tl.end()
    ts.remove(tl.group)
    tl.dispose()
    // Volt from the waist up, borrowed from the stage for a moment at his modelled size
    const root = this.volt.root
    root.position.set(0, 0, 0)
    root.scale.setScalar(1)
    cam.position.set(0.1, 1.2, 3.3)
    cam.lookAt(0, 1.18, 0)
    shoot(root, 'host')
    root.position.copy(VOLT_AT)
    root.scale.setScalar(VOLT_SCALE)
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
    // the counters under the machine need about HUD_PX whatever the size, so a short stage shows a little more below
    const fitH = Math.max(FIT_H, (VIEW_TOP - this.machine.size.bottom) / Math.max(0.5, 1 - HUD_PX / h))
    this.dist = Math.max(fitH / 2 / tan, FIT_W / 2 / (tan * this.camera.aspect))
    // the top of the view stays put; any height to spare goes under the machine
    this.camY = VIEW_TOP - tan * this.dist
    this.placeCamera()
    this.sparks.mat.uniforms.scale.value = (h * this.dpr) / (2 * tan)
    this.backMat.uniforms.uAspect.value = w / h
    if (this.raf) this.composer.render()
  }

  private placeCamera() {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const k = smooth(this.push) * 0.08
    const at = this.camAt.set(this.lookCam.x * 0.3 + sx, this.camY - this.lookCam.y * 0.2 + sy, this.dist)
    const aim = this.camAim.set(sx * 0.5, this.camY + sy * 0.5, 0)
    this.camera.position.copy(at.lerp(this.pushAt, k))
    this.camera.lookAt(aim.lerp(this.pushAt, k * 4))
  }

  /* ---------------- clock ---------------- */

  private get speed() {
    return this.base * this.hurryK * this.chain
  }

  setTurbo(on: boolean) {
    this.base = on ? 1.75 : 1
  }

  /** the player is impatient: run the rest of the round three times as fast, skip tease holds and orb flights */
  hurry() {
    this.hurryK = 3
    this.teaseTo = 0
    for (const p of this.live) if (p.state === 'fall' && p.wait > 0.1) p.wait = Math.min(p.wait, 0.04 + p.col * 0.03)
    for (const f of this.flights) if (f.orb) f.t = 1
  }

  /** back to normal speed after a round */
  calm() {
    this.hurryK = 1
    this.chain = 1
  }

  get hurried() {
    return this.hurryK > 1
  }

  /** extra speed for long Power Grids, 1..2 */
  setChain(k: number) {
    this.chain = Math.min(2, Math.max(1, k))
  }

  /** Overclock (the ante): the tubes run hot orange and the room glows behind the machine */
  setOverclock(on: boolean) {
    this.hotTo = on ? 1 : 0
    this.wake()
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

  private wake() {
    this.awake = this.clock
  }

  /* ---------------- pieces ---------------- */

  private acquire(cell: Cell): Piece {
    const gold = !!cell.gold && (cell.sym === 'magnet' || cell.sym === 'zap' || cell.sym === 'boost')
    const key = gold ? `${cell.sym}-gold` : cell.sym
    let p = this.pool.get(key)?.pop()
    if (!p) p = this.make(key, cell.sym, gold)
    p.id = cell.id
    p.state = 'idle'
    p.win = p.winTo = p.winT = 0
    p.front = p.frontTo = 0
    p.glowAmt = p.glowTo = 0
    p.squash = p.punch = p.shake = p.charge = p.hop = 0
    p.wait = p.t = p.vy = 0
    p.z = p.z0 = 0
    p.batch = null
    p.onArrive = null
    p.phase = Math.random() * 10
    p.moodUntil = 0
    p.blinkAt = this.clock + rnd(0.5, 4)
    p.blinkEnd = 0
    p.hopAt = this.clock + rnd(3, 9)
    if (p.face !== 'idle') {
      p.face = 'idle'
      setFace(p.model, 'idle')
    }
    if (isBonus(cell.sym)) {
      const v = cell.value ?? 1
      if (v !== p.value) writeValue(p.model, v)
      p.value = v
    }
    p.shown = p.countFrom = p.value
    p.countT = 1
    p.countDur = 0
    p.pop = p.flashV = p.sockK = 0
    for (const o of Object.values(p.parts)) {
      const r = o.userData.rest as Rest | undefined
      if (!r) continue
      o.position.set(r.x, r.y, r.z)
      o.rotation.set(r.rx, r.ry, r.rz)
    }
    p.root.visible = true
    p.inner.position.set(0, 0, 0)
    p.inner.rotation.set(0, 0, 0)
    p.inner.scale.setScalar(1)
    this.scene.add(p.root)
    this.live.add(p)
    if (cell.id >= 0) this.byId.set(cell.id, p)
    return p
  }

  private make(key: string, sym: Sym, gold: boolean): Piece {
    const model = buildSymbol(sym, isBonus(sym) ? 1 : undefined, gold)
    model.scale.setScalar(CAST)
    const inner = new THREE.Group()
    inner.add(model)
    const root = new THREE.Group()
    root.add(inner)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: col3(gold ? '#ffc94a' : SYMBOL_COLOR[sym], 1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
    this.clip(glow.material)
    glow.scale.set(1.5, 1.5, 1)
    glow.position.z = -0.32
    glow.renderOrder = 3
    glow.visible = false
    root.add(glow)
    const parts: Record<string, THREE.Object3D> = {}
    for (const n of ['armL', 'armR', 'head', 'arms', 'wheel', 'rotorL', 'rotorR', 'gear', 'cage']) {
      const o = model.getObjectByName(n)
      if (o && o.userData.rest) parts[n] = o
    }
    return {
      key,
      sym,
      gold,
      id: -1,
      value: 1,
      shown: 1,
      countFrom: 1,
      countT: 1,
      countDur: 0,
      pop: 0,
      flashV: 0,
      text: '',
      textV: NaN,
      sockK: 0,
      root,
      inner,
      model,
      parts,
      glow,
      col: 0,
      row: 0,
      y: 0,
      z: 0,
      ty: 0,
      y0: 0,
      z0: 0,
      vy: 0,
      state: 'idle',
      t: 0,
      wait: 0,
      batch: null,
      onArrive: null,
      squash: 0,
      punch: 0,
      shake: 0,
      win: 0,
      winTo: 0,
      winT: 0,
      front: 0,
      frontTo: 0,
      glowAmt: 0,
      glowTo: 0,
      charge: 0,
      phase: 0,
      face: 'idle',
      mood: 'idle',
      moodUntil: 0,
      blinkAt: 0,
      blinkEnd: 0,
      hopAt: 0,
      hop: 0,
    }
  }

  private release(p: Piece) {
    if (!this.live.has(p)) return
    this.scene.remove(p.root)
    this.live.delete(p)
    if (this.byId.get(p.id) === p) this.byId.delete(p.id)
    const at = this.board.indexOf(p)
    if (at >= 0) this.board[at] = null
    this.untrack(p)
    p.onArrive = null
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
    p.z = 0
    p.root.position.set(cellX(col), p.y, 0)
  }

  /** a piece's place on its cell, in front by `dz` */
  private worldOf(p: Piece, dz = 0.3) {
    return V3(cellX(p.col), p.y, p.z + p.front * Z_WIN + dz)
  }

  private cellAt(pos: number, z = 0.3) {
    return V3(cellX(colOf(pos)), cellY(rowOf(pos)), z)
  }

  private pieces(ids: readonly number[]) {
    return ids.map((id) => this.byId.get(id)).filter((p): p is Piece => !!p)
  }

  /** a temporary expression on a piece */
  private moodOf(p: Piece, e: Expr, s: number) {
    p.mood = e
    p.moodUntil = this.clock + s
  }

  /** pieces flying into sockets right now */
  private slamming() {
    for (const p of this.live) if (p.state === 'slam') return true
    return false
  }

  /* ---------------- the base game ---------------- */

  /** places a board at rest, no animation (the opening board, or after a reload) */
  show(grid: Grid) {
    // a scene that is gone does nothing (and builds nothing): the screen's awaits just run through
    if (this.disposed) return
    for (const p of [...this.live]) this.release(p)
    // a fresh start also leaves the Power Grid, if it was in it
    if (this.inGrid || this.sock > 0) {
      this.inGrid = false
      this.board.fill(null)
      this.alert = this.alertTo = 0
      this.sock = this.sockTo = 0
      this.heart = this.fullOn = false
      this.sockets.root.visible = false
      for (const s of this.socks) {
        s.spin = false
        s.lit = s.litTo = 0
      }
    }
    grid.forEach((col, c) => col.forEach((cell, r) => this.place(this.acquire(cell), c, r)))
    this.clearHighlight()
  }

  /**
   * A spin: Volt yanks his lever (unless `lever` is false or the round is hurried), each tube sucks its robots up
   * and out of the top, and the new column drops in and bounces, tube by tube. Tubes from `teaseFrom` on hold back
   * with an energy column rising in them (4+ bonus symbols already show). Resolves when every column has settled.
   * About 1.3 s plain, plus 0.75 s per held tube.
   */
  async drop(grid: Grid, teaseFrom = -1, lever = true) {
    if (this.disposed) return
    this.clearHighlight()
    this.wake()
    this.bonusN = 0
    const batch: Batch = { n: 0 }
    const pull = lever && !this.hurried
    if (pull) this.startAct('lever')
    // the vacuum starts on the lever's clunk
    const t0 = pull ? ACT_DUR.lever * 0.5 : 0
    for (const p of [...this.live]) if (p.state !== 'vacuum' && p.state !== 'vanish') this.vacuum(p, t0 + VAC_GAP * p.col + VAC_ROW * p.row, batch)
    for (let c = 0; c < COLS; c++) this.after(t0 + VAC_GAP * c, () => this.whoosh(c))
    this.teaseCols = []
    grid.forEach((col, c) => {
      const held = teaseFrom >= 0 && c >= teaseFrom && !this.hurried
      const due = t0 + VAC_GAP * c + VAC_CLEAR
      const start = due + (held ? HOLD * (c - teaseFrom + 1) : 0)
      const ps = col.map((cell, r) => {
        const p = this.acquire(cell)
        p.col = c
        p.row = r
        p.ty = cellY(r)
        p.y = p.y0 = p.ty + FALL_H
        p.state = 'fall'
        p.wait = start
        p.t = 0
        p.root.position.set(cellX(c), p.y, 0)
        this.track(p, batch)
        return p
      })
      ps[ROWS - 1].onArrive = () => this.landed(c, ps)
      if (held) this.teaseCols.push(c)
    })
    if (this.teaseCols.length)
      this.after(t0 + VAC_GAP * teaseFrom + VAC_CLEAR * 0.5, () => {
        if (!this.hurried) this.teaseTo = 1
      })
    await this.until(() => batch.n <= 0)
    this.teaseTo = 0
    this.teaseCols = []
  }

  /** a column hit the bottom of its tube */
  private landed(c: number, ps: Piece[]) {
    this.onLand?.(
      c,
      ps.map((p) => p.sym),
    )
    this.tubeFlash[c] = 1
    this.btnFlash[c] = 1
    this.dust(cellX(c))
    for (const p of ps) {
      if (!isBonus(p.sym)) continue
      this.bonusN++
      this.onBonusLand?.(p.id, this.bonusN)
      const at = this.worldOf(p, 0.35)
      this.rings.ring(at, col3(valueColor(p.value), 1.8), 0.3, 1.3, 0.4)
      this.sparks.burst(at, col3(SYMBOL_COLOR[p.sym]), 8, 2.4, 0.16, 0.45)
      p.glowAmt = 1
      p.pop = 0.8
      p.flashV = 0.6
      this.moodOf(p, 'wow', 0.8)
      this.lookAt(at, 0.7)
      if (this.bonusN >= 3) this.hostMood('wow', 0.8)
    }
    const i = this.teaseCols.indexOf(c)
    if (i >= 0) this.teaseCols.splice(i, 1)
    if (c === COLS - 1) this.teaseTo = 0
  }

  /** a tube sucks: steam and sparks blow out of its top */
  private whoosh(c: number) {
    this.onVacuum?.(c)
    const x = cellX(c)
    for (let i = 0; i < 6; i++) this.puffs.emit({ x: x + rnd(-0.25, 0.25), y: WIN_H + 0.1, z: 0.5, vx: rnd(-0.8, 0.8), vy: rnd(1.6, 3.2), s0: 0.2, s1: rnd(0.8, 1.2), a: 0.22, life: rnd(0.45, 0.7), c: col3('#cfe6ff'), kind: 1, drag: 2, spin: rnd(-2, 2) })
    for (let i = 0; i < 5; i++) this.sparks.emit(x + rnd(-0.3, 0.3), WIN_H - 0.2, 0.45, rnd(-0.4, 0.4), rnd(4, 7), 0, col3(this.hot > 0.5 ? '#ffb070' : '#9ff4ff', 2), rnd(0.1, 0.18), rnd(0.25, 0.4), -4, 1)
  }

  /** dust kicked up round the foot of a tube */
  private dust(x: number) {
    const y = -WIN_H + 0.15
    for (let i = 0; i < 8; i++) {
      const s = i % 2 ? 1 : -1
      this.puffs.emit({ x: x + s * rnd(0.05, 0.3), y: y + rnd(-0.05, 0.05), z: 0.42, vx: s * rnd(0.8, 1.8), vy: rnd(0.1, 0.5), s0: 0.15, s1: rnd(0.5, 0.8), a: 0.22, life: rnd(0.4, 0.65), c: col3('#b9b3d6'), kind: 1, drag: 4 })
    }
  }

  private vacuum(p: Piece, delay: number, batch: Batch | null) {
    if (this.byId.get(p.id) === p) this.byId.delete(p.id)
    const at = this.board.indexOf(p)
    if (at >= 0) this.board[at] = null
    p.state = 'vacuum'
    p.wait = delay
    p.vy = 0.5
    p.t = 0
    p.winTo = p.frontTo = p.glowTo = 0
    p.onArrive = null
    if (batch) this.track(p, batch)
  }

  /**
   * Power Surge: Volt charges up and zaps a power cell onto each socket in turn; the robot that was there burns up
   * and the cell pops into being. `onChange(i)` as each lands. About 0.45 + 0.2 per cell + 0.3 s.
   */
  async surge(changes: readonly SurgeChange[], onChange?: (i: number) => void) {
    if (this.disposed) return
    this.wake()
    if (!changes.length) return
    const charge = this.hurried ? 0.15 : 0.45
    const gap = this.hurried ? 0.08 : 0.2
    this.startAct('surge', charge + changes.length * gap + 0.4)
    for (let i = 0; i < 5; i++) this.after((i * charge) / 5, () => this.arcs.emit(this.clawTip(0), this.clawTip(1), '#8ff6ff', { life: 0.16, width: 0.08, jag: 0.4 }))
    for (let i = 0; i < 24; i++)
      this.after((i * charge) / 24, () => {
        const tip = this.clawTip(i % 2)
        const a = rnd(0, TAU)
        this.sparks.emit(tip.x + Math.cos(a) * 0.6, tip.y + Math.sin(a) * 0.6, tip.z, -Math.cos(a) * 3, -Math.sin(a) * 3, 0, col3('#9ff4ff', 2.2), rnd(0.12, 0.2), 0.2, 0, 0)
      })
    await this.wait(charge)
    // the claws come forward over the marquee before the first bolt
    if (this.act?.kind === 'surge') this.act.at = this.cellAt(changes[0].pos, 0.35)
    await this.wait(this.hurried ? 0.04 : 0.12)
    for (let i = 0; i < changes.length; i++) {
      if (this.disposed) return
      const ch = changes[i]
      const to = this.cellAt(ch.pos, 0.35)
      this.surgeSide = i % 2
      this.surgeKick = 1
      if (this.act?.kind === 'surge') this.act.at = to
      // from the claw, kept in front of the marquee so the whole bolt shows
      const from = this.clawTip(this.surgeSide)
      from.z = Math.max(from.z, 0.75)
      this.arcs.emit(from, to, '#6ff3ff', { life: 0.32, width: 0.17, jag: 0.28 })
      this.arcs.emit(from, to, '#ffffff', { life: 0.2, width: 0.07, jag: 0.4 })
      this.impact(to, CYAN, 1)
      this.tubeFlash[colOf(ch.pos)] = 1
      const old = this.byId.get(ch.from.id)
      if (old) this.vanish(old)
      const p = this.acquire(ch.to)
      this.place(p, colOf(ch.pos), rowOf(ch.pos))
      p.state = 'appear'
      p.t = 0
      p.glowAmt = 1
      onChange?.(i)
      await this.wait(gap)
    }
    await this.wait(0.3)
  }

  private vanish(p: Piece) {
    if (this.byId.get(p.id) === p) this.byId.delete(p.id)
    p.state = 'vanish'
    p.t = 0
    p.wait = 0
  }

  /** a piece burns up: a white flash, sparks and bolts in its colour */
  private shatter(p: Piece) {
    const at = this.worldOf(p, 0.25)
    const c = col3(SYMBOL_COLOR[p.sym])
    this.sparks.emit(at.x, at.y, at.z, 0, 0, 0, WHITE_HOT, 0.6, 0.12, 0, 0, 1)
    this.sparks.burst(at, c, 10, 4, 0.14, 0.45)
    for (let i = 0; i < 5; i++) {
      const a = rnd(0, TAU)
      ;(i % 2 ? this.bolts : this.nuts).emit(at, V3(Math.cos(a) * rnd(1.5, 3), Math.sin(a) * rnd(1.5, 3) + 1.5, rnd(1, 3)), c.clone().lerp(new THREE.Color(1, 1, 1), 0.4), rnd(1.6, 2.2), rnd(0.6, 0.9), -9)
    }
  }

  /** a hit lands: a ring, a flash of light and sparks */
  private impact(at: THREE.Vector3, c: THREE.Color, k = 1) {
    this.rings.ring(at, c.clone().multiplyScalar(2), 0.2, 1.4 * k, 0.35)
    this.glows.emit({ x: at.x, y: at.y, z: at.z, s0: 1.1 * k, s1: 1.6 * k, a: 0.55, life: 0.22, c: c.clone().multiplyScalar(1.2), kind: 0 })
    this.sparks.emit(at.x, at.y, at.z + 0.1, 0, 0, 0, WHITE_HOT, 0.45 * k, 0.1, 0, 0, 0.8)
    this.sparks.burst(at, c, Math.round(12 * k), 3.2, 0.17, 0.5)
  }

  /**
   * Winners come forward with happy faces and a glow while the rest dim; electric links crackle between the winners
   * on neighbouring reels and their tubes light in the symbol's colour. Give `pay` (× bet) to swing the gauges.
   */
  async highlight(wins: readonly { sym: PaySym; ids: readonly number[]; pay?: number }[]) {
    if (this.disposed) return
    this.wake()
    this.dimTo = 1
    this.links = []
    this.tubeWin.fill(null)
    let pay = 0
    for (const w of wins) {
      const ps = this.pieces(w.ids)
      const c = col3(SYMBOL_COLOR[w.sym], 1.6)
      const byCol: Piece[][] = Array.from({ length: COLS }, () => [])
      for (const p of ps) {
        p.winTo = 1
        p.frontTo = 1
        p.glowTo = 1
        this.tubeWin[p.col] ??= c
        byCol[p.col].push(p)
      }
      for (let k = 0; k < COLS - 1; k++) for (const a of byCol[k]) for (const b of byCol[k + 1]) if (this.links.length < 48) this.links.push({ a, b, c })
      pay += w.pay ?? 0
    }
    this.linkAt = 0
    if (pay > 0) this.kickNeedles(pay)
    this.hostMood('happy', 1.2)
    this.lookAt(V3(0, -0.5, 0.5), 0.9)
    await this.wait(0.35)
  }

  /** winners settle back and the tubes brighten again */
  clearHighlight() {
    this.dimTo = 0
    this.links = []
    this.tubeWin.fill(null)
    for (const p of this.live) {
      p.winTo = 0
      if (!this.inGrid) p.frontTo = 0
      p.glowTo = 0
    }
  }

  /** every bonus symbol on the board flares (the Power Grid is coming): rings, sparks, a hop, and Volt gasps */
  async flareBonus() {
    if (this.disposed) return
    this.wake()
    for (const p of this.live) {
      if (!isBonus(p.sym) || p.state === 'vacuum' || p.state === 'vanish') continue
      p.frontTo = 1
      p.glowTo = 1
      p.hop = 1
      const at = this.worldOf(p, 0.4)
      this.rings.ring(at, col3(valueColor(p.value), 2), 0.3, 1.6, 0.5)
      this.sparks.burst(at, col3(SYMBOL_COLOR[p.sym]), 14, 3.4, 0.2, 0.6)
      this.moodOf(p, 'cheer', 1.2)
    }
    this.startAct('gasp')
    this.flash('#5cf2ff', 0.25)
    this.tubeFlash.fill(1)
    await this.wait(0.7)
    for (const p of this.live) {
      p.frontTo = 0
      p.glowTo = 0
    }
  }

  /* ---------------- the Power Grid ---------------- */

  /**
   * The switch into the Power Grid: a red flash, the lights cut to red alert and Volt's beacon starts turning;
   * everything that isn't a starting cell is sucked out of the tubes, the glass slides away and the 25 sockets come
   * forward, lighting up from the middle out; starting cells that aren't on the board yet (a buy) slam in, then the
   * latches clamp on every one (onClamp). About 1.6 s plus 0.09 s per cell slammed in.
   */
  async enterGrid(start: readonly Placed[]) {
    if (this.disposed) return
    this.wake()
    this.clearHighlight()
    const keep = new Map(start.map((pl) => [pl.cell.id, pl]))
    this.inGrid = true
    this.board.fill(null)
    this.heart = false
    this.fullOn = false
    this.flash('#ff2a1f', 0.8)
    this.blackTo = 0.55
    this.shake = Math.max(this.shake, 0.4)
    this.startAct('gasp')
    this.after(0.25, () => {
      this.blackTo = 0
      this.alertTo = 1
    })
    const batch: Batch = { n: 0 }
    for (const p of [...this.live]) {
      const pl = keep.get(p.id)
      if (pl && (p.state === 'idle' || p.state === 'appear')) {
        this.board[pl.pos] = p
        p.glowTo = 1
      } else if (p.state !== 'vacuum' && p.state !== 'vanish') this.vacuum(p, 0.15 + VAC_GAP * p.col + VAC_ROW * p.row, batch)
    }
    for (let c = 0; c < COLS; c++) this.after(0.15 + VAC_GAP * c, () => this.whoosh(c))
    await this.wait(0.45)
    if (this.disposed) return
    this.sockets.root.visible = true
    this.sockTo = 1
    for (let pos = 0; pos < CELLS; pos++) {
      const s = this.socks[pos]
      s.latch = s.latchTo = 0
      this.sockets.setLatch(pos, 0)
      s.lit = 0
      s.litTo = 1
      s.litAt = this.time + 0.15 + 0.07 * Math.hypot(colOf(pos) - 2, rowOf(pos) - 2)
      s.spin = false
      s.shut = 1
      s.flash = 0
    }
    await this.wait(0.55)
    if (this.disposed) return
    for (const pl of start) {
      if (this.board[pl.pos]) continue
      this.slam(pl, false)
      await this.wait(this.hurried ? 0.04 : 0.09)
      if (this.disposed) return
    }
    await this.until(() => !this.slamming())
    const gap = this.hurried ? 0.02 : 0.06
    start.forEach((pl, i) => this.after(i * gap, () => this.clamp(pl.pos)))
    await this.wait(start.length * gap + 0.3)
    await this.until(() => batch.n <= 0)
    for (const p of this.board) if (p) p.glowTo = 0
  }

  /**
   * One respin: every empty socket spins like a little slot window, then they shut one after another in board
   * order; where a bonus symbol landed it slams in from the front and the latches clamp (onArrive per arrival,
   * onSpinStop per socket). About 1.1 s plus 0.13 s per arrival.
   */
  async respin(landed: readonly Placed[], onArrive?: (pl: Placed, i: number) => void) {
    if (this.disposed) return
    this.wake()
    const empties: number[] = []
    for (let pos = 0; pos < CELLS; pos++) if (!this.board[pos]) empties.push(pos)
    if (!empties.length) return
    const at = new Map(landed.map((pl, i) => [pl.pos, i]))
    for (const pos of empties) {
      const s = this.socks[pos]
      s.spin = true
      s.stopAt = Infinity
      s.shut = 0
      s.off = Math.random() * 5
      s.hit = false
    }
    await this.wait(this.hurried ? 0.2 : 0.5)
    const gap = Math.min(0.035, 0.4 / empties.length)
    for (const pos of empties) {
      if (this.disposed) return
      const li = at.get(pos)
      const s = this.socks[pos]
      s.stopAt = this.time
      s.hit = li !== undefined
      this.onSpinStop?.(pos, s.hit)
      if (li !== undefined) {
        const pl = landed[li]
        this.slam(pl, true, () => onArrive?.(pl, li))
        await this.wait(this.hurried ? 0.05 : 0.13)
      } else await this.wait(gap)
    }
    await this.until(() => !this.slamming())
    await this.wait(0.15)
  }

  /** a bonus symbol flies into its socket from the front; on impact it squashes, sparks fly and (clampNow) the latches bite */
  private slam(pl: Placed, clampNow: boolean, onArrive?: () => void) {
    const p = this.acquire(pl.cell)
    this.place(p, colOf(pl.pos), rowOf(pl.pos))
    this.board[pl.pos] = p
    p.state = 'slam'
    p.t = 0
    p.wait = 0
    p.z = p.z0 = 2.4
    p.y0 = p.ty + 0.55
    p.y = p.y0
    p.root.position.set(cellX(p.col), p.y, p.z)
    p.onArrive = () => {
      const at = this.worldOf(p, 0.3)
      const c = col3(p.gold ? '#ffc94a' : valueColor(p.value))
      this.rings.ring(at, c.clone().multiplyScalar(2), 0.3, 1.5, 0.35)
      this.glows.emit({ x: at.x, y: at.y, z: at.z, s0: 1.1, s1: 1.6, a: 0.55, life: 0.25, c: c.clone().multiplyScalar(1.2), kind: 0 })
      this.sparks.burst(at, c, 10, 3, 0.16, 0.45)
      this.shake = Math.max(this.shake, 0.18)
      this.socks[pl.pos].flash = 1
      p.glowAmt = 1
      p.pop = 1
      p.flashV = 0.8
      this.moodOf(p, 'wow', 0.6)
      this.lookAt(at, 0.8)
      if (p.gold) {
        this.rings.ring(at, GOLD.clone().multiplyScalar(2.4), 0.4, 2.4, 0.6)
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU
          this.sparks.emit(at.x, at.y, at.z, Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0, GOLD.clone().multiplyScalar(2.4), 0.2, 0.5, 0, 2.5)
        }
        this.floaters.show(at.clone().add(V3(0, 0.3, 0.35)), 'GOLD!', '#ffd56a', 0.95, 1, 0.3)
        this.hostMood('love', 1.2)
      }
      if (clampNow) this.clamp(pl.pos)
      onArrive?.()
    }
  }

  /** a socket's latches clamp down on its cell */
  private clamp(pos: number) {
    const p = this.board[pos]
    const s = this.socks[pos]
    s.latchTo = 1
    s.flash = Math.max(s.flash, 0.8)
    const c = this.cellAt(pos, SOCK_Z + 0.12)
    for (const [dx, dy] of [
      [0, 0.42],
      [0.42, 0],
      [0, -0.42],
      [-0.42, 0],
    ])
      for (let i = 0; i < 3; i++) this.sparks.emit(c.x + dx, c.y + dy, c.z, dx * rnd(3, 6) + rnd(-0.8, 0.8), dy * rnd(3, 6) + rnd(-0.8, 0.8), rnd(0, 2), col3('#ffd9a0', 2.2), rnd(0.08, 0.14), rnd(0.18, 0.3), -6, 1)
    if (p) this.onClamp?.(pos, { id: p.id, sym: p.sym, value: p.value, gold: p.gold || undefined })
  }

  /** a bot's ability, by its kind (see zap, boost and magnet) */
  fire(a: Action, onHit?: (h: Hit, i: number) => void, onPull?: (i: number, value: number) => void) {
    return a.kind === 'zap' ? this.zap(a, onHit) : a.kind === 'boost' ? this.boost(a, onHit) : this.magnet(a, onHit, onPull)
  }

  /** a gold bot fires again: a golden flare and AGAIN! */
  private async goldFlare(p: Piece) {
    const at = this.worldOf(p, 0.35)
    this.rings.ring(at, GOLD.clone().multiplyScalar(2.2), 0.3, 1.9, 0.45)
    this.glows.emit({ x: at.x, y: at.y, z: at.z, s0: 1.2, s1: 2.4, a: 0.8, life: 0.4, c: GOLD.clone().multiplyScalar(1.3), kind: 0 })
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU
      this.sparks.emit(at.x, at.y, at.z, Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0, GOLD.clone().multiplyScalar(2.4), 0.18, 0.45, 0, 2)
    }
    this.floaters.show(at.clone().add(V3(0, 0.3, 0.35)), 'AGAIN!', '#ffd56a', 0.9, 0.9, 0.3)
    p.punch = 1
    this.lookAt(at, 1)
    await this.wait(this.hurried ? 0.1 : 0.3)
  }

  /** the tip a bot fires from: the zap's coil, the boost's dish, the magnet's poles */
  private botTip(p: Piece) {
    const o = this.worldOf(p, 0.12)
    o.y += (p.sym === 'zap' ? 0.44 : p.sym === 'boost' ? 0.36 : 0.3) * CAST
    return o
  }

  /**
   * A zap bot winds up (its coil crackles), then fires a lightning bolt at each target in turn; every hit doubles
   * that cell (its display flips, ×2 pops up). `onHit(hit, i)` per bolt. About 0.4 + 0.28 per bolt (0.3 more for a gold bot).
   */
  async zap(a: Action, onHit?: (h: Hit, i: number) => void) {
    if (this.disposed) return
    this.wake()
    const bot = this.byId.get(a.by)
    if (!bot) {
      a.hits.forEach((h, i) => (this.setValue(h.id, h.to), onHit?.(h, i)))
      return
    }
    if (a.persistent) await this.goldFlare(bot)
    bot.frontTo = 1
    bot.charge = 1
    this.moodOf(bot, 'angry', 3)
    this.lookAt(this.worldOf(bot), 2)
    const wind = this.hurried ? 0.15 : 0.38
    const tip = this.botTip(bot)
    this.glows.emit({ x: tip.x, y: tip.y, z: tip.z, s0: 0.5, s1: 1.4, a: 0.9, life: wind + 0.1, c: col3('#ffe14a', 1.4), kind: 1 })
    for (let i = 0; i < 6; i++)
      this.after((i * wind) / 6, () => {
        const t = this.botTip(bot)
        const g = rnd(0, TAU)
        this.arcs.emit(t, t.clone().add(V3(Math.cos(g) * 0.38, Math.sin(g) * 0.3 + 0.12, 0.1)), '#fff27a', { life: 0.12, width: 0.05, jag: 0.5 })
      })
    await this.wait(wind)
    for (let i = 0; i < a.hits.length; i++) {
      if (this.disposed) return
      const h = a.hits[i]
      const target = this.byId.get(h.id)
      const from = this.botTip(bot)
      const to = target ? this.worldOf(target, 0.25) : from
      this.arcs.emit(from, to, '#ffe94a', { life: 0.28, width: 0.16, jag: 0.3 })
      this.arcs.emit(from, to, '#ffffff', { life: 0.18, width: 0.065, jag: 0.42 })
      this.impact(to, col3('#ffe14a'), 0.9)
      this.flash('#fff6c0', 0.08)
      if (target) {
        target.shake = 1
        this.moodOf(target, 'dizzy', 0.5)
      }
      this.setValue(h.id, h.to)
      this.floaters.show(to.clone().add(V3(0, 0.36, 0.35)), '×2', '#ffe14a', 0.85, 0.85, 0.28)
      bot.punch = 0.6
      onHit?.(h, i)
      await this.wait(this.hurried ? 0.1 : 0.28)
    }
    bot.frontTo = 0
    bot.charge = 0
  }

  /**
   * A boost bot charges (rings pull into its dish), then a shockwave rolls out across the board: as it passes each
   * other cell, the bot's value is added (+n pops up). `onHit(hit, i)` per cell, in the order the wave reaches them
   * (board order within a distance). About 1.1 s (0.3 more for a gold bot).
   */
  async boost(a: Action, onHit?: (h: Hit, i: number) => void) {
    if (this.disposed) return
    this.wake()
    const bot = this.byId.get(a.by)
    if (!bot) {
      a.hits.forEach((h, i) => (this.setValue(h.id, h.to), onHit?.(h, i)))
      return
    }
    if (a.persistent) await this.goldFlare(bot)
    bot.frontTo = 1
    bot.charge = 1
    this.moodOf(bot, 'cheer', 2)
    this.lookAt(this.worldOf(bot), 2)
    const green = col3('#59ff7a')
    const wind = this.hurried ? 0.12 : 0.3
    const origin = this.botTip(bot)
    for (let i = 0; i < 2; i++) this.after(i * wind * 0.4, () => this.rings.emit({ x: origin.x, y: origin.y, z: origin.z, s0: 2.4, s1: 0.3, a: 0.9, life: wind * 0.7, c: green.clone().multiplyScalar(1.6), kind: 1 }))
    await this.wait(wind)
    if (this.disposed) return
    // the shockwave grows linearly: radius 0.2 + 7.73·t, so it reaches a cell d away after (d - 0.2) / 7.73 s
    const at = this.worldOf(bot, 0.2)
    this.waves.emit({ x: at.x, y: at.y, z: at.z, s0: 0.4, s1: 12, a: 1, life: 0.75, c: green.clone().multiplyScalar(1.6), kind: 3 })
    this.after(0.05, () => this.waves.emit({ x: at.x, y: at.y, z: at.z, s0: 0.3, s1: 11, a: 0.6, life: 0.75, c: col3('#d8ffe0', 1.2), kind: 3 }))
    this.glows.emit({ x: at.x, y: at.y, z: at.z, s0: 1.1, s1: 2, a: 0.6, life: 0.3, c: green.clone().multiplyScalar(1.2), kind: 0 })
    this.flash('#59ff7a', 0.05)
    this.shake = Math.max(this.shake, 0.15)
    bot.punch = 1
    let last = 0
    let done = 0
    a.hits.forEach((h, i) => {
      const p = this.byId.get(h.id)
      const d = p ? Math.hypot(cellX(p.col) - cellX(bot.col), p.y - bot.y) : 0
      const t = Math.max(0, (d - 0.2) / 7.73)
      last = Math.max(last, t)
      this.after(t, () => {
        this.setValue(h.id, h.to)
        if (p) {
          const w = this.worldOf(p, 0.3)
          this.rings.ring(w, green.clone().multiplyScalar(1.6), 0.2, 0.9, 0.3)
          this.sparks.burst(w, green, 5, 2, 0.14, 0.35)
          this.floaters.show(w.add(V3(0, 0.36, 0.3)), '+' + formatValue(Math.round((h.to - h.from) * 100) / 100), '#7dff9a', 0.72, 0.85, 0.25)
          this.moodOf(p, 'happy', 0.8)
        }
        onHit?.(h, i)
        done++
      })
    })
    await this.until(() => done >= a.hits.length)
    await this.wait(0.3)
    bot.frontTo = 0
    bot.charge = 0
  }

  /**
   * A magnet bot pulls: a field line arcs from every other cell to it and a ghost coin rides each one in; its display
   * counts up as they arrive (`onPull(i, running value)`), then it lands on the total (`onHit`). Volt holds out his
   * own magnet meanwhile. About 0.8 + 0.05 per source (0.3 more for a gold bot).
   */
  async magnet(a: Action, onHit?: (h: Hit, i: number) => void, onPull?: (i: number, value: number) => void) {
    if (this.disposed) return
    this.wake()
    const bot = this.byId.get(a.by)
    const hit = a.hits[0]
    if (!bot) {
      if (hit) {
        this.setValue(hit.id, hit.to)
        onHit?.(hit, 0)
      }
      return
    }
    if (a.persistent) await this.goldFlare(bot)
    const srcs = this.pieces(a.sources)
    const gap = Math.min(0.05, 0.6 / Math.max(1, srcs.length))
    const fly = this.hurried ? 0.16 : 0.32
    bot.frontTo = 1
    bot.charge = 1
    this.moodOf(bot, 'angry', 3)
    this.startAct('magnet', 0.3 + srcs.length * gap + fly + 0.4)
    this.lookAt(this.worldOf(bot), 2)
    await this.wait(this.hurried ? 0.1 : 0.25)
    if (this.disposed) return
    let run = hit ? hit.from : bot.value
    let n = 0
    srcs.forEach((s, k) =>
      this.after(k * gap, () => {
        const from = this.worldOf(s, 0.3)
        const to = this.botTip(bot)
        this.arcs.emit(from, to, k % 2 ? '#ff6a7e' : '#8fe8ff', { life: 0.42, width: 0.05, jag: 0.1, bow: (k % 2 ? 1 : -1) * 0.16 })
        s.punch = 0.6
        const v = s.value
        const ctrl = from.clone().lerp(to, 0.5).add(V3(rnd(-0.6, 0.6), 0.6, 0.7))
        const bill = this.ghosts.emit({ x: from.x, y: from.y, z: from.z, s0: 0.5, a: 0.95, life: 99, kind: 2, c: col3('#fff2c4', 1.15) })
        this.fly(from, ctrl, to, fly, bill, col3('#ffcf3a'), 20, false, () => {
          bill.life = 0
          if (this.disposed) return
          run = Math.round((run + v) * 100) / 100
          this.countTo(bot, run, 0.14)
          bot.punch = 0.5
          bot.pop = 1
          bot.flashV = Math.max(bot.flashV, 0.5)
          this.glows.emit({ x: to.x, y: to.y, z: to.z, s0: 0.5, s1: 0.9, a: 0.7, life: 0.18, c: col3('#ffcf3a', 1.3), kind: 0 })
          onPull?.(k, run)
          n++
        })
      }),
    )
    await this.until(() => n >= srcs.length)
    if (hit) this.setValue(bot.id, hit.to)
    const at = this.worldOf(bot, 0.35)
    this.impact(at, col3('#ff4a5e'), 1.2)
    this.rings.ring(at, GOLD.clone().multiplyScalar(2), 0.3, 1.8, 0.45)
    if (hit) this.floaters.show(at.clone().add(V3(0, 0.3, 0.35)), '+' + formatValue(Math.round((hit.to - hit.from) * 100) / 100), '#ff8a9a', 0.9, 1, 0.3)
    this.moodOf(bot, 'cheer', 1)
    if (hit) onHit?.(hit, 0)
    await this.wait(0.25)
    bot.frontTo = 0
    bot.charge = 0
  }

  /** relabels a bonus symbol (number × bet); with `punch` its number counts up to it, pops and flashes, and its socket flashes */
  setValue(id: number, v: number, punch = true) {
    const p = this.byId.get(id)
    if (!p) return
    this.countTo(p, v, punch ? 0.34 : 0)
    if (!punch) return
    p.punch = 1
    p.pop = 1
    p.flashV = 1
    const at = this.board.indexOf(p)
    if (at >= 0) this.socks[at].flash = Math.max(this.socks[at].flash, 0.7)
  }

  /** a piece's number runs from what it shows now to `v` over `dur` scene seconds (0: at once) */
  private countTo(p: Piece, v: number, dur: number) {
    p.value = v
    writeValue(p.model, v)
    p.countFrom = p.shown
    p.countDur = dur
    p.countT = dur > 0 ? 0 : 1
    if (dur <= 0) p.shown = v
  }

  /** something landed, so the respins are back to three: every locked socket flashes in a wave from the middle out */
  resetPulse() {
    if (this.disposed) return
    this.wake()
    for (let pos = 0; pos < CELLS; pos++) {
      if (!this.board[pos]) continue
      this.after(0.04 * Math.hypot(colOf(pos) - 2, rowOf(pos) - 2), () => (this.socks[pos].flash = Math.max(this.socks[pos].flash, 0.85)))
    }
    this.waves.emit({ x: 0, y: 0, z: SOCK_Z + 0.2, s0: 0.5, s1: 9, a: 0.6, life: 0.5, c: CYAN.clone().multiplyScalar(1.2), kind: 3 })
  }

  /** the last respin: the empty sockets throb red with a heartbeat, and so do the edges of the room */
  heartbeat(on: boolean) {
    this.heart = on
  }

  /**
   * All 25 sockets full: a golden flash, a wave of light from the middle out (every robot hops and cheers, and with
   * `double` each value is relabelled ×2, so the cells still add up to the total), Volt dances, fireworks, confetti
   * of bolts and gears, steam, and the sockets party in rainbow colours until the Power Grid ends. About 2.4 s.
   */
  async fullBoard(double = true) {
    if (this.disposed) return
    this.wake()
    this.fullOn = true
    this.heart = false
    this.startAct('dance')
    this.flash('#ffd23f', 0.45)
    this.shake = 0.7
    const mid = V3(0, 0, 0.6)
    this.waves.emit({ x: mid.x, y: mid.y, z: mid.z, s0: 0.5, s1: 15, a: 0.9, life: 1, c: GOLD.clone().multiplyScalar(1.3), kind: 3 })
    this.steam(1)
    this.fireworks(6)
    this.confettiCannons()
    this.kickNeedles(5000)
    for (let pos = 0; pos < CELLS; pos++) {
      const p = this.board[pos]
      const d = Math.hypot(colOf(pos) - 2, rowOf(pos) - 2)
      this.after(0.1 + d * 0.12, () => {
        this.socks[pos].flash = 1
        if (!p || !this.live.has(p)) return
        p.hop = 1
        this.moodOf(p, 'cheer', 1.6)
        const at = this.worldOf(p, 0.35)
        this.rings.ring(at, GOLD.clone().multiplyScalar(1.2), 0.25, 1, 0.35)
        if (double) this.setValue(p.id, Math.round(p.value * 200) / 100)
      })
    }
    await this.wait(2.4)
  }

  /**
   * The payout: each cell in board order sends a glowing orb of its colour to the screen point `to` (CSS pixels, the
   * total counter); `onEach(id, value, i)` as each arrives. Hurried, they all arrive at once. About 0.4 + 0.07 per cell (at most 1.5 s).
   */
  async collect(to: ScreenPoint, onEach: (id: number, value: number, i: number) => void) {
    if (this.disposed) return
    const ps: { p: Piece; pos: number }[] = []
    this.board.forEach((p, pos) => p && ps.push({ p, pos }))
    if (!ps.length) return
    if (this.hurried) {
      ps.forEach(({ p }, i) => onEach(p.id, p.value, i))
      return
    }
    const dest = this.screenToWorld(to.x, to.y, 1.6)
    const gap = Math.min(0.07, 1.1 / ps.length)
    let n = 0
    ps.forEach(({ p, pos }, i) =>
      this.after(i * gap, () => {
        const from = this.worldOf(p, 0.4)
        const c = col3(valueColor(p.value), 1.8)
        const bill = this.glows.emit({ x: from.x, y: from.y, z: from.z, s0: 0.6, a: 1, life: 99, kind: 2, c })
        const ctrl = from.clone().lerp(dest, 0.5).add(V3(rnd(-0.6, 0.6), 1, 0.8))
        p.punch = 1
        p.pop = 1
        p.flashV = 0.6
        this.socks[pos].flash = 1
        this.fly(from, ctrl, dest.clone(), 0.38, bill, c, 30, true, () => {
          bill.life = 0
          this.sparks.burst(dest, c, 6, 2, 0.15, 0.3)
          onEach(p.id, p.value, i)
          n++
        })
      }),
    )
    await this.until(() => n >= ps.length)
  }

  /**
   * Back to the base game: the alarm ends, the cells are sucked out, the sockets slide back, the glass returns and
   * `next` drops in (no lever). About 1.9 s.
   */
  async exitGrid(next: Grid) {
    if (this.disposed) return
    this.wake()
    this.heart = false
    this.fullOn = false
    this.alertTo = 0
    this.inGrid = false
    const batch: Batch = { n: 0 }
    for (const p of [...this.live]) if (p.state !== 'vacuum' && p.state !== 'vanish') this.vacuum(p, VAC_GAP * p.col + VAC_ROW * p.row, batch)
    for (let c = 0; c < COLS; c++) this.after(VAC_GAP * c, () => this.whoosh(c))
    this.board.fill(null)
    for (const s of this.socks) {
      s.litTo = 0
      s.litAt = this.time
      s.spin = false
      s.latchTo = 0
    }
    await this.wait(0.35)
    this.sockTo = 0
    await this.until(() => batch.n <= 0 && this.sock <= 0.001)
    if (this.disposed) return
    this.sockets.root.visible = false
    await this.drop(next, -1, false)
  }

  /* ---------------- Volt ---------------- */

  /** a move from Volt; fire and forget */
  host(action: HostAction) {
    this.wake()
    this.startAct(action)
  }

  /** Volt points at a cell for a moment */
  pointAt(pos: number) {
    this.wake()
    const at = this.cellAt(pos, 0.3)
    this.startAct('point', ACT_DUR.point, at)
    this.lookAt(at, ACT_DUR.point)
  }

  private startAct(kind: Act, dur = ACT_DUR[kind], at: THREE.Vector3 | null = null) {
    this.act = { kind, t: 0, dur, at, side: at && at.x < 0 ? 0 : 1, fired: false }
  }

  /** Volt turns his head to a spot for a while */
  private lookAt(at: THREE.Vector3, s: number) {
    this.look = { at: at.clone(), until: this.clock + s }
  }

  private hostMood(e: Expr, s: number) {
    this.moodFace = { e, until: this.clock + s }
  }

  /** where the grip of one of Volt's claws is (0 left, 1 right) */
  private clawTip(side: number) {
    const c = side ? this.volt.clawR : this.volt.clawL
    c.updateWorldMatrix(true, false)
    return c.localToWorld(GRIP.clone())
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

  /** steam blasts out of the machine's vents and Volt's exhausts */
  steam(strength = 1) {
    const n = Math.round(10 * strength)
    for (const v of this.machine.vents) {
      const at = v.getWorldPosition(V3())
      const s = Math.sign(at.x)
      for (let i = 0; i < n * 2; i++)
        this.after(i * 0.025, () => this.puffs.emit({ x: at.x + rnd(-0.08, 0.08), y: at.y + rnd(-0.12, 0.12), z: at.z + 0.1, vx: s * rnd(0.6, 2), vy: rnd(0.5, 1.6), vz: rnd(0.6, 1.8), s0: rnd(0.15, 0.3), s1: rnd(1.1, 1.8), a: rnd(0.16, 0.26), life: rnd(0.8, 1.3), c: col3('#dfe8ff'), kind: 1, drag: 1.4, spin: rnd(-1.5, 1.5) }))
    }
    for (const e of this.volt.exhausts) {
      const at = e.getWorldPosition(V3())
      for (let i = 0; i < n; i++)
        this.after(i * 0.03, () => this.puffs.emit({ x: at.x + rnd(-0.04, 0.04), y: at.y, z: at.z, vx: Math.sign(at.x) * rnd(0.2, 0.8), vy: rnd(1.4, 2.8), s0: rnd(0.12, 0.22), s1: rnd(0.8, 1.3), a: rnd(0.16, 0.26), life: rnd(0.8, 1.2), c: col3('#dfe8ff'), kind: 1, drag: 1.2, spin: rnd(-1.5, 1.5) }))
    }
  }

  private viewHalf(z: number) {
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const depth = this.camera.position.z - z
    return { w: tan * depth * this.camera.aspect, h: tan * depth }
  }

  /** the confetti palette: bolts, nuts and gears in machine colours */
  private bit(i: number) {
    const pal = ['#ffc94a', '#5cf2ff', '#ff3fd2', '#59ff7a', '#ff7a2e', '#eef2f8']
    return { b: i % 3 === 0 ? this.gears : i % 3 === 1 ? this.bolts : this.nuts, c: col3(pal[i % pal.length]) }
  }

  /** bolts, nuts and gears tumble down from above */
  confettiBurst(n: number) {
    for (let i = 0; i < n; i++) {
      const z = rnd(0.8, 2.6)
      const v = this.viewHalf(z)
      const { b, c } = this.bit(i)
      b.emit(V3(rnd(-v.w, v.w), this.camY + v.h + rnd(0, 1.5), z), V3(rnd(-1, 1), rnd(-3, -0.5), 0), c, rnd(2.2, 3.2), rnd(2.5, 3.5), -4, rnd(4, 10))
    }
  }

  /** two cannons fire bolts, nuts and gears up from the bottom corners */
  confettiCannons() {
    const z = 1.5
    const v = this.viewHalf(z)
    for (const s of [-1, 1]) {
      const at = V3(s * (v.w - 0.3), this.camY - v.h + 0.2, z)
      this.sparks.emit(at.x, at.y, at.z, 0, 0, 0, col3('#fff2c0', 2), 2, 0.25, 0, 0, 1)
      for (let i = 0; i < 60; i++) {
        const { b, c } = this.bit(i)
        b.emit(at, V3(-s * rnd(1, 4.5), rnd(7, 12), rnd(-1, 1)), c, rnd(2.2, 3.2), rnd(2.4, 3.2), -7, rnd(5, 12))
      }
    }
  }

  /** rockets burst over the workshop; Volt cheers */
  fireworks(rockets: number) {
    const pal = ['#5cf2ff', '#ff3fd2', '#ffe23d', '#59ff7a', '#ff9a2e', '#ffffff']
    for (let i = 0; i < rockets; i++) {
      const z = rnd(-1.5, 1)
      const v = this.viewHalf(z)
      this.rockets.push({ x: rnd(-v.w * 0.85, v.w * 0.85), y: this.camY - v.h - 0.3, z, vy: rnd(12, 15), top: this.camY + rnd(-0.2, 0.75) * v.h, wait: i * rnd(0.12, 0.22), color: col3(pal[i % pal.length]) })
    }
    if (!this.act || this.act.kind === 'cheer') this.startAct('cheer')
  }

  private kickNeedles(pay: number) {
    this.needleKick = Math.max(this.needleKick, Math.min(1, Math.log10(1 + pay) / Math.log10(501)))
  }

  /* ---------------- coordinates ---------------- */

  private project(v: THREE.Vector3) {
    const q = v.clone().project(this.camera)
    return { x: ((q.x + 1) / 2) * this.w, y: ((1 - q.y) / 2) * this.h }
  }

  private screenToWorld(x: number, y: number, z: number) {
    const ndc = V3((x / this.w) * 2 - 1, -((y / this.h) * 2 - 1), 0.5).unproject(this.camera)
    const dir = ndc.sub(this.camera.position).normalize()
    return this.camera.position.clone().addScaledVector(dir, (z - this.camera.position.z) / dir.z)
  }

  /** the average screen position of some pieces, in CSS pixels (null if none is on the board) */
  screenOf(ids: readonly number[]): ScreenPoint | null {
    const ps = this.pieces(ids)
    if (!ps.length) return null
    const c = V3()
    for (const p of ps) c.add(V3(cellX(p.col), p.ty, p.z + 0.3))
    return this.project(c.divideScalar(ps.length))
  }

  /** a cell's centre on screen, in CSS pixels */
  cellScreen(pos: number): ScreenPoint {
    return this.project(this.cellAt(pos, (this.inGrid ? GRID_Z : 0) + 0.3))
  }

  /** Volt's face on screen, in CSS pixels (for a speech bubble) */
  hostScreen(): ScreenPoint {
    return this.project(vp(0, 1.42 * DESIGN, 0.6))
  }

  /** the outside of the machine on screen (marquee top to base, pillar to pillar), for laying out the overlay */
  frameRect() {
    const s = this.machine.size
    const a = this.project(V3(-s.halfW, s.top, 0.4))
    const b = this.project(V3(s.halfW, s.bottom, 0.4))
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  /* ---------------- frame loop ---------------- */

  private busy() {
    return (
      this.timers.length > 0 ||
      this.conds.length > 0 ||
      this.flights.length > 0 ||
      this.rockets.length > 0 ||
      this.sparks.list.length > 0 ||
      this.rings.list.length > 0 ||
      this.glows.list.length > 0 ||
      this.puffs.list.length > 0 ||
      this.ghosts.list.length > 0 ||
      this.waves.list.length > 0 ||
      this.arcs.count > 0 ||
      this.wayArcs.count > 0 ||
      this.floaters.active ||
      this.gears.list.length > 0 ||
      this.bolts.list.length > 0 ||
      this.nuts.list.length > 0 ||
      this.coins.list.length > 0 ||
      this.act !== null ||
      this.leverSpring >= 0 ||
      this.inGrid ||
      this.alert > 0.001 ||
      this.links.length > 0 ||
      this.tease > 0.01 ||
      this.shower > 0 ||
      this.shake > 0 ||
      this.flashA > 0 ||
      this.surgeKick > 0 ||
      Math.abs(this.black - this.blackTo) > 0.002 ||
      Math.abs(this.dim - this.dimTo) > 0.002 ||
      Math.abs(this.sock - this.sockTo) > 0.001 ||
      Math.abs(this.hot - this.hotTo) > 0.002 ||
      // the gauges' idle flutter is fine at the idle rate; a swing after a win is not
      this.needleKick > 0 ||
      Math.abs(this.needle - this.needleTo) > 0.03 ||
      this.moving()
    )
  }

  private moving() {
    for (const p of this.live) if (p.state !== 'idle' || p.win > 0.01 || p.squash > 0 || p.punch > 0 || p.front > 0.01 || p.countT < 1 || p.pop > 0 || p.flashV > 0) return true
    return false
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // idle robots only bob and blink and the LEDs chase; 30 frames a second is plenty for that
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
    // timers and conditions: no arrays are built on the frames where nothing is due
    let due = false
    for (const t of this.timers)
      if (t.at <= this.time) {
        due = true
        break
      }
    if (due) {
      const now = this.timers.filter((t) => t.at <= this.time)
      this.timers = this.timers.filter((t) => t.at > this.time)
      for (const t of now) t.fn()
    }
    tickModels(this.clock)
    this.updateMood(dt, real)

    // camera: drifts towards the mouse, shakes on big hits
    this.shake = Math.max(0, this.shake - real * 2.2)
    this.lookCam.lerp(this.pointer, Math.min(1, real * 3))
    this.push = this.pushTo > this.push ? Math.min(this.pushTo, this.push + dt / 0.25) : Math.max(this.pushTo, this.push - dt / 0.3)
    this.placeCamera()

    this.tease += (this.teaseTo - this.tease) * Math.min(1, dt * 6)
    for (const p of [...this.live]) this.animate(p, dt, real)
    this.updateLabels(dt)
    this.updateShadows()
    this.updateMachine(dt, real)
    this.updateSockets(dt)
    this.poseHost(dt, real)
    this.updateFx(dt, real)

    let done: { test: () => boolean; fn: () => void }[] | null = null
    for (const c of this.conds) if (c.test()) (done ??= []).push(c)
    if (done) {
      const met = done
      this.conds = this.conds.filter((c) => !met.includes(c))
      for (const c of met) c.fn()
    }
  }

  private updateMood(dt: number, real: number) {
    // red alert fades in over 0.8 s
    this.alert = this.alertTo > this.alert ? Math.min(1, this.alert + dt / 0.8) : Math.max(0, this.alert - dt / 1.2)
    this.hot += (this.hotTo - this.hot) * Math.min(1, real * 4)
    if (Math.abs(this.hot - this.hotTo) < 0.002) this.hot = this.hotTo
    const a = smooth(this.alert)
    setAlert(a)

    this.black += Math.sign(this.blackTo - this.black) * Math.min(Math.abs(this.blackTo - this.black), dt * (this.blackTo > this.black ? 4 : 1.6))
    this.flashA = Math.max(0, this.flashA - real * 3)
    this.blackMat.uniforms.uA.value = this.black
    this.flashMat.uniforms.uA.value = this.flashA
    this.overlays[0].visible = this.black > 0.003
    this.overlays[1].visible = this.flashA > 0.003

    // lights: warm key and neon rims by night, everything red in the alarm
    this.key.color.copy(KEY_NIGHT).lerp(KEY_ALARM, a)
    this.key.intensity = 2.4 - 0.4 * a
    this.rim.color.copy(RIM_NIGHT).lerp(RIM_ALARM, a)
    this.rim2.color.copy(RIM2_NIGHT).lerp(RIM2_ALARM, a)
    this.ambient.intensity = 0.25 - 0.04 * a

    // Volt's beacon turns in the alarm; its light sweeps the machine and the room
    if (a > 0.001) this.beacon += real * 6.5
    this.volt.beacon.rotation.y = this.beacon
    const front = Math.max(0, Math.cos(this.beacon))
    ;(this.volt.lamp.material as THREE.MeshBasicMaterial).color.copy(RED).multiplyScalar(0.6 + a * (0.8 + 4 * front ** 3))
    const bw = this.volt.beacon.getWorldPosition(this.beaconAt)
    this.beaconLight.position.set(bw.x + Math.sin(this.beacon) * 0.9, bw.y, bw.z + Math.cos(this.beacon) * 0.9)
    this.beaconLight.intensity = a * 16 * (0.25 + 0.75 * front * front)

    // lightning over the city now and then in the alarm
    if (a > 0.5 && this.clock > this.boltAt) {
      this.boltAt = this.clock + rnd(2.5, 6)
      this.boltFlash = 1
      this.boltX = rnd(-0.35, 0.35) * Math.max(0.6, this.camera.aspect)
    }
    this.boltFlash = Math.max(0, this.boltFlash - real * 4)
    const flick = this.boltFlash > 0 ? this.boltFlash * (0.6 + 0.4 * Math.sin(this.clock * 70)) : 0

    // the heartbeat of a last respin: a double beat every 1.1 s
    if (this.heart) {
      const b = (this.clock % 1.1) / 1.1
      this.pulse = Math.exp(-(((b - 0.05) / 0.05) ** 2)) + 0.7 * Math.exp(-(((b - 0.25) / 0.05) ** 2))
    } else this.pulse = Math.max(0, this.pulse - real * 3)

    this.bloom.strength = 0.35 + 0.1 * a
    this.dim += (this.dimTo - this.dim) * Math.min(1, dt * 10)
    if (Math.abs(this.dim - this.dimTo) < 0.002) this.dim = this.dimTo
    this.dimMat.opacity = Math.max(this.dim * 0.55, this.tease * 0.25)
    this.dimMesh.visible = this.dimMat.opacity > 0.004

    const u = this.backMat.uniforms
    u.uTime.value = this.clock
    u.uAlert.value = a
    u.uFlash.value = flick
    u.uBoltX.value = this.boltX
    u.uPulse.value = this.pulse
    u.uHot.value = this.hot
    u.uBeamA.value = -this.beacon
    if (a > 0) {
      const b = bw.project(this.camera)
      u.uBeacon.value.set(b.x * 0.5 * this.camera.aspect, b.y * 0.5)
    }
    u.uFloor.value = this.floorAt.set(0, this.machine.size.bottom + 0.1, 0.4).project(this.camera).y * 0.5

    // the glass slides away while the sockets are out
    const g = 1 - smooth(clamp01(this.sock))
    ;(this.glassMat.userData.rim as { value: THREE.Color }).value.copy(this.glassRim).multiplyScalar(g)
    this.glassMat.envMapIntensity = this.glassEnv * g
    for (const t of this.machine.tubes) t.glass.visible = g > 0.01
    this.beamMat.uniforms.uTime.value = this.clock
  }

  private updateMachine(dt: number, real: number) {
    const a = smooth(this.alert)
    const T = this.clock
    const base = this.tubeBase.copy(CYAN).lerp(HOT, this.hot)
    const c = this.tubeCol
    const tmp = this.tubeTmp
    let beams = 0
    for (let col = 0; col < COLS; col++) {
      this.tubeFlash[col] = Math.max(0, this.tubeFlash[col] - dt * 3)
      this.btnFlash[col] = Math.max(0, this.btnFlash[col] - dt * 2.5)
      const held = this.tease > 0.05 && this.teaseCols.includes(col) ? 1 : 0
      this.tubeTease[col] += (held - this.tubeTease[col]) * Math.min(1, dt * 6)
      const tz = this.tubeTease[col]
      c.copy(base).multiplyScalar(TUBE_BASE * (1 + 0.15 * Math.sin(T * 2 + col)))
      if (a > 0) c.lerp(tmp.copy(RED).multiplyScalar(1 + 0.8 * Math.max(0, Math.sin(T * 6 - col * 0.9))), a)
      const w = this.tubeWin[col]
      if (w) c.lerp(tmp.copy(w).multiplyScalar(1.2 + 0.5 * Math.sin(T * 10)), this.dim)
      if (tz > 0) c.lerp(tmp.copy(GOLD).multiplyScalar(2.4 + 1.2 * Math.sin(T * 14)), tz)
      c.addScalar(2 * this.tubeFlash[col])
      this.tubeNeon[col].color.copy(c)
      // the energy column in a held tube
      const k = tz * (0.85 + 0.15 * Math.sin(T * 9 + col))
      this.beamAttr.setXYZW(col, GOLD.r * 1.6, GOLD.g * 1.5, GOLD.b * 1.2, k)
      beams = Math.max(beams, k)
      if (tz > 0.5 && Math.random() < real * 24) this.sparks.emit(cellX(col) + rnd(-0.35, 0.35), rnd(-WIN_H, WIN_H), 0.35, 0, rnd(0.8, 2), 0, GOLD.clone().multiplyScalar(2.2), rnd(0.1, 0.18), rnd(0.4, 0.7), 0, 1)
      // arcs crawl up the held tube's rails
      if (tz > 0.5 && Math.random() < real * 7) {
        const x = cellX(col) + (Math.random() < 0.5 ? -0.38 : 0.38)
        const y = rnd(-WIN_H + 0.3, WIN_H - 0.9)
        this.arcs.emit(V3(x, y, 0.3), V3(x + rnd(-0.1, 0.1), y + rnd(0.5, 0.9), 0.3), '#ffd970', { life: 0.16, width: 0.05, jag: 0.45 })
      }
      // the arcade buttons: a flash when the column lands, red blinking in the alarm
      c.copy(BUTTONS[col]).multiplyScalar(1 + 2.5 * this.btnFlash[col])
      if (a > 0) c.lerp(tmp.copy(RED).multiplyScalar(0.4 + 1.6 * (Math.sin(T * 8 + col * 1.3) > 0 ? 1 : 0)), a)
      this.machine.buttons.setColorAt(col, c)
    }
    this.machine.buttons.instanceColor!.needsUpdate = true
    this.beamAttr.needsUpdate = true
    this.beamMesh.visible = beams > 0.01

    // the gauges: an idle flutter, a swing on wins, and in the Power Grid they follow the board's total
    let target = 0.14 + 0.04 * Math.sin(T * 0.7) + 0.015 * Math.sin(T * 5.3) + 0.08 * this.hot
    if (this.inGrid) {
      let sum = 0
      for (const p of this.board) if (p) sum += p.value
      target = Math.max(target, Math.min(0.98, Math.log10(1 + sum) / Math.log10(2001)))
    }
    this.needleKick = Math.max(0, this.needleKick - real * 0.35)
    this.needleTo = Math.max(target, this.needleKick)
    this.needleV += (this.needleTo - this.needle) * 140 * real
    this.needleV *= Math.exp(-11 * real)
    this.needle += this.needleV * real
    this.machine.needles.forEach((n, i) => (n.rotation.z = 2.2 - 4.4 * clamp01(this.needle * (i ? 0.94 : 1) + 0.01 * Math.sin(T * 13 + i))))

    // the marquee: a neon buzz now and then, and a blink with the beacon in the alarm
    if (T > this.flickerAt) {
      this.flickerAt = T + rnd(5, 11)
      this.flicker = 1
    }
    this.flicker = Math.max(0, this.flicker - real * 3)
    const buzz = this.flicker > 0 && Math.sin(T * 60) > 0.2 ? 0.45 : 1
    const alarmBlink = 1 - a * 0.45 * (Math.cos(this.beacon) > 0.3 ? 0 : 1)
    this.lettersMat.color.setScalar(1.35 * buzz * alarmBlink)

    // in the alarm: arcs crawl along the frame and the vents hiss
    if (a > 0.5 && T > this.crawlAt) {
      this.crawlAt = T + rnd(0.2, 0.55)
      const s = Math.random() < 0.5 ? -1 : 1
      if (Math.random() < 0.7) {
        const x = s * 2.55
        const y = rnd(-2.4, 1.6)
        this.arcs.emit(V3(x, y, 0.42), V3(x + rnd(-0.06, 0.06), y + rnd(0.6, 1.2), 0.42), '#ff6a4a', { life: 0.24, width: 0.06, jag: 0.35 })
      } else {
        const x = rnd(-2.2, 1.2)
        this.arcs.emit(V3(x, 2.66, 0.45), V3(x + rnd(0.6, 1.1), 2.66, 0.45), '#ff8a5a', { life: 0.22, width: 0.055, jag: 0.35 })
      }
    }
    if (a > 0.5 && T > this.steamAt) {
      this.steamAt = T + rnd(3, 6)
      this.steam(0.4)
    }
    // overclocked tubes spit the odd spark out of their tops
    if (this.hot > 0.5 && !this.inGrid && Math.random() < real * 1.5) {
      const x = cellX(Math.floor(Math.random() * COLS))
      for (let i = 0; i < 4; i++) this.sparks.emit(x + rnd(-0.2, 0.2), WIN_H + 0.05, 0.45, rnd(-1, 1), rnd(1.5, 3), rnd(0, 1), col3('#ffb070', 2.2), rnd(0.08, 0.14), rnd(0.3, 0.5), -6, 0.5)
    }
  }

  private updateSockets(dt: number) {
    const out = this.sockTo > this.sock
    this.sock = out ? Math.min(1, this.sock + dt / 0.5) : Math.max(0, this.sock - dt / 0.45)
    if (!this.sockets.root.visible) return
    // they come forward with a little overshoot, and slide straight back
    const u = this.sock
    const k = out ? 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2 : smooth(u)
    this.sockets.root.position.z = SOCK_BACK + (SOCK_Z - SOCK_BACK) * k
    const T = this.clock
    const c = this.sockCol
    const gc = this.sockGlow
    for (let pos = 0; pos < CELLS; pos++) {
      const s = this.socks[pos]
      if (this.time >= s.litAt) s.lit += (s.litTo - s.lit) * Math.min(1, dt * 9)
      s.flash = Math.max(0, s.flash - dt * 3)
      if (Math.abs(s.latch - s.latchTo) > 0.002) {
        s.latch += (s.latchTo - s.latch) * Math.min(1, dt * 22)
        if (Math.abs(s.latch - s.latchTo) < 0.01) s.latch = s.latchTo
        this.sockets.setLatch(pos, s.latch)
      }
      const p = this.board[pos]
      // a full socket is lit in its cell's colour: a bright rim, a backlight in the well and the housing brought up;
      // an empty one stays dark and quiet, a dim steel rim with a slow shimmer rolling across the board
      let k: number
      let gk = 0
      if (p) {
        c.copy(p.gold ? GOLD : colorOf(valueColor(p.value)))
        gc.copy(c)
        k = 1.9
        gk = 0.85
      } else {
        const wave = Math.max(0, Math.sin(T * 1.1 - (colOf(pos) + rowOf(pos)) * 0.55)) ** 6
        c.copy(SOCK_IDLE)
        k = 0.2 + 0.24 * wave
      }
      if (s.spin && s.shut < 1) {
        // spinning: a little livelier than idle, still well under a full socket
        c.copy(SOCK_IDLE).lerp(CYAN, 0.5)
        k = 0.3 + 0.14 * Math.abs(Math.sin(T * 23 + pos * 1.7))
      }
      if (this.heart && !p) {
        c.copy(HEART)
        k = 0.2 + 1.5 * this.pulse
      }
      if (this.fullOn) {
        c.setHSL((T * 0.5 + pos * 0.04) % 1, 1, 0.6)
        gc.copy(c)
        k = 1.9
        gk = 1
      }
      k *= s.lit
      gk *= s.lit
      if (s.flash > 0) {
        c.lerp(WHITE, s.flash * 0.6)
        k += 2 * s.flash
        if (p) gk += 0.8 * s.flash
      }
      // only what changed is written
      const r = c.r * k
      const g = c.g * k
      const b = c.b * k
      if (Math.abs(r - s.rim[0]) + Math.abs(g - s.rim[1]) + Math.abs(b - s.rim[2]) > 0.004) {
        s.rim[0] = r
        s.rim[1] = g
        s.rim[2] = b
        this.sockets.setColor(pos, c, k)
      }
      if (Math.abs(gc.r * gk - s.glow[0]) + Math.abs(gc.g * gk - s.glow[1]) + Math.abs(gc.b * gk - s.glow[2]) > 0.004) {
        s.glow[0] = gc.r * gk
        s.glow[1] = gc.g * gk
        s.glow[2] = gc.b * gk
        this.sockets.setGlow(pos, gc, gk)
      }
      s.tint += ((p ? 1.05 : 0.5) - s.tint) * Math.min(1, dt * 8)
      if (Math.abs(s.tint - s.tintW) > 0.004) {
        s.tintW = s.tint
        this.sockets.setTint(pos, s.tint)
      }

      // the slot window: scrolling while it spins, then a quick shut (a flash when nothing landed)
      if (s.spin) {
        s.off += dt * 7.5
        if (this.time >= s.stopAt) s.shut = Math.min(1, s.shut + dt / 0.14)
        if (s.shut >= 1) s.spin = false
      }
      const alpha = s.spin ? 1 - s.shut : 0
      const flash = s.spin && !s.hit && this.time >= s.stopAt ? 0.5 * (1 - s.shut) : 0
      this.winAttr.setXYZW(pos, s.off, 0.85 * (1 - s.shut), alpha, flash)
    }
    this.winAttr.needsUpdate = true
  }

  /**
   * The numbers on the bonus symbols: each follows its piece (staying upright through its wobbles), counts towards
   * its value, pops and flashes white when it changes, and dims with the rest of the board while a win shows.
   */
  private updateLabels(dt: number) {
    const L = this.labels
    L.begin()
    for (const p of this.live) {
      const a = ANCHOR[p.sym]
      if (!a) continue
      if (p.countT < 1) {
        p.countT = Math.min(1, p.countT + dt / Math.max(1e-3, p.countDur))
        p.shown = p.countT >= 1 ? p.value : p.countFrom + (p.value - p.countFrom) * ease(p.countT)
      }
      p.pop = Math.max(0, p.pop - dt * 3)
      p.flashV = Math.max(0, p.flashV - dt * 3.2)
      if (!p.root.visible) continue
      let alpha = p.state === 'vanish' ? 1 - Math.min(1, p.t / 0.12) : 1
      alpha *= 1 - 0.62 * this.dim * (1 - Math.min(1, p.front * 2))
      // whole numbers count in whole steps (a count can start from the middle of another)
      const v = p.countT >= 1 ? p.value : Number.isInteger(p.value) ? Math.round(p.shown) : Math.round(p.shown * 100) / 100
      // the pop swells fast and settles (peaking near 1 + POP); a long number grows less, so it stays on its cell
      const pk = p.pop > 0 ? Math.sin(Math.PI * (1 - p.pop) ** 0.6) * Math.min(1, p.pop * 2.2) : 0
      const s = p.inner.scale
      const k = ((s.x + s.y) / 2) * CAST
      const at = p.root.position
      if (v !== p.textV) {
        p.textV = v
        p.text = valueText(v)
      }
      L.add(p.text, at.x, at.y + a.y * CAST * s.y, at.z + a.z * CAST * s.z, a.size * k * (1 + POP * pk), a.maxW * k * (1 + 0.25 * POP * pk), colorOf(valueColor(v)), alpha, p.flashV)
    }
    L.end()
  }

  private updateShadows() {
    let n = 0
    const m = this.shadowM
    for (const p of this.live) {
      if (n >= 64 || p.state === 'vanish' || p.state === 'slam' || p.z > 0.2) continue
      const s = p.inner.scale.x
      m.makeScale(0.8 * s, 0.42 * s, 1).setPosition(p.root.position.x + 0.05, p.root.position.y - 0.3, -0.24)
      this.shadows.setMatrixAt(n++, m)
    }
    this.shadows.count = n
    this.shadows.visible = n > 0
    this.shadows.instanceMatrix.needsUpdate = true
  }

  /* ---------------- Volt's body ---------------- */

  private poseHost(dt: number, real: number) {
    const v = this.volt
    const T = this.clock
    const P: Pose = { claw: [REST_CLAW[0].clone(), REST_CLAW[1].clone()], open: [0.25, 0.25], hop: 0, lean: 0, twist: 0, nod: 0, tilt: 0, yaw: 0, face: null, magnet: false, snap: 0 }
    // breathing: a slow rise and fall, his claws resting on the marquee
    const br = Math.sin(T * 1.6)
    P.hop = 0.012 * br
    P.claw[0].y += 0.01 * br
    P.claw[1].y += 0.01 * br
    // left alone long enough he dozes off; Zs drift up
    const sleepy = !this.inGrid && T - this.awake > 30
    if (sleepy) {
      P.nod = 0.3
      P.face = 'sleepy'
      P.hop = 0.03 * br
      if (T > this.zzzAt) {
        this.zzzAt = T + 2.2
        this.floaters.show(vp(0.55, 2.55, 0.6), 'Z', '#8ff6ff', 0.5, 1.8, 0.9)
      }
    }
    // a held tube: claws together, fidgeting, eyes on the tube
    const tz = this.tease
    if (tz > 0.01) {
      for (let s = 0; s < 2; s++) P.claw[s].lerp(vp((s ? 1 : -1) * (0.22 + 0.03 * Math.sin(T * 11 + s * 2)), 0.86, 0.8), tz)
      P.open = [0.12, 0.12]
      P.tilt = 0.06 * Math.sin(T * 7) * tz
      if (tz > 0.5) P.face = 'wow'
    }

    const a = this.act
    if (a) {
      a.t += dt
      const u = Math.min(1, a.t / a.dur)
      const e = env(u, 0.18, 0.22)
      const set = (s: number, to: THREE.Vector3, w: number) => P.claw[s].lerp(to, w)
      switch (a.kind) {
        case 'lever': {
          const knob = this.knob()
          if (u < 0.3) {
            // reach for the knob
            set(1, knob, smooth(u / 0.3))
            P.open[1] = u < 0.22 ? 1 : 1 - (u - 0.22) / 0.08
            P.yaw += 0.35 * smooth(u / 0.3)
          } else if (u < 0.62) {
            // grip and yank it down
            const k = Math.min(1, (u - 0.3) / 0.2)
            this.leverAngle = LEVER_REST + (LEVER_PULL - LEVER_REST) * k * k
            set(1, this.knob(), 1)
            P.open[1] = 0
            P.snap = 1
            P.lean = -0.05 * k
            P.hop -= 0.03 * k
            P.yaw += 0.35 - 0.2 * k
            if (k >= 1 && !a.fired) {
              a.fired = true
              this.onLever?.()
              this.shake = Math.max(this.shake, 0.12)
              this.tubeFlash.fill(0.6)
            }
          } else {
            // let go: the lever springs back
            if (this.leverSpring < 0 && this.leverAngle !== LEVER_REST) this.leverSpring = 0
            set(1, knob, 1 - smooth((u - 0.62) / 0.38))
            P.open[1] = 1 - smooth((u - 0.62) / 0.38) * 0.75
          }
          P.face = 'happy'
          break
        }
        case 'cheer':
          for (let s = 0; s < 2; s++) set(s, vp((s ? 1 : -1) * 1.45, 2.0 + 0.1 * Math.sin(u * Math.PI * 4), 0.15), e)
          P.open = [e, e]
          P.hop += 0.08 * Math.sin(Math.PI * u)
          P.nod -= 0.12 * e
          P.face = 'cheer'
          break
        case 'dance': {
          const beat = Math.min(DANCE.length - 1, Math.floor(a.t / 0.3))
          const f = (a.t % 0.3) / 0.3
          const prev = DANCE[Math.max(0, beat - 1)]
          const cur = DANCE[beat]
          // robotic: a sharp move at the top of each beat, then hold
          const k = beat === 0 ? smooth(Math.min(1, f / 0.35)) : smooth(Math.min(1, f / 0.3))
          const w = env(u, 0.08, 0.12)
          for (let s = 0; s < 2; s++) set(s, prev[s].clone().lerp(cur[s], k), w)
          P.open = [0.8 * w, 0.8 * w]
          P.twist += (beat % 2 ? 0.18 : -0.18) * w
          P.tilt += (beat % 2 ? -0.2 : 0.2) * w
          P.hop += 0.06 * Math.abs(Math.sin(a.t * Math.PI / 0.3)) * w
          P.snap = 0.5
          P.face = beat >= DANCE.length - 2 ? 'cheer' : beat % 4 < 2 ? 'happy' : 'love'
          break
        }
        case 'facepalm': {
          const w = env(u, 0.2, 0.2)
          set(1, vp(0.12, 1.72 * DESIGN * 0.77, 0.86), w)
          P.open[1] = 0.6
          P.nod += 0.3 * w
          P.tilt -= 0.12 * w
          P.yaw += 0.08 * Math.sin(a.t * 9) * w
          P.face = u < 0.25 ? 'wow' : 'sad'
          break
        }
        case 'gasp':
          for (let s = 0; s < 2; s++) set(s, vp((s ? 1 : -1) * 0.72, 1.65, 0.78), e)
          P.open = [e, e]
          P.nod -= 0.15 * e
          P.hop += 0.04 * e
          P.face = 'wow'
          break
        case 'nervous':
          for (let s = 0; s < 2; s++) set(s, vp((s ? 1 : -1) * (0.2 + 0.04 * Math.sin(a.t * 12 + s * 3)), 0.86, 0.8), e)
          P.open = [0.1, 0.1]
          P.tilt += 0.06 * Math.sin(a.t * 8) * e
          P.face = 'wow'
          break
        case 'wave':
          set(1, vp(1.45 + 0.22 * Math.sin(a.t * 14), 1.75, 0.35), e)
          P.open[1] = 0.8
          P.tilt += 0.12 * e
          P.face = u < 0.5 ? 'wink' : 'happy'
          break
        case 'clap': {
          const g = Math.abs(Math.cos(u * Math.PI * 5))
          for (let s = 0; s < 2; s++) set(s, vp((s ? 1 : -1) * (0.1 + 0.3 * g), 0.95, 0.92), e)
          P.open = [0.2, 0.2]
          P.hop += 0.03 * g
          P.face = 'happy'
          if (g < 0.15 && !a.fired) {
            a.fired = true
            const mid = this.clawTip(0).lerp(this.clawTip(1), 0.5)
            this.sparks.burst(mid, col3('#8ff6ff'), 8, 2.4, 0.14, 0.35)
          } else if (g > 0.5) a.fired = false
          break
        }
        case 'shrug':
          for (let s = 0; s < 2; s++) set(s, vp((s ? 1 : -1) * 1.5, 0.98, 0.5), e)
          P.open = [e, e]
          P.tilt += 0.2 * e
          P.nod += 0.05 * e
          P.face = 'sad'
          break
        case 'zap':
          set(1, vp(0.5, 0.6, 1.25), e)
          P.open[1] = e
          P.face = 'angry'
          break
        case 'magnet':
          set(1, vp(0.45, 0.45, 1.35), e)
          P.open[1] = 0
          P.magnet = u > 0.05 && u < 0.95
          P.lean -= 0.04 * e
          P.face = 'angry'
          break
        case 'point': {
          const to = a.at ?? V3(0, 0, 0.3)
          const sh = vp((a.side ? 1 : -1) * 0.7 * DESIGN, 0.66 * DESIGN, 0)
          set(a.side, sh.clone().add(to.clone().sub(sh).setLength(1.55 * VK)), e)
          P.open[a.side] = 0
          P.face = 'happy'
          break
        }
        case 'surge': {
          // charging: both claws high and wide with arcs jumping between them; then both forward over the
          // marquee, the leading one thrusting at each target as the bolt leaves it
          const fire = a.at ? 1 : 0
          for (let s = 0; s < 2; s++) set(s, fire ? vp((s ? 1 : -1) * 0.75, 0.8, 1.25) : vp((s ? 1 : -1) * 1.3, 1.95, 0.4), e)
          if (a.at && this.surgeKick > 0) {
            const s = this.surgeSide
            const kick = P.claw[s].clone().add(a.at.clone().sub(P.claw[s]).setLength(0.35 * VK))
            set(s, kick, this.surgeKick * e)
          }
          P.open = [e, e]
          P.lean -= 0.04 * e
          P.face = u > 0.85 ? 'cheer' : 'angry'
          break
        }
      }
      if (a.t >= a.dur) this.act = null
    }
    this.surgeKick = Math.max(0, this.surgeKick - dt * 6)

    // the lever springs back from wherever it was let go
    if ((!this.act || this.act.kind !== 'lever') && this.leverSpring < 0 && Math.abs(this.leverAngle - LEVER_REST) > 1e-4) this.leverSpring = 0
    if (this.leverSpring >= 0) {
      if (this.leverSpring === 0) this.springFrom = this.leverAngle
      this.leverSpring += dt
      const t = this.leverSpring
      this.leverAngle = LEVER_REST + (this.springFrom - LEVER_REST) * Math.exp(-6 * t) * Math.cos(14 * t)
      if (t > 1.2) {
        this.leverAngle = LEVER_REST
        this.leverSpring = -1
      }
    }
    this.lever.arm.rotation.z = this.leverAngle

    // where he looks: a spot he was told to, the held tube, what his move aims at, or a glance about
    let target: THREE.Vector3 | null = null
    if (this.look && this.look.until > T) target = this.look.at
    else if (tz > 0.3 && this.teaseCols.length) target = V3(cellX(this.teaseCols[0]), -0.5, 0.3)
    else if (a?.at) target = a.at
    const head = v.head.getWorldPosition(V3())
    if (target) {
      const d = target.clone().sub(head)
      P.yaw += Math.max(-0.6, Math.min(0.6, Math.atan2(d.x, Math.max(0.4, d.z))))
      P.nod += Math.max(-0.3, Math.min(0.45, Math.atan2(-d.y, Math.hypot(d.x, d.z)) * 0.7))
    } else if (!sleepy && !a) {
      if (T > this.glanceAt) {
        this.glanceAt = T + rnd(2.5, 6)
        if (Math.random() < 0.35) this.glance.set(0, -0.04)
        else this.glance.set(rnd(-0.35, 0.35), rnd(-0.08, 0.18))
      }
      P.yaw += this.glance.x
      P.nod += this.glance.y
    }
    P.twist += P.yaw * 0.2

    // ease everything a little so moves blend into each other
    const B = this.body
    const k = Math.min(1, real * 14)
    B.hop += (P.hop - B.hop) * k
    B.lean += (P.lean - B.lean) * k
    B.twist += (P.twist - B.twist) * k
    B.nod += (P.nod - B.nod) * Math.min(1, real * 9)
    B.tilt += (P.tilt - B.tilt) * k
    B.yaw += (P.yaw - B.yaw) * Math.min(1, real * 9)
    const ck = P.snap >= 1 ? 1 : Math.min(1, real * (14 + 30 * P.snap))
    for (let s = 0; s < 2; s++) {
      this.claw[s].lerp(P.claw[s], ck)
      this.open[s] += (P.open[s] - this.open[s]) * Math.min(1, real * 18)
    }

    const tr = restOf(v.torso)
    v.torso.position.y = tr.y + B.hop
    v.torso.rotation.set(tr.rx, tr.ry + B.twist, tr.rz + B.lean)
    const hr = restOf(v.head)
    v.head.rotation.set(hr.rx + B.nod, hr.ry + B.yaw, hr.rz + B.tilt)
    v.torso.updateWorldMatrix(true, false)
    this.solveArm(0, this.claw[0])
    this.solveArm(1, this.claw[1])
    openClaw(v.jawsL, this.open[0])
    openClaw(v.jawsR, this.open[1])
    v.magnet.visible = P.magnet

    // his face: what the move wants, a passing mood, the alarm, or idle with blinks
    let face: Expr = P.face ?? (this.moodFace && this.moodFace.until > T ? this.moodFace.e : this.alert > 0.5 ? 'alarm' : 'idle')
    if (face === 'idle' || face === 'happy') {
      if (T > this.hostBlinkAt) {
        this.hostBlinkAt = T + rnd(2.5, 5.5)
        this.hostBlinkEnd = T + 0.13
      }
      if (T < this.hostBlinkEnd) face = 'blink'
    }
    if (face !== this.hostFace) {
      this.hostFace = face
      setHostFace(face)
    }
    const tint = this.alert > 0.5 ? '#ff5a4a' : '#8ff6ff'
    if (tint !== this.hostTint) {
      this.hostTint = tint
      setHostTint(v, tint)
    }
  }
  private springFrom = LEVER_REST

  /** the lever's knob in the world */
  private knob() {
    this.lever.arm.rotation.z = this.leverAngle
    this.lever.arm.updateWorldMatrix(true, false)
    return this.lever.arm.localToWorld(KNOB.clone())
  }

  /**
   * Two-bone IK: turns one of Volt's arms so the grip of its claw reaches `target` (world), the elbow bending
   * towards the forearm's side (fore.rotation.x < 0) and pointing out, down and back. Out of reach, the arm points
   * straight at it.
   */
  private solveArm(side: number, target: THREE.Vector3) {
    const v = this.volt
    const arm = side ? v.armR : v.armL
    const fore = side ? v.foreR : v.foreL
    const claw = side ? v.clawR : v.clawL
    const t = v.torso.worldToLocal(target.clone()).sub(arm.position)
    const d = Math.min(ARM_L1 + ARM_L2 - 0.002, Math.max(Math.abs(ARM_L2 - ARM_L1) + 0.05, t.length()))
    const dir = t.lengthSq() > 1e-8 ? t.normalize() : V3(0, -1, 0)
    const cosE = Math.min(1, Math.max(-1, (d * d - ARM_L1 * ARM_L1 - ARM_L2 * ARM_L2) / (2 * ARM_L1 * ARM_L2)))
    const bend = Math.acos(cosE)
    // where the grip is in the arm's own frame with the elbow bent by `bend` (the forearm swings towards +z)
    const local = V3(0, -ARM_L1 - ARM_L2 * Math.cos(bend), ARM_L2 * Math.sin(bend)).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(local, dir)
    // twist about the reach so the elbow points towards the pole
    const elbow = V3(0, -1, 0).applyQuaternion(q)
    const pole = V3(side ? 1 : -1, -0.6, -0.7).normalize()
    const e = elbow.addScaledVector(dir, -elbow.dot(dir))
    const pp = pole.addScaledVector(dir, -pole.dot(dir))
    if (e.lengthSq() > 1e-6 && pp.lengthSq() > 1e-6) {
      e.normalize()
      pp.normalize()
      let ang = Math.acos(Math.min(1, Math.max(-1, e.dot(pp))))
      if (V3().crossVectors(e, pp).dot(dir) < 0) ang = -ang
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, ang))
    }
    arm.quaternion.copy(q)
    fore.rotation.set(-bend, 0, 0)
    claw.rotation.set(0.1, 0, 0)
  }

  /* ---------------- the pieces ---------------- */

  private animate(p: Piece, dt: number, real: number) {
    this.advance(p, dt)
    if (!this.live.has(p)) return
    const T = this.clock + p.phase
    p.win += (p.winTo - p.win) * Math.min(1, dt * 12)
    if (p.winTo === 0 && p.win < 0.002) p.win = 0
    p.winT = p.winTo > 0 ? p.winT + dt : 0
    p.front += (p.frontTo - p.front) * Math.min(1, dt * 12)
    if (p.frontTo === 0 && p.front < 0.002) p.front = 0
    p.squash = Math.max(0, p.squash - dt * 3.2)
    p.punch = Math.max(0, p.punch - dt * 4)
    p.shake = Math.max(0, p.shake - dt * 3)
    p.hop = Math.max(0, p.hop - dt * 2.4)
    const w = smooth(clamp01(p.win))

    // a robot hops in its tube now and then
    if (!this.inGrid && p.state === 'idle' && p.winTo === 0 && this.clock > p.hopAt) {
      p.hopAt = this.clock + rnd(6, 14)
      if (!isBonus(p.sym) && Math.random() < 0.5) p.hop = 1
    }

    // in the Power Grid the cells stand forward in their sockets, a little bigger, filling them
    const inSock = this.inGrid && this.board[p.col * ROWS + p.row] === p
    if (p.state === 'idle') {
      const zTo = inSock ? GRID_Z : 0
      p.z += (zTo - p.z) * Math.min(1, dt * 8)
    }
    p.sockK += ((inSock ? 1 : 0) - p.sockK) * Math.min(1, dt * 8)
    let x = cellX(p.col)
    let y = p.y + (p.hop > 0 ? 0.09 * Math.sin(Math.PI * (1 - p.hop)) : 0)
    const z = p.z + p.front * Z_WIN
    const sq = p.squash * p.squash * Math.cos((1 - p.squash) * Math.PI * 2.5)
    const pk = p.punch > 0 ? Math.sin(Math.PI * (1 - p.punch)) * p.punch : 0
    const grow = (1 + GRID_GROW * p.sockK) * (1 + 0.1 * w + 0.25 * pk + p.charge * (0.12 + 0.03 * Math.sin(this.time * 40)))
    let sx = grow * (1 + 0.14 * sq)
    let sy = grow * (1 - 0.16 * sq)
    let rz = 0
    let ry = 0
    if (p.state === 'vacuum') {
      const st = Math.min(0.4, p.vy * 0.025)
      sy *= 1 + st
      sx *= 1 - st * 0.5
      rz += Math.sin(p.t * 30 + p.phase) * 0.08
    } else if (p.state === 'fall') {
      sy *= 1.08
      sx *= 0.95
    } else if (p.state === 'appear') {
      const u = p.t / 0.4
      const k = u < 0.55 ? 1.2 * ease(u / 0.55) : 1.2 - 0.2 * smooth((u - 0.55) / 0.45)
      sx *= k
      sy *= k
      ry = (1 - Math.min(1, u * 1.6)) * Math.PI
    } else if (p.state === 'vanish') {
      const k = 1 + 0.45 * (p.t / 0.12)
      sx *= k
      sy *= k
    } else if (p.state === 'slam') {
      const k = 1 + 0.35 * (1 - p.t / SLAM_T)
      sx *= k
      sy *= k
    }
    if (p.shake > 0) {
      x += Math.sin(this.time * 70 + p.phase) * 0.05 * p.shake
      rz += Math.sin(this.time * 50) * 0.12 * p.shake
    }

    const P = p.parts
    switch (p.sym) {
      case 'rex':
      case 'clank': {
        const l = 0.07 * Math.sin(T * 2.1) + w * (0.75 + 0.45 * Math.sin(p.winT * 13))
        const r = 0.07 * Math.sin(T * 2.1 + 1.3) + w * (0.75 + 0.45 * Math.sin(p.winT * 13 + 1.5))
        if (P.armL) P.armL.rotation.z = restOf(P.armL).rz - l
        if (P.armR) P.armR.rotation.z = restOf(P.armR).rz + r
        y += 0.012 * Math.sin(T * 2.4) + 0.05 * w * Math.abs(Math.sin(p.winT * 9))
        break
      }
      case 'dot':
        if (P.head) P.head.rotation.z = restOf(P.head).rz + 0.1 * Math.sin(T * 1.3) + w * 0.25 * Math.sin(p.winT * 9)
        if (P.arms) P.arms.rotation.z = restOf(P.arms).rz + 0.14 * Math.sin(T * 1.9) + w * 0.5 * Math.sin(p.winT * 11)
        if (P.wheel) P.wheel.rotation.z -= real * (1.6 * Math.cos(T * 1.9)) + dt * 14 * w
        rz += 0.05 * Math.sin(T * 1.9)
        break
      case 'zip':
        if (P.rotorL) P.rotorL.rotation.y += real * 26 + dt * 18 * w
        if (P.rotorR) P.rotorR.rotation.y -= real * 26 + dt * 18 * w
        y += 0.03 * Math.sin(T * 2.6) + 0.06 * w * Math.sin(p.winT * 8)
        rz += 0.04 * Math.sin(T * 1.7) + 0.12 * w * Math.sin(p.winT * 7)
        break
      case 'gear':
        if (P.gear) P.gear.rotation.z -= real * 0.6 + dt * 7 * w
        y += 0.05 * w * Math.abs(Math.sin(p.winT * 9))
        break
      case 'wild': {
        if (P.cage) P.cage.rotation.y += real * 1.3 + dt * 6 * w
        const pulse = 1 + 0.03 * Math.sin(T * 5)
        sx *= pulse
        sy *= pulse
        break
      }
      case 'nut':
      case 'battery':
      case 'chip':
        rz += 0.05 * Math.sin(T * 1.4)
        y += 0.01 * Math.sin(T * 2) + 0.1 * w * Math.abs(Math.sin(p.winT * 8))
        break
      default:
        // the bonus symbols
        y += 0.012 * Math.sin(T * 2.2)
        rz += 0.025 * Math.sin(T * 1.6)
    }

    p.root.position.set(x, y, z)
    p.inner.rotation.set(0, ry, rz)
    p.inner.scale.set(sx, sy, grow)

    // the glow behind winners, arrivals and bots at work
    p.glowAmt += (Math.max(p.glowTo, p.charge * 0.8) - p.glowAmt) * Math.min(1, dt * 8)
    const glow = p.glowAmt * (0.32 + 0.08 * Math.sin(this.clock * 9))
    p.glow.material.opacity = glow
    p.glow.visible = glow > 0.01
    if (p.glow.visible) p.glow.scale.setScalar(1.35 + 0.25 * w)
    if (w > 0.5 && Math.random() < dt * 7) {
      const c = col3(SYMBOL_COLOR[p.sym], 2)
      this.sparks.emit(x + rnd(-0.4, 0.4), y + rnd(-0.4, 0.4), z + 0.5, rnd(-0.3, 0.3), rnd(0.3, 1.2), 0, c, rnd(0.1, 0.2), rnd(0.4, 0.7), 0, 1)
    }
    this.updateFace(p)
  }

  /** a piece's screen face: a passing mood, a win, a tease, or idle with blinks (Zip's iris dilates now and then) */
  private updateFace(p: Piece) {
    if (!hasFace(p.sym)) return
    const T = this.clock
    let e: Expr = 'idle'
    if (p.moodUntil > T) e = p.mood
    else if (p.win > 0.5) e = Math.floor(p.winT / 0.4) % 2 ? 'cheer' : 'happy'
    else if (this.tease > 0.5 && !isBonus(p.sym) && p.state === 'idle') e = 'wow'
    else if (this.alert > 0.5 && p.charge === 0) e = 'happy'
    if (e === 'idle' || e === 'happy') {
      if (T > p.blinkAt) {
        p.blinkAt = T + rnd(2.2, 6)
        p.blinkEnd = T + 0.13
      }
      if (T < p.blinkEnd) e = 'blink'
      else if (p.sym === 'zip' && Math.sin(T * 0.9 + p.phase * 3) > 0.94) e = 'wow'
    }
    if (e !== p.face) {
      p.face = e
      setFace(p.model, e)
    }
  }

  /** moves a piece along its current move */
  private advance(p: Piece, dt: number) {
    if (p.state === 'idle') return
    if (p.wait > 0) {
      p.wait -= dt
      if (p.wait > 0) return
      dt = -p.wait
      p.wait = 0
    }
    p.t += dt
    switch (p.state) {
      case 'vacuum':
        p.vy += VAC_ACC * dt
        p.y += p.vy * dt
        if (p.y > WIN_H + 0.75) this.release(p)
        return
      case 'fall': {
        const u = Math.min(1, p.t / FALL_T)
        p.y = p.y0 + (p.ty - p.y0) * u * u
        if (u >= 1) {
          p.y = p.ty
          p.state = 'settle'
          // a compression wave: the bottom robot squashes first, the ones above a moment later
          p.t = -(ROWS - 1 - p.row) * 0.025
          if (p.t >= 0) p.squash = 1
          const f = p.onArrive
          p.onArrive = null
          f?.()
        }
        return
      }
      case 'settle': {
        if (p.t < 0) return
        if (p.t - dt < 0) p.squash = 1
        const u = p.t / SETTLE_T
        p.y = p.ty + 0.07 * Math.exp(-5 * u) * Math.abs(Math.sin(u * Math.PI * 2.2))
        if (u >= 1) {
          p.y = p.ty
          p.state = 'idle'
          this.untrack(p)
        }
        return
      }
      case 'slam': {
        const u = Math.min(1, p.t / SLAM_T)
        p.z = GRID_Z + (p.z0 - GRID_Z) * (1 - u * u)
        p.y = p.y0 + (p.ty - p.y0) * u * u
        if (u >= 1) {
          p.z = GRID_Z
          p.y = p.ty
          p.state = 'idle'
          p.squash = 1
          const f = p.onArrive
          p.onArrive = null
          f?.()
        }
        return
      }
      case 'appear':
        if (p.t >= 0.4) p.state = 'idle'
        return
      case 'vanish':
        if (p.t >= 0.12) {
          this.shatter(p)
          this.release(p)
        }
        return
    }
  }

  /* ---------------- effects ---------------- */

  private fly(from: THREE.Vector3, ctrl: THREE.Vector3, to: THREE.Vector3, dur: number, bill: Bill | null, color: THREE.Color, trail: number, orb: boolean, done: () => void = () => {}) {
    if (this.disposed) done()
    else this.flights.push({ from, ctrl, to, t: 0, dur, bill, color, trail, orb, done })
  }

  private updateFx(dt: number, real: number) {
    // orbs and coin ghosts in flight
    if (this.flights.length) {
      const pos = this.flyAt
      for (const f of this.flights) {
        f.t = Math.min(1, f.t + dt / f.dur)
        const t = f.t
        const a = 1 - t
        pos.set(0, 0, 0).addScaledVector(f.from, a * a).addScaledVector(f.ctrl, 2 * a * t).addScaledVector(f.to, t * t)
        if (f.bill) {
          f.bill.x = pos.x
          f.bill.y = pos.y
          f.bill.z = pos.z
          f.bill.rot += dt * 6
        }
        if (Math.random() < dt * f.trail) this.sparks.emit(pos.x, pos.y, pos.z, rnd(-0.3, 0.3), rnd(-0.3, 0.3), 0, f.color.clone().multiplyScalar(1.6), rnd(0.1, 0.2), rnd(0.25, 0.4), 0, 1)
      }
      const done = this.flights.filter((f) => f.t >= 1)
      this.flights = this.flights.filter((f) => f.t < 1)
      for (const f of done) f.done()
    }

    // links crackle between the winners on neighbouring reels
    if (this.links.length && this.time >= this.linkAt) {
      this.linkAt = this.time + 0.3
      for (const l of this.links) {
        if (!this.live.has(l.a) || !this.live.has(l.b)) continue
        const a = l.a.root.position.clone().setZ(l.a.root.position.z + 0.3)
        const b = l.b.root.position.clone().setZ(l.b.root.position.z + 0.3)
        this.wayArcs.emit(a, b, l.c, { life: 0.34, width: 0.034, jag: 0.09 })
      }
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
        if (Math.random() < dt * 70) this.sparks.emit(r.x + rnd(-0.03, 0.03), r.y, r.z, rnd(-0.2, 0.2), -1, 0, col3('#ffd9a0', 2), rnd(0.12, 0.2), rnd(0.3, 0.5), -2)
        if (r.y >= r.top) {
          r.wait = -1
          const hot = r.color.clone().multiplyScalar(2.4)
          this.sparks.emit(r.x, r.y, r.z, 0, 0, 0, r.color.clone().multiplyScalar(1.2), 1.1, 0.25, 0, 0, 1)
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
      const gold = COIN_GOLD
      for (let i = 0; i < n; i++) {
        const z = rnd(0.6, 3.2)
        const v = this.viewHalf(z)
        this.coins.emit(V3(rnd(-v.w, v.w), this.camY + v.h + 0.4, z), V3(rnd(-0.6, 0.6), rnd(-4, -1), 0), gold, rnd(2.6, 3.6), 2.6, -7, rnd(5, 13))
      }
      if (this.onCoin && this.clock - this.coinAt > 0.11) {
        this.coinAt = this.clock
        this.onCoin()
      }
    }

    this.sparks.update(dt)
    this.sparks.points.visible = this.sparks.list.length > 0
    this.arcs.update(dt)
    this.arcs.mesh.visible = this.arcs.count > 0
    this.wayArcs.update(dt)
    this.wayArcs.mesh.visible = this.wayArcs.count > 0
    this.rings.update(dt)
    this.glows.update(dt)
    this.puffs.update(dt)
    this.ghosts.update(dt)
    this.waves.update(dt)
    this.floaters.update(dt)
    this.updateBits(this.gears, real)
    this.updateBits(this.bolts, real)
    this.updateBits(this.nuts, real)
    this.updateBits(this.coins, real)
  }

  private updateBits(b: Bits, real: number) {
    b.update(real)
    b.mesh.visible = b.list.length > 0
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerleave', this.onLeave)
    // let anything awaiting the scene finish, so the screen code can unwind
    for (const t of this.timers) if (!t.job) t.fn()
    for (const f of this.flights) f.done()
    for (const c of this.conds) c.fn()
    this.timers = []
    this.conds = []
    this.flights = []
    for (const p of [...this.live]) this.release(p)
    for (const list of this.pool.values())
      for (const p of list) {
        p.glow.material.dispose()
        releaseSymbol(p.model)
      }
    this.pool.clear()
    for (const o of this.own) o.dispose()
    for (const pass of this.composer.passes) pass.dispose()
    this.composer.dispose()
    // the shared models (materials, atlas, environment map) belong to this renderer: free them with it
    disposeModels()
    // the glow and ring textures are shared module-level caches (lib/three/fx); disposing them drops this renderer's
    // listeners on them, which would otherwise keep the whole renderer alive (the next scene uploads them again)
    glowTexture().dispose()
    ringTexture().dispose()
    // likewise three's one geometry shared by every Sprite (the floaters and the glows behind pieces)
    ;(this.floaters.group.children[0] as THREE.Sprite | undefined)?.geometry.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
