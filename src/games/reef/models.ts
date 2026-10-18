import * as THREE from 'three'
import { glowTexture } from '../../lib/three/fx'
import { CAST_IDS, PITCH, castMaterial, creatureGeometry, creatureMatrix, disposeSway, releaseCast, swayMesh } from './cast'
import { releaseGear, warmGear } from './gear'
import { releaseEffects } from './effects'
import { bubbleTexture } from './fx'
import type { FishId } from './rules'

/*
  Reef Raid's 3D assets: the one entry point for the scene (everything it needs is exported from here).

  - The cast (cast.ts, creatures.ts, kit.ts): CreatureBatch per species, creatureMatrix() to stand one in the swim
    plane, CAST (size, view, hit ellipse, orientation), hitRadius() (swim.ts tests hits with cast.ts's inHit()).
  - The reef (reefset.ts): buildReef(), floorAt(), waterFog(), WATER; the camera framing in frame.ts: fitCamera()
    and pickLayout() (the field's shape for a stage, field.ts).
  - The kit (gear.ts): buildCannon(), TorpedoBatch (moments.ts draws its nets and coins from gear.ts itself).
  - Effects (effects.ts, fx.ts): Splats, Streaks, buildReticle(), Bubbles (moments.ts uses the rest directly).

  Lifecycle: warmUp() builds every cached geometry (the slow part, a few hundred ms) ahead of time, so the scene can
  put every batch in place and compile it all with renderer.compileAsync(); renderPortraits() draws each creature to
  a small transparent image for the paytable; releaseModels() lets go of every cached material, texture and geometry
  on the GPU when the scene goes (they stay built, so a second visit only uploads them again).

  Lighting the cast was tuned under: DirectionalLight('#fff4dc', 2.1) at (-3, 10, 5), AmbientLight('#d4f1ff', 1.05),
  NeutralToneMapping at 1.05 exposure, a gentle bloom (strength 0.35, radius 0.4, threshold 0.92).
*/

export { CAST, CAST_IDS, CreatureBatch, creatureMatrix, hitRadius, tickCast } from './cast'
export { WATER, buildReef, floorAt, waterFog, type ReefSet } from './reefset'
export { FOV, fitCamera, pickLayout, type Margins } from './frame'
export { TorpedoBatch, buildCannon, type CannonRig } from './gear'
export { Splats, Streaks, buildReticle } from './effects'
export { Bubbles } from './fx'

/** builds every cached geometry ahead of time (call during loading, then compile) */
export function warmUp() {
  for (const id of CAST_IDS) {
    creatureGeometry(id)
    castMaterial(id)
  }
  warmGear()
}

/** the portraits once drawn: they are the same every visit, so they are drawn once a session */
let portraitCache: { size: number; urls: Partial<Record<FishId, string>> } | null = null

/**
 * Draws each creature to a size × size transparent PNG (data URL), as the game shows it, for the paytable. Renders
 * twice as big into the corner of the renderer's own canvas and scales down (smooth edges, though the canvas has no
 * antialiasing), so the canvas must be at least that big (it is clamped). Call after the scene's first frame (the
 * materials compiled); the canvas is cleared again by the next frame. Drawn once a session, then remembered.
 */
export function renderPortraits(r: THREE.WebGLRenderer, size = 160): Partial<Record<FishId, string>> {
  if (portraitCache?.size === size) return portraitCache.urls
  const cv = r.domElement
  const px = Math.floor(Math.min(size * 2, cv.width, cv.height))
  if (px < 32) return {}
  const css = px / r.getPixelRatio()
  const scene = new THREE.Scene()
  const sun = new THREE.DirectionalLight('#fff4dc', 2.1)
  sun.position.set(-3, 10, 5)
  scene.add(sun, new THREE.AmbientLight('#d4f1ff', 1.05))
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  const out = document.createElement('canvas')
  out.width = out.height = size
  const g2 = out.getContext('2d')!
  g2.imageSmoothingEnabled = true
  g2.imageSmoothingQuality = 'high'
  const res: Partial<Record<FishId, string>> = {}
  const clear = r.getClearColor(new THREE.Color())
  const alpha = r.getClearAlpha()
  const vp = r.getViewport(new THREE.Vector4())
  r.setRenderTarget(null)
  r.setClearColor(0x000000, 0)
  r.setScissorTest(true)
  r.setViewport(0, 0, css, css)
  r.setScissor(0, 0, css, css)
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  for (const id of CAST_IDS) {
    const { mesh } = swayMesh(creatureGeometry(id), castMaterial(id), 1)
    // standing as it swims, at rest: clock fixed between blinks
    creatureMatrix(m, id, 0, 0, 0, 1)
    mesh.setMatrixAt(0, m)
    mesh.geometry.getAttribute('iAnim').setX(0, 0.6)
    scene.add(mesh)
    // frame its silhouette as the game camera sees it
    cam.position.set(0, 20 * Math.sin(PITCH), 20 * Math.cos(PITCH))
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const pos = mesh.geometry.getAttribute('position')
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let i = 0; i < pos.count; i += 3) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m).applyMatrix4(cam.matrixWorldInverse)
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      y0 = Math.min(y0, p.y)
      y1 = Math.max(y1, p.y)
    }
    const half = (Math.max(x1 - x0, y1 - y0) / 2) * 1.04
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    cam.left = cx - half
    cam.right = cx + half
    cam.top = cy + half
    cam.bottom = cy - half
    cam.updateProjectionMatrix()
    r.clear()
    r.render(scene, cam)
    g2.clearRect(0, 0, size, size)
    g2.drawImage(cv, 0, cv.height - px, px, px, 0, 0, size, size)
    res[id] = out.toDataURL('image/png')
    scene.remove(mesh)
    disposeSway(mesh)
  }
  r.setScissorTest(false)
  r.setViewport(vp)
  r.setClearColor(clear, alpha)
  portraitCache = { size, urls: res }
  return res
}

/** lets go of every cached material, texture and geometry on the GPU (they stay built for the next visit) */
export function releaseModels() {
  releaseCast()
  releaseGear()
  releaseEffects()
  bubbleTexture().dispose()
  glowTexture().dispose()
}
