import * as THREE from 'three'

/*
  Text drawn on canvases for the Plunder Bay models: the WILD ribbon, the ways counter on the frame and the
  multiplier on the gold medallion. Each texture is drawn again once the web font arrives if it was not ready.
*/

export const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'

/** a canvas texture; drawn again once the web font has loaded if it was not ready yet */
export function canvasTexture(w: number, h: number, font: string, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(font))
    document.fonts.load(font).then(
      () => {
        g.clearRect(0, 0, w, h)
        draw(g)
        t.needsUpdate = true
      },
      () => {},
    )
  return t
}

/**
 * Engraved gold lettering: a dark rim, a gold gradient face and a bright top edge, centred on (x, y) and shrunk to
 * fit `maxW`. Returns the font size used.
 */
export function goldText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number, o: { weight?: number; rim?: string; face?: [string, string, string]; rimW?: number; track?: number } = {}) {
  const weight = o.weight ?? 800
  let s = size
  const track = o.track ?? 0
  const measure = () => {
    g.font = `${weight} ${s}px ${FONT}`
    return g.measureText(text).width + track * s * (text.length - 1)
  }
  let w = measure()
  if (w > maxW) {
    s *= maxW / w
    w = measure()
  }
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  const draw = (fn: (ch: string, cx: number) => void) => {
    let cx = x - w / 2
    for (const ch of text) {
      fn(ch, cx)
      cx += g.measureText(ch).width + track * s
    }
  }
  const rimW = (o.rimW ?? 0.16) * s
  g.lineJoin = 'round'
  g.save()
  g.shadowColor = 'rgba(10, 4, 20, 0.55)'
  g.shadowBlur = s * 0.08
  g.shadowOffsetY = s * 0.06
  g.strokeStyle = o.rim ?? '#2a1206'
  g.lineWidth = rimW
  draw((ch, cx) => g.strokeText(ch, cx, y))
  g.restore()
  const [a, b, c] = o.face ?? ['#fff3b0', '#ffc93d', '#d9821c']
  const grad = g.createLinearGradient(0, y - s * 0.42, 0, y + s * 0.42)
  grad.addColorStop(0, a)
  grad.addColorStop(0.5, b)
  grad.addColorStop(1, c)
  g.fillStyle = grad
  draw((ch, cx) => g.fillText(ch, cx, y))
  return s
}

/**
 * A plane of engraved gold lettering on a transparent canvas, for floating win amounts ("+12.50"), cascade stamps
 * ("×3") or banners: width × height in scene units, faces +z, unlit. set() redraws only when the text changes.
 */
export class GoldLabel {
  readonly texture: THREE.CanvasTexture
  readonly material: THREE.MeshBasicMaterial
  readonly mesh: THREE.Mesh
  private text: string
  private readonly g: CanvasRenderingContext2D

  constructor(width: number, height: number, text = '') {
    const W = 1024
    const H = Math.max(64, Math.round((W * height) / width))
    this.text = text
    this.texture = canvasTexture(W, H, `800 100px ${FONT}`, (g) => this.draw(g))
    this.g = (this.texture.image as HTMLCanvasElement).getContext('2d')!
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material)
    this.mesh.name = 'goldLabel'
    this.mesh.renderOrder = 5
  }

  set(text: string) {
    if (text === this.text) return
    this.text = text
    this.draw(this.g)
    this.texture.needsUpdate = true
  }

  private draw(g: CanvasRenderingContext2D) {
    const W = g.canvas.width
    const H = g.canvas.height
    g.clearRect(0, 0, W, H)
    if (this.text) goldText(g, this.text, W / 2, H * 0.52, H * 0.72, W * 0.94, { rimW: 0.16 })
  }

  dispose() {
    this.texture.dispose()
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}

let wild: THREE.CanvasTexture | null = null
/** WILD in chunky dark letters with a cream edge, for the gold ribbon under the Jolly Roger (512 × 160) */
export function wildTexture() {
  return (wild ??= canvasTexture(512, 160, `800 120px ${FONT}`, (g) => {
    g.clearRect(0, 0, 512, 160)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `800 112px ${FONT}`
    g.lineJoin = 'round'
    g.lineWidth = 22
    g.strokeStyle = '#fff4d0'
    g.strokeText('WILD', 256, 84)
    const grad = g.createLinearGradient(0, 40, 0, 128)
    grad.addColorStop(0, '#7a1f12')
    grad.addColorStop(1, '#3d0c06')
    g.fillStyle = grad
    g.fillText('WILD', 256, 84)
  }))
}

let labelMat: THREE.MeshBasicMaterial | null = null
/** the WILD lettering's material (grid; transparent, unlit) */
export function wildMaterial() {
  return (labelMat ??= new THREE.MeshBasicMaterial({ map: wildTexture(), transparent: true, depthWrite: false }))
}

/** frees the cached label textures and materials */
export function releaseLabels() {
  wild?.dispose()
  labelMat?.dispose()
}
