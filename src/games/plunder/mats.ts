import * as THREE from 'three'
import { glowTexture } from '../../lib/three/fx'
import { toonRamp, vkMaterial } from '../../lib/three/toon'

/*
  The Plunder Bay materials. The grid pieces (symbols) and the stage (host, frame, ship) each get their own copies,
  so the scene can clip the grid ones to the reel window and leave the stage alone. All of them are VKit toon
  materials (colour per vertex, ink outline in the same mesh) except the glows, the lamp glass and text labels.
  One clock (tickModels) drives the waving cloth, the gold shine and the lamp flicker.
*/

export const RAMP = [92, 165, 225, 255]
const uTime = { value: 0 }
/** the lanterns' light, 0 (unlit, day) to 1 (blazing, Treasure Hunt night) */
const uGlow = { value: 0 }

/** moves the shared clock (seconds): call once per frame with the scene clock */
export function tickModels(t: number) {
  uTime.value = t
}

let cast: THREE.MeshToonMaterial | null = null
let stage: THREE.MeshToonMaterial | null = null
let cloth: THREE.MeshToonMaterial | null = null
let stageCloth: THREE.MeshToonMaterial | null = null
let gold: THREE.MeshToonMaterial | null = null
let halo: THREE.SpriteMaterial | null = null
let stageHalo: THREE.SpriteMaterial | null = null
let lamp: THREE.MeshBasicMaterial | null = null
let lampHalo: THREE.SpriteMaterial | null = null

/** the toon material of every symbol (`stage` = the unclipped copy for the host, frame and ship) */
export function castMaterial(stageCopy = false) {
  if (stageCopy) return (stage ??= vkMaterial(toonRamp(RAMP)))
  return (cast ??= vkMaterial(toonRamp(RAMP)))
}

/**
 * Cloth that waves in the wind: VKit shading plus a travelling wave along each vertex's `aWave` (amplitude, phase
 * along the cloth, phase per unit x). Each copy waves out of step with the others (the phase follows where it is).
 */
function makeCloth(speed: number) {
  const m = vkMaterial(toonRamp(RAMP))
  const vk = m.onBeforeCompile
  m.onBeforeCompile = (s, r) => {
    vk.call(m, s, r)
    s.uniforms.uTime = uTime
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWave;\nuniform float uTime;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float wPh = dot(modelMatrix[3].xyz, vec3(1.7, 2.3, 0.9));
        float wA = aWave.y - uTime * ${speed.toFixed(2)} + wPh;
        float wSl = aWave.x * cos(wA) * aWave.z;
        objectNormal = normalize(vec3(objectNormal.x - wSl * objectNormal.z, objectNormal.y, objectNormal.z));`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += aWave.x * sin(wA);\ntransformed.y -= aWave.x * 0.3 * (1.0 + sin(wA * 0.5 + 1.3));')
  }
  m.customProgramCacheKey = () => `vk-cloth-${speed}`
  return m
}

/** the waving cloth of the wild's flag (`stage` = the copy for the ship's flag and sails) */
export function clothMaterial(stageCopy = false) {
  if (stageCopy) return (stageCloth ??= makeCloth(2.6))
  return (cloth ??= makeCloth(4.2))
}

/** polished gold for the multiplier medallion and the chest's loot: toon shading plus a band of shine sweeping across */
export function goldMaterial() {
  if (gold) return gold
  const m = vkMaterial(toonRamp(RAMP))
  const vk = m.onBeforeCompile
  m.onBeforeCompile = (s, r) => {
    vk.call(m, s, r)
    s.uniforms.uTime = uTime
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWorld;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float band = fract((vWorld.x * 0.55 + vWorld.y * 0.9) * 0.5 - uTime * 0.3);
        totalEmissiveRadiance += diffuseColor.rgb * (smoothstep(0.0, 0.04, band) * (1.0 - smoothstep(0.04, 0.1, band))) * 1.2 * (1.0 - vFlat);`,
      )
  }
  m.customProgramCacheKey = () => 'vk-gold'
  return (gold = m)
}

/** the soft gold glow behind the treasure map (a sprite; `stage` = the unclipped copy for the big map of a trigger) */
export function haloMaterial(stageCopy = false) {
  if (stageCopy) return (stageHalo ??= new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffc94a').multiplyScalar(0.75), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  return (halo ??= new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffc94a').multiplyScalar(0.75), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
}

const LAMP_DIM = new THREE.Color('#a8662c')
const LAMP_LIT = new THREE.Color('#ffd27a').multiplyScalar(2.1)
/** the lantern glass and flame: flat colour from a dull amber (day) to a bright bloom (night); see setLanternGlow */
export function lampMaterial() {
  return (lamp ??= new THREE.MeshBasicMaterial({ color: LAMP_DIM.clone(), toneMapped: true }))
}
export function lampHaloMaterial() {
  return (lampHalo ??= new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffb347'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
}

/** lights every lantern (glass, flame and halo): 0 = day, 1 = night; call when it changes (or every frame to flicker) */
export function setLanternGlow(v: number, flicker = 0) {
  uGlow.value = v
  const f = v * (1 - flicker * 0.18)
  lampMaterial().color.copy(LAMP_DIM).lerp(LAMP_LIT, f)
  lampHaloMaterial().opacity = 0.9 * f
}
export const lanternGlow = () => uGlow.value

/** every material the grid pieces use (for the scene to clip to the reel window); the stage copies are left out */
export function gridMaterials(): THREE.Material[] {
  return [cast, cloth, halo].filter((m): m is NonNullable<typeof m> => m !== null)
}

/** frees the materials (they are made again on demand); also drops this renderer's listeners on the shared ramp and glow */
export function releaseMaterials() {
  for (const m of [cast, stage, cloth, stageCloth, gold, halo, stageHalo, lamp, lampHalo]) m?.dispose()
  toonRamp(RAMP).dispose()
  glowTexture().dispose()
}
