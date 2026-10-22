import * as THREE from 'three'

/*
  The stage's shaders, kept in one place so the scene files read as layout rather than GLSL.

  Neon Bay is mostly drawn by a few big materials rather than many small meshes:
    sky        a dome with the night gradient (indigo overhead, a magenta city glow low over the far shore, like the
               lobby cover), stars that twinkle, a halo round the moon
    water      the bay: waves as normals from a few travelling sines, the sky and the city's lights reflected (the city
               as a band of light round the horizon, worked out once from the buildings' lit windows, so each tower
               throws its own streak down the water), a glitter path under the moon, foam along the sea wall, round
               the pier's piles and where a kaiju hits the water, and the rings spreading from it
    ground     the plaza's wet asphalt: paving, a neon ring round the fighting ground, the casino's emblem painted in
               the middle, the neon signs reflected as streaks (a sharp highlight from each sign on a surface whose
               normal is roughened in puddles), pools of light under the spotlights and the kaijus' own glow, soft
               shadows, glowing cracks where Gorrath pounds the ground, and the glow under a beam
    shafts     light shafts (searchlights, spotlights, the lighthouse): additive cones that fade along their length and
               toward their silhouette edges
    lamps      points of light (street lamps, marquee bulbs, the wheel's lights, aircraft warning lights) that can
               blink, chase and go out with their building
    signs      the neon signs: quads from one atlas, tinted, some flickering, going dark with their building
    windows    the buildings are instanced boxes, cylinders and cones on the toon material; a few lines added to it
               draw every lit window procedurally from each instance's size, so a tower of any size gets its grid
    ink        the buildings' outlines: the same instances drawn again a little bigger, back faces only, in ink
  The custom materials fog themselves (FogExp2, the same colour and density as the scene's).
*/

export const FOG = { color: new THREE.Color('#2a1240'), density: 0.0052 }

