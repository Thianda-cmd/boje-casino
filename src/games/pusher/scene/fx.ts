import * as THREE from 'three'
import { Sparks, glowTexture, rnd } from '../../../lib/three/fx'

/*
  Coin Cascade's effects: soft glowing points (dust, glitter, the sparkles of a prize going over), four-pointed
  twinkles (a glint on a gold coin, the pile in the tray), and light bursts (a flash where a prize tips over the edge,
  a flash in the tray). They are cosmetic and run on the scene's clock, so turbo speeds them up too. Under reduced
  motion every emitter sends a third of its particles and bursts are smaller and dimmer.
*/

const TAU = Math.PI * 2

let starTex: THREE.CanvasTexture | null = null
/** a four-pointed twinkle: two thin crossed rays over a small glow, white */
export function starTexture() {
  if (starTex) return starTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 30)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.35, 'rgba(255,255,255,0.4)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 128, 128)
  for (const [w, h] of [[64, 5], [5, 64]]) {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, Math.max(w, h))
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.beginPath()
    g.ellipse(64, 64, w, h, 0, 0, TAU)
    g.fill()
  }
  starTex = new THREE.CanvasTexture(c)
  return starTex
}

interface Flash {
  sprite: THREE.Sprite
  life: number
  max: number
  size: number
  grow: number
}

export class MachineFx {
  readonly root = new THREE.Group()
  readonly glow: Sparks
  readonly stars: Sparks
  private readonly flashes: Flash[] = []
  private readonly flashMats: THREE.SpriteMaterial[] = []
  calm = false

  constructor(low: boolean) {
    this.glow = new Sparks(low ? 500 : 900)
    this.stars = new Sparks(low ? 160 : 260)
    this.stars.mat.uniforms.map.value = starTexture()
    this.root.add(this.glow.points, this.stars.points)
    for (let i = 0; i < 6; i++) {
      const m = new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 })
      const s = new THREE.Sprite(m)
      s.visible = false
      s.renderOrder = 12
      this.root.add(s)
      this.flashMats.push(m)
      this.flashes.push({ sprite: s, life: 0, max: 1, size: 1, grow: 1 })
    }
  }

  /** how many particles an emitter sends: a third under reduced motion */
  private n(k: number) {
    return Math.max(1, Math.round(this.calm ? k * 0.33 : k))
  }

  /** the points' size scale, for the stage's height in device pixels (Sparks sizes in world units at distance 1) */
  setScale(s: number) {
    this.glow.mat.uniforms.scale.value = s
    this.stars.mat.uniforms.scale.value = s
  }

  /** a glint: one twinkle that swells and fades where it is */
  twinkle(p: THREE.Vector3, color: THREE.Color, size = 0.5, life = 0.5) {
    this.stars.emit(p.x, p.y, p.z, 0, 0, 0, color, size, life, 0, 0, 1.4)
  }

  /** sparkles flying up and out from a point, falling back as they fade */
  burst(p: THREE.Vector3, color: THREE.Color, n: number, speed: number, size = 0.26, life = 0.8) {
    const hot = color.clone().multiplyScalar(2)
    const white = new THREE.Color(2.2, 2.2, 2.2)
    for (let i = 0, k = this.n(n); i < k; i++) {
      const a = Math.random() * TAU
      const s = speed * rnd(0.3, 1)
      const up = rnd(0.6, 1.6) * speed
      this.glow.emit(p.x, p.y, p.z, Math.cos(a) * s, up, Math.sin(a) * s * 0.7, i % 3 ? hot : white, size * rnd(0.5, 1.2), life * rnd(0.6, 1.1), -6, 1.5)
      if (i % 4 === 0) this.stars.emit(p.x, p.y, p.z, Math.cos(a) * s * 0.6, up * 0.7, Math.sin(a) * s * 0.5, hot, size * 2.2 * rnd(0.7, 1.2), life * rnd(0.7, 1.1), -4, 1.8, 0.6)
    }
  }

  /** a puff of dust where something lands */
  dust(p: THREE.Vector3, n: number, color = new THREE.Color('#cfe0ff'), spread = 0.8, size = 1) {
    for (let i = 0, k = this.n(n); i < k; i++) {
      const a = Math.random() * TAU
      const s = rnd(0.3, 1) * spread
      this.glow.emit(p.x, p.y + 0.05, p.z, Math.cos(a) * s, rnd(0.15, 0.6), Math.sin(a) * s, color, rnd(0.1, 0.2) * size, rnd(0.3, 0.55) * Math.sqrt(size), -1.2, 2.5)
    }
  }

  /** glitter drifting up from a spot (the tray's pile) */
  glitter(p: THREE.Vector3, w: number, d: number, color: THREE.Color, n: number) {
    for (let i = 0, k = this.n(n); i < k; i++) {
      const x = p.x + rnd(-w / 2, w / 2)
      const z = p.z + rnd(-d / 2, d / 2)
      if (Math.random() < 0.5) this.stars.emit(x, p.y + rnd(0, 0.3), z, 0, rnd(0.2, 0.6), 0, color, rnd(0.35, 0.7), rnd(0.4, 0.8), 0, 0.5, 1.2)
      else this.glow.emit(x, p.y + rnd(0, 0.3), z, rnd(-0.2, 0.2), rnd(0.5, 1.4), rnd(-0.2, 0.2), color, rnd(0.08, 0.16), rnd(0.6, 1.1), -0.5, 0.6)
    }
  }

  /** a light burst: a big soft glow that blooms and fades */
  flash(p: THREE.Vector3, color: THREE.Color, size: number, life = 0.5, grow = 1.6) {
    let f = this.flashes.find((x) => x.life <= 0)
    if (!f) f = this.flashes.reduce((a, b) => (a.life < b.life ? a : b))
    f.life = f.max = life
    f.size = this.calm ? size * 0.6 : size
    f.grow = grow
    f.sprite.position.copy(p)
    ;(f.sprite.material as THREE.SpriteMaterial).color.copy(color).multiplyScalar(this.calm ? 0.6 : 1)
    f.sprite.visible = true
  }

  get busy() {
    return this.glow.list.length > 0 || this.stars.list.length > 0 || this.flashes.some((f) => f.life > 0)
  }

  update(dt: number) {
    this.glow.update(dt)
    this.stars.update(dt)
    for (const f of this.flashes) {
      if (f.life <= 0) continue
      f.life -= dt
      const u = 1 - Math.max(0, f.life) / f.max
      const m = f.sprite.material as THREE.SpriteMaterial
      m.opacity = Math.max(0, (1 - u) * (1 - u)) * Math.min(1, u * 8)
      f.sprite.scale.setScalar(f.size * (0.6 + f.grow * Math.sqrt(u)))
      if (f.life <= 0) f.sprite.visible = false
    }
  }

  dispose() {
    this.glow.dispose()
    this.stars.dispose()
    for (const m of this.flashMats) m.dispose()
  }
}