const FOG_PARS = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
float fogOf(float d) { float k = uFogDensity * d; return 1.0 - exp(-k * k); }
#ifndef SS_DEFINED
#define SS_DEFINED
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
#endif
`
const NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`
/** the night sky's colour in a direction (shared by the dome and the water's reflection) */
const SKY_FN = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uCityGlow;
#ifndef SS_DEFINED
#define SS_DEFINED
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
#endif
vec3 skyCol(vec3 d) {
  float h = d.y;
  vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
  c = mix(c, uZenith, smoothstep(0.16, 0.65, h));
  // the city's glow low on the horizon, strongest over the far shore
  c += uCityGlow * exp(-max(h, 0.0) * 13.0) * (0.45 + 0.55 * max(0.0, -d.z));
  return c;
}
`
const fogUniforms = () => ({ uFogColor: { value: FOG.color }, uFogDensity: { value: FOG.density } })
export const skyUniforms = () => ({
  uZenith: { value: new THREE.Color(0.018, 0.016, 0.06) },
  uMid: { value: new THREE.Color(0.075, 0.035, 0.17) },
  uHorizon: { value: new THREE.Color(0.3, 0.085, 0.27) },
  uCityGlow: { value: new THREE.Color(0.55, 0.16, 0.34) },
})

/* ------------------------------------------------------------------ */
/*  Sky                                                                 */
/* ------------------------------------------------------------------ */

export function skyMaterial(moonDir: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms(), uTime: { value: 0 }, uMoonDir: { value: moonDir } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uMoonDir;
      varying vec3 vDir;
      ${SKY_FN}
      float h13(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyCol(d);
        if (d.y < 0.0) c = mix(uHorizon * 0.7, vec3(0.02, 0.015, 0.05), ss(0.0, -0.15, d.y));
        // stars: one in a few hundred cells of a fine grid on the dome, twinkling, fading toward the horizon glow
        vec3 g = d * 260.0;
        vec3 cell = floor(g);
        float s = h13(cell);
        if (s > 0.9965) {
          vec3 f = fract(g) - 0.5;
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + s * 40.0) + s * 300.0);
          c += vec3(0.85, 0.85, 1.0) * ss(0.32, 0.0, length(f)) * tw * smoothstep(0.06, 0.35, d.y) * (0.7 + (s - 0.9965) * 300.0);
        }
        // the moon's halo
        float m = max(0.0, dot(d, uMoonDir));
        c += vec3(0.45, 0.5, 0.8) * pow(m, 250.0) * 0.6 + vec3(0.3, 0.22, 0.5) * pow(m, 14.0) * 0.28;
        // a few thin clouds, lit from below by the city
        float cl = smoothstep(0.55, 0.85, sin(d.x * 9.0 + d.z * 4.0 + uTime * 0.01) * 0.5 + 0.5) * smoothstep(0.05, 0.12, d.y) * ss(0.42, 0.18, d.y);
        c = mix(c, c * 0.6 + uCityGlow * 0.18, cl * 0.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  })
}

/** the far mountains: dark silhouettes against the city glow, hazier toward their feet */
export function mountainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms(), uTop: { value: new THREE.Color('#0b0618') } },
    vertexShader: /* glsl */ `
      attribute float aH;
      varying float vH;
      varying vec3 vDir;
      void main() {
        vH = aH;
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      varying float vH;
      varying vec3 vDir;
      ${SKY_FN}
      void main() {
        vec3 haze = skyCol(normalize(vec3(vDir.x, 0.0, vDir.z))) * 0.8;
        gl_FragColor = vec4(mix(haze, uTop, smoothstep(0.0, 0.75, vH)), 1.0);
      }`,
  })
}

/* ------------------------------------------------------------------ */
/*  Water                                                               */
/* ------------------------------------------------------------------ */

export const FOAMS = 6

export function waterMaterial(moonDir: THREE.Vector3, refl: THREE.Texture, shoreZ: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...skyUniforms(),
      ...fogUniforms(),
      uTime: { value: 0 },
      uMoonDir: { value: moonDir },
      uRefl: { value: refl },
      uShore: { value: shoreZ },
      uCalm: { value: 1 },
      // splashes: x, z, age in seconds (negative: none), size
      uFoam: { value: Array.from({ length: FOAMS }, () => new THREE.Vector4(0, 0, -1, 0)) },
      // light on the water from the stage: the kaijus' glow and a beam over it (x, z, radius, strength)
      uGlow: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uGlowCol: { value: [new THREE.Color(), new THREE.Color()] },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uMoonDir;
      uniform sampler2D uRefl;
      uniform float uShore;
      uniform float uCalm;
      uniform vec4 uFoam[${FOAMS}];
      uniform vec4 uGlow[2];
      uniform vec3 uGlowCol[2];
      varying vec3 vWorld;
      ${SKY_FN}
      ${FOG_PARS}
      ${NOISE}
      vec2 wave(vec2 p, vec2 dir, float k, float a, float sp, float t) {
        float ph = dot(dir, p) * k + t * sp;
        return dir * cos(ph) * k * a;
      }
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;
        float t = uTime * uCalm;
        vec2 g = vec2(0.0);
        g += wave(p, normalize(vec2(0.3, 1.0)), 0.21, 0.32, 1.1, t);
        g += wave(p, normalize(vec2(-0.8, 0.6)), 0.37, 0.16, 1.7, t);
        g += wave(p, normalize(vec2(0.9, 0.2)), 0.73, 0.07, 2.3, t);
        g += wave(p, normalize(vec2(-0.2, -1.0)), 1.31, 0.035, 3.1, t);
        g += (vec2(vnoise(p * 0.9 + t * 0.4), vnoise(p.yx * 0.9 - t * 0.35)) - 0.5) * 0.25;
        // the waves flatten into the distance (and stop aliasing)
        g *= 1.0 / (1.0 + dist * 0.012);
        float foam = 0.0;
        for (int i = 0; i < ${FOAMS}; i++) {
          vec4 f = uFoam[i];
          if (f.z < 0.0) continue;
          vec2 d = p - f.xy;
          float r = length(d) + 1e-3;
          float front = f.z * 9.0;
          float ring = sin(r * 1.4 - f.z * 9.0) * exp(-f.z * 0.55) * exp(-abs(r - front) * 0.18) * f.w;
          g += d / r * ring * 0.9;
          // white water where it came down, then a ring of foam spreading and breaking up
          float n = vnoise(p * 1.6 + f.z);
          foam += f.w * (ss(f.w * 5.5, 0.0, r) * exp(-f.z * 0.35) * (0.6 + 0.4 * n) + ss(2.2, 0.0, abs(r - front * 0.8)) * exp(-f.z * 0.45) * n);
        }
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 sky = skyCol(R);
        // the city's lights: the band round the horizon (rgb, a third of its strength) up to the skyline's height (a, half)
        float az = atan(R.x, -R.z);
        float el = R.y / max(1e-3, length(R.xz));
        vec4 band = texture2D(uRefl, vec2(az / 6.2831853 + 0.5, 0.5));
        float top = band.a * 0.5;
        vec3 city = band.rgb * 3.0 * ss(top + 0.012, top - 0.004, el);
        float mg = max(dot(R, uMoonDir), 0.0);
        vec3 moon = vec3(0.9, 0.92, 1.1) * (pow(mg, 600.0) * 9.0 + pow(mg, 60.0) * 0.35);
        vec3 deep = vec3(0.008, 0.016, 0.04);
        vec3 col = deep + sky * fres * 0.55 + city * (0.25 + 0.75 * fres) + moon * (0.4 + fres);
        // the stage's light on the water
        for (int i = 0; i < 2; i++) {
          float d = length(p - uGlow[i].xy);
          col += uGlowCol[i] * uGlow[i].w * pow(max(0.0, 1.0 - d / max(uGlow[i].z, 0.01)), 2.0);
        }
        // foam along the sea wall, and round the pier's piles
        float wall = uShore - vWorld.z;
        float n2 = vnoise(vec2(p.x * 0.8 + t * 0.6, p.y * 0.8));
        foam += ss(1.4, 0.0, wall + n2 * 0.9 - 0.25 * sin(t * 1.3 + p.x * 0.3)) * 0.55;
        if (vWorld.x > 15.0 && vWorld.x < 23.0 && vWorld.z > -44.0) {
          vec2 q = vec2(min(abs(vWorld.x - 17.2), abs(vWorld.x - 20.8)), abs(mod(vWorld.z - uShore, 4.0) - 2.0));
          foam += ss(0.9, 0.25, length(q) + n2 * 0.3) * 0.45;
        }
        col = mix(col, vec3(0.72, 0.78, 0.92), clamp(foam, 0.0, 1.0) * 0.85);
        col = mix(col, uFogColor, fogOf(dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

/* ------------------------------------------------------------------ */
/*  The plaza's wet ground                                              */
/* ------------------------------------------------------------------ */

export const GLINTS = 12
export const POOLS = 6
export const CRACKS = 8

export function groundMaterial(logo: THREE.Texture, plazaR: number, shoreZ: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uTime: { value: 0 },
      uLogo: { value: logo },
      uPlaza: { value: plazaR },
      uShore: { value: shoreZ },
      uRing: { value: new THREE.Color(0.13, 0.83, 0.44) },
      uRingK: { value: 1 },
      // neon signs reflected in the wet asphalt: position and colour (intensity in the colour)
      uGlint: { value: Array.from({ length: GLINTS }, () => new THREE.Vector3(0, -100, 0)) },
      uGlintCol: { value: Array.from({ length: GLINTS }, () => new THREE.Color(0, 0, 0)) },
      // pools of light: x, z, radius, strength
      uPool: { value: Array.from({ length: POOLS }, () => new THREE.Vector4(0, 0, 1, 0)) },
      uPoolCol: { value: Array.from({ length: POOLS }, () => new THREE.Color(0, 0, 0)) },
      // soft shadows under the kaiju: x, z, radius, strength
      uShadow: { value: [new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 1, 0)] },
      // cracks and scorch marks: x, z, radius, age in seconds (negative: none)
      uCrack: { value: Array.from({ length: CRACKS }, () => new THREE.Vector4(0, 0, 1, -1)) },
      uCrackCol: { value: Array.from({ length: CRACKS }, () => new THREE.Color(1, 0.4, 0.1)) },
      // a beam's glow along the ground: from (x, y) to (z, w), and its colour (intensity in the colour)
      uBeam: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uBeamCol: { value: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)] },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uLogo;
      uniform float uPlaza;
      uniform float uShore;
      uniform vec3 uRing;
      uniform float uRingK;
      uniform vec3 uGlint[${GLINTS}];
      uniform vec3 uGlintCol[${GLINTS}];
      uniform vec4 uPool[${POOLS}];
      uniform vec3 uPoolCol[${POOLS}];
      uniform vec4 uShadow[2];
      uniform vec4 uCrack[${CRACKS}];
      uniform vec3 uCrackCol[${CRACKS}];
      uniform vec4 uBeam[2];
      uniform vec3 uBeamCol[2];
      varying vec3 vWorld;
      ${FOG_PARS}
      ${NOISE}
      float segDist(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float k = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0); return length(p - a - ab * k); }
      void main() {
        vec2 p = vWorld.xz;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float r = length(p);
        float fw = fwidth(r);
        // asphalt: dark, mottled, with puddles where it is wetter
        float n = vnoise(p * 0.35) * 0.6 + vnoise(p * 1.7) * 0.4;
        float wet = smoothstep(0.45, 0.7, vnoise(p * 0.12 + 3.1) * 0.7 + vnoise(p * 0.5) * 0.3);
        vec3 col = mix(vec3(0.03, 0.033, 0.05), vec3(0.055, 0.058, 0.08), n);
        float plaza = 1.0 - smoothstep(uPlaza - fw, uPlaza + fw, r);
        // the plaza's paving: rings and spokes of lighter stone, fading out with distance
        float ang = atan(p.y, p.x);
        float rings = ss(0.08, 0.0, abs(fract(r / 3.2) - 0.5) - 0.44) * plaza;
        float spokes = ss(0.05, 0.0, abs(fract(ang * 48.0 / 6.2831853 + 0.5) - 0.5) * r * 6.2831853 / 48.0 - 0.04) * plaza * step(5.0, r);
        col += vec3(0.022, 0.024, 0.035) * max(rings, spokes) * (1.0 - smoothstep(30.0, 120.0, dist));
        // streets beyond the plaza: lane lines running round it
        float street = step(uPlaza + 1.5, r) * (1.0 - step(uPlaza + 15.0, r));
        float lane = ss(0.12, 0.0, abs(r - uPlaza - 8.0) - 0.06) * step(0.5, fract(ang * 30.0));
        col += vec3(0.12, 0.11, 0.06) * lane * street * (1.0 - smoothstep(40.0, 140.0, dist));
        // the casino's emblem painted in the middle of the plaza
        vec2 lu = p / 18.0 + 0.5;
        if (lu.x > 0.0 && lu.x < 1.0 && lu.y > 0.0 && lu.y < 1.0) {
          vec4 lg = texture2D(uLogo, vec2(lu.x, 1.0 - lu.y));
          col = mix(col, lg.rgb * 0.16, lg.a * 0.9);
        }
        // wet: a sharp highlight from each neon sign, on a surface roughened outside the puddles
        vec2 rough = (vec2(vnoise(p * 2.3), vnoise(p.yx * 2.3 + 7.0)) - 0.5) * mix(0.22, 0.04, wet);
        vec3 N = normalize(vec3(rough.x, 1.0, rough.y));
        vec3 R = reflect(-V, N);
        vec3 spec = vec3(0.0);
        for (int i = 0; i < ${GLINTS}; i++) {
          vec3 L = uGlint[i] - vWorld;
          float ld = length(L);
          float s = max(dot(R, L / ld), 0.0);
          spec += uGlintCol[i] * (pow(s, mix(90.0, 600.0, wet)) * mix(1.2, 4.0, wet) + pow(s, 12.0) * 0.06) * (30.0 / (30.0 + ld));
        }
        col += spec * (0.35 + 0.65 * wet);
        // pools of light
        for (int i = 0; i < ${POOLS}; i++) {
          float d = length(p - uPool[i].xy) / max(uPool[i].z, 0.01);
          float k = pow(max(0.0, 1.0 - d), 1.6);
          col += uPoolCol[i] * uPool[i].w * k * (0.75 + 0.5 * wet);
        }
        // the ring of light round the fighting ground, on the land side only
        float edge = ss(0.5, 0.0, uShore + 0.3 - vWorld.z);
        float onShore = step(uShore, vWorld.z);
        float rd = abs(r - uPlaza + 0.25);
        col += uRing * uRingK * (ss(0.16 + fw, 0.04, rd) * 2.6 + exp(-rd * 1.4) * 0.22) * onShore * (1.0 - edge);
        float inner = abs(r - 10.0);
        col += uRing * uRingK * ss(0.08 + fw, 0.0, inner) * step(0.5, fract(ang * 24.0 / 6.2831853)) * 0.5 * onShore;
        // the beam's glow under it
        for (int i = 0; i < 2; i++) {
          float bd = segDist(p, uBeam[i].xy, uBeam[i].zw);
          col += uBeamCol[i] * exp(-bd * bd * 0.12);
        }
        // cracks: a web of glowing lines round a slam, cooling to scorch
        for (int i = 0; i < ${CRACKS}; i++) {
          vec4 c = uCrack[i];
          if (c.w < 0.0) continue;
          vec2 d = p - c.xy;
          float cr = length(d) / c.z;
          if (cr > 1.0) continue;
          float a = atan(d.y, d.x);
          float web = ss(0.07, 0.0, abs(fract(a * 1.9 + vnoise(d * 0.7) * 1.4) - 0.5) - 0.42) + ss(0.05, 0.0, abs(fract(cr * 3.0 + vnoise(d) * 0.5) - 0.5) - 0.46);
          float fade = 1.0 - smoothstep(0.55, 1.0, cr);
          float heat = exp(-c.w * 0.7);
          col = mix(col, col * 0.35, ss(1.0, 0.2, cr) * 0.7);
          col += uCrackCol[i] * min(web, 1.0) * fade * (heat * 3.0 + 0.04);
        }
        // the kaijus' shadows
        for (int i = 0; i < 2; i++) {
          float d = length(p - uShadow[i].xy) / max(uShadow[i].z, 0.01);
          col *= 1.0 - uShadow[i].w * (1.0 - smoothstep(0.35, 1.0, d));
        }
        col = mix(col, uFogColor, fogOf(dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

/* ------------------------------------------------------------------ */
/*  Light shafts                                                        */
/* ------------------------------------------------------------------ */

/** a cone with its tip at the origin opening down -y (length 1, radius 1 at the base), for scaling into a shaft */
export function shaftGeometry() {
  const g = new THREE.CylinderGeometry(0.0, 1, 1, 28, 6, true)
  g.translate(0, -0.5, 0)
  return g
}

export function shaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...fogUniforms() },
    vertexShader: /* glsl */ `
      attribute vec4 aShaft;
      varying float vV;
      varying vec3 vN;
      varying vec3 vView;
      varying vec4 vShaft;
      varying float vDist;
      void main() {
        vV = -position.y;
        vShaft = aShaft;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vView = cameraPosition - w.xyz;
        vDist = length(vView);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying float vV;
      varying vec3 vN;
      varying vec3 vView;
      varying vec4 vShaft;
      varying float vDist;
      ${FOG_PARS}
      void main() {
        float edge = abs(dot(normalize(vN), normalize(vView)));
        float k = pow(edge, 1.6) * pow(clamp(1.0 - vV, 0.0, 1.0), vShaft.w) * smoothstep(0.0, 0.06, vV);
        gl_FragColor = vec4(vShaft.rgb * k * (1.0 - fogOf(vDist) * 0.8), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/* ------------------------------------------------------------------ */
/*  Lamps                                                               */
/* ------------------------------------------------------------------ */

export function lampMaterial(tex: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uTime: { value: 0 }, uScale: { value: 400 }, ...fogUniforms() },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec3 aLamp;
      attribute float aOn;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vColor;
      varying float vDist;
      void main() {
        // aLamp: size, blink rate (0 steady), phase; a chase runs round a marquee by the phase
        float on = aOn;
        if (aLamp.y > 0.0) on *= 0.25 + 0.75 * step(0.5, fract(uTime * aLamp.y + aLamp.z));
        vColor = aColor * on;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_PointSize = max(1.5, aLamp.x * uScale / -mv.z) * step(0.001, on);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vDist;
      ${FOG_PARS}
      void main() {
        float a = texture2D(map, gl_PointCoord).a;
        gl_FragColor = vec4(vColor * a * (1.0 - fogOf(vDist) * 0.7), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

/* ------------------------------------------------------------------ */
/*  Neon signs                                                          */
/* ------------------------------------------------------------------ */

export function signMaterial(atlas: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas }, uTime: { value: 0 }, ...fogUniforms() },
    vertexShader: /* glsl */ `
      attribute vec4 aUv;
      attribute vec4 aTint;
      attribute float aDark;
      varying vec2 vUv;
      varying vec4 vTint;
      varying float vDark;
      varying float vDist;
      void main() {
        vUv = aUv.xy + uv * aUv.zw;
        vTint = aTint;
        vDark = aDark;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float uTime;
      varying vec2 vUv;
      varying vec4 vTint;
      varying float vDark;
      varying float vDist;
      ${FOG_PARS}
      void main() {
        vec4 tx = texture2D(map, vUv);
        // a flickering sign (tint.a > 0) cuts out for a moment now and then, in its own rhythm
        float fl = 1.0;
        if (vTint.a > 0.0) {
          float b = floor(uTime * 9.0 + vTint.a * 37.0);
          float h = fract(sin(b * 12.9898 + vTint.a * 78.233) * 43758.5453);
          fl = h < 0.07 ? 0.15 : 1.0;
        }
        vec3 c = vTint.rgb * tx.a * vDark * fl;
        gl_FragColor = vec4(c * (1.0 - fogOf(vDist) * 0.75), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/* ------------------------------------------------------------------ */
/*  Buildings: windows on the toon material, and the ink hulls          */
/* ------------------------------------------------------------------ */

/**
 * The instanced toon material for every building part. Each instance carries:
 *   aWin   rgb the colour of its lit windows (over 1 to bloom), a the share of them lit
 *   aGrid  x the window cell's width, y a storey's height, z the style (0 none, 1 grid, 2 ribbons, 3 tall slots,
 *          4 a lit shop front on its front face), w a seed
 *   aTrim  rgb a neon trim along its top edge (0 for none), a the trim's depth
 *   aDark  1 lit, 0 dark (a fallen building's windows go out)
 */
export function buildingMaterial(ramp: THREE.Texture) {
  const u = { uTime: { value: 0 } }
  const m = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: ramp })
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aWin;
        attribute vec4 aGrid;
        attribute vec4 aTrim;
        attribute float aDark;
        varying vec3 vObjPos;
        varying vec3 vObjN;
        varying vec3 vSize;
        varying vec4 vWin;
        varying vec4 vGrid;
        varying vec4 vTrim;
        varying float vDark;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vObjPos = position;
        vObjN = normal;
        vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vWin = aWin;
        vGrid = aGrid;
        vTrim = aTrim;
        vDark = aDark;`,
      )
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vObjPos;
        varying vec3 vObjN;
        varying vec3 vSize;
        varying vec4 vWin;
        varying vec4 vGrid;
        varying vec4 vTrim;
        varying float vDark;
        float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 n = normalize(vObjN);
          float side = 1.0 - step(0.6, abs(n.y));
          bool xFace = abs(n.x) > abs(n.z);
          vec2 fc = xFace ? vec2(vObjPos.z * vSize.z, vObjPos.y * vSize.y) : vec2(vObjPos.x * vSize.x, vObjPos.y * vSize.y);
          vec2 hf = xFace ? vec2(vSize.z, vSize.y) * 0.5 : vec2(vSize.x, vSize.y) * 0.5;
          float style = vGrid.z;
          // roofs a shade darker than the walls
          diffuseColor.rgb *= mix(0.62, 1.0, side);
          float inside = side * step(0.5, style) * step(abs(fc.x), hf.x - 0.3) * step(abs(fc.y), hf.y - 0.2);
          vec2 cell = max(vGrid.xy, vec2(0.2));
          vec2 c = (fc + hf) / cell;
          vec2 id = floor(c);
          vec2 g = fract(c);
          vec2 w = max(fwidth(c), vec2(1e-4));
          vec2 lo = vec2(0.2, 0.26);
          vec2 hi = vec2(0.8, 0.8);
          if (style > 1.5 && style < 2.5) { lo = vec2(-0.1, 0.3); hi = vec2(1.1, 0.78); }
          if (style > 2.5 && style < 3.5) { lo = vec2(0.34, 0.12); hi = vec2(0.66, 0.9); }
          vec2 a = smoothstep(lo - w, lo + w, g) * (1.0 - smoothstep(hi - w, hi + w, g));
          float win = a.x * a.y;
          float faceId = dot(n, vec3(1.0, 2.0, 3.0));
          float h = wHash(id + vec2(faceId * 17.0 + vGrid.w * 101.0, vGrid.w * 53.0));
          float lit = step(h, vWin.a);
          // a cell smaller than a few pixels shows its average, so far towers glow evenly instead of shimmering
          float far = clamp(max(w.x, w.y) * 2.5 - 0.6, 0.0, 1.0);
          win = mix(win, (min(hi.x, 1.0) - max(lo.x, 0.0)) * (hi.y - lo.y), far);
          lit = mix(lit, vWin.a, far);
          if (style > 3.5) {
            // a shop front: one big window on the ground floor of the front face
            vec2 q = (fc + hf) / (hf * 2.0);
            win = step(0.5, n.z) * step(0.07, q.x) * step(q.x, 0.93) * step(0.06, q.y) * step(q.y, 0.66);
            lit = 1.0;
            inside = side;
          }
          vec3 tint = vWin.rgb * (0.55 + 0.75 * wHash(id.yx + vGrid.w * 7.0 + faceId));
          tint *= mix(vec3(1.0), vec3(0.62, 0.82, 1.35), step(0.84, fract(h * 7.13)));
          // now and then a window's light changes
          float blink = step(0.995, wHash(id + floor(uTime * 0.25 + h * 9.0)));
          float on = inside * win * lit * vDark * (1.0 - blink * 0.8);
          totalEmissiveRadiance += tint * on;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4 + vec3(0.015, 0.02, 0.045), inside * win * (1.0 - lit * vDark) * (1.0 - far * 0.7));
          // a neon trim round the top
          float band = side * step(hf.y - vTrim.a, fc.y) * step(fc.y, hf.y - 0.03);
          totalEmissiveRadiance += vTrim.rgb * band * vDark;
        }`,
      )
  }
  m.customProgramCacheKey = () => 'kaiju-building'
  return { mat: m, u }
}

/** the buildings' ink outlines: each instance again, pushed out by its aInk, back faces in ink */
export function hullMaterial(ink: THREE.ColorRepresentation) {
  return new THREE.ShaderMaterial({
    uniforms: { uInk: { value: new THREE.Color(ink) }, ...fogUniforms() },
    vertexShader: /* glsl */ `
      attribute float aInk;
      varying float vDist;
      void main() {
        vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec3 p = position * (1.0 + 2.0 * aInk / max(size, vec3(0.01)));
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      varying float vDist;
      ${FOG_PARS}
      void main() { gl_FragColor = vec4(mix(uInk, uFogColor, fogOf(vDist)), 1.0); }`,
    side: THREE.BackSide,
  })
}

/** fog-free unlit colour over 1 (for things that should bloom: lamp bulbs, the moon) */
export const glowBasic = (color: THREE.ColorRepresentation, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), fog: false, toneMapped: true })
