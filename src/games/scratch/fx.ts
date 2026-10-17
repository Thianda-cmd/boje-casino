/*
  The particle layer over the whole stage, one canvas sized to the stage in real pixels; the loop only runs while
  something moves (resting crumbs are drawn once and left on the canvas).

  Shavings: curled two-tone slivers of foil torn off by the coin. They live on the table's plane with a height above
  it: thrown up and along the stroke, they tumble (glinting as a face turns to the light), fall back, bounce once and
  slide to a stop as crumbs on the card, until the card is done and they puff away.

  Then the celebration pieces: coins bursting out of a win, confetti and sparks for the big ones, the ring a stamp sends
  out, and a shower from the top. flyCoins() sends coins from a point on screen to another (the header balance) on a
  canvas of its own over the whole page.
*/

type Kind = 'coin' | 'confetti' | 'spark' | 'ring' | 'smoke'

interface P {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  /** rotation and its speed */
  a: number
  va: number
  /** tumble phase (how much of the face shows) and its speed */
  f: number
  vf: number
  size: number
  age: number
  life: number
  g: number
  drag: number
  front: string
  back: string
}

/** a shaving: x, y on the table, z above it (px) */
interface S {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  a: number
  va: number
  f: number
  vf: number
  size: number
  front: string
  back: string
  /** crescent outline, unit sized */
  shape: number[]
  /** 0 in the air, 1 sliding, 2 resting, 3 puffing away */
  state: 0 | 1 | 2 | 3
  bounced: boolean
  age: number
  life: number
}

const TAU = Math.PI * 2
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** crumbs kept on the card at most; older ones fade */
const MAX_CRUMBS = 240

/** a gold coin sprite, face on, at `px` pixels */
function coinSprite(px: number) {
  const c = document.createElement('canvas')
  c.width = c.height = Math.ceil(px)
  const x = c.getContext('2d')!
  const r = px / 2
  const g = x.createRadialGradient(r * 0.7, r * 0.6, r * 0.1, r, r, r)
  g.addColorStop(0, '#fff6c4')
  g.addColorStop(0.45, '#ffd34a')
  g.addColorStop(0.85, '#e09a14')
  g.addColorStop(1, '#9a5f06')
  x.fillStyle = g
  x.beginPath()
  x.arc(r, r, r * 0.98, 0, TAU)
  x.fill()
  x.strokeStyle = '#b8780a'
  x.lineWidth = r * 0.1
  x.beginPath()
  x.arc(r, r, r * 0.74, 0, TAU)
  x.stroke()
  // a star pressed into the middle
  const star = (dy: number, col: string) => {
    x.fillStyle = col
    x.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2
      const rr = (i % 2 ? 0.2 : 0.46) * r
      x.lineTo(r + Math.cos(a) * rr, r + dy + Math.sin(a) * rr)
    }
    x.fill()
  }
  star(1, '#c9870c')
  star(0, '#fff0a8')
  x.strokeStyle = 'rgba(255,255,255,.75)'
  x.lineWidth = r * 0.12
  x.lineCap = 'round'
  x.beginPath()
  x.arc(r, r, r * 0.84, Math.PI * 1.08, Math.PI * 1.42)
  x.stroke()
  return c
}
let coinImg: HTMLCanvasElement | null = null
const coin = (d: number) => (coinImg ??= coinSprite(48 * d))

/** a curled sliver: an outer arc and a tighter inner one, so it reads as a crescent of foil */
function crescent() {
  const th = 0.7 + Math.random() * 0.7
  const ri = 0.2 + Math.random() * 0.3
  const off = (1 - ri) * (0.5 + Math.random() * 0.3)
  const pts: number[] = []
  const n = 5
  for (let i = 0; i <= n; i++) {
    const t = -th + (2 * th * i) / n
    pts.push(Math.cos(t) - 0.6, Math.sin(t) * 0.9)
  }
  for (let i = n; i >= 0; i--) {
    const t = -th + (2 * th * i) / n
    pts.push(Math.cos(t) * ri - 0.6 + off, Math.sin(t) * ri * 0.9)
  }
  return pts
}

export class Fx {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private parts: P[] = []
  /** shavings in the air or sliding */
  private shav: S[] = []
  /** shavings at rest on the card, baked into `crumbs` (drawn once, not every frame) */
  private rest: S[] = []
  private crumbs = document.createElement('canvas')
  private cctx = this.crumbs.getContext('2d')!
  private raf = 0
  private last = 0
  private dpr = 1
  private w = 0
  private h = 0
  private lite = reduce()
  private rain = 0
  private rainColors: string[] = []
  /** disposed: nothing starts the loop again */
  private dead = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = w
    this.h = h
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.crumbs.width = this.canvas.width
    this.crumbs.height = this.canvas.height
    // the card moved under them
    this.shav = []
    this.rest = []
    this.kick()
  }

  /** stage coordinates of a point given in client coordinates */
  local(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect()
    return { x: cx - r.left, y: cy - r.top }
  }

  private add(p: Partial<P> & Pick<P, 'kind' | 'x' | 'y'>) {
    if (this.parts.length > (this.lite ? 120 : 700)) this.parts.shift()
    this.parts.push({ vx: 0, vy: 0, a: 0, va: 0, f: 0, vf: 0, size: 4, age: 0, life: 1, g: 0, drag: 0, front: '#fff', back: '#888', ...p })
    this.kick()
  }

  /** shavings of foil torn off at a client point, the coin moving at (vx, vy) px/s; `scale` is the card's px per unit */
  flecks(cx: number, cy: number, vx: number, vy: number, n: number, colors: [string, string][], scale = 1) {
    const { x, y } = this.local(cx, cy)
    const count = this.lite ? Math.min(1, n) : n
    const sp = Math.hypot(vx, vy)
    // the coin's own speed throws them a little way along the stroke, never across the stage
    const cap = Math.min(1, (420 * scale) / Math.max(1, sp))
    const ux = vx * cap
    const uy = vy * cap
    for (let i = 0; i < count; i++) {
      const [front, back] = colors[Math.floor(Math.random() * colors.length)]
      // most are flicked along the stroke, a few kick out sideways
      const along = 0.1 + Math.random() * 0.3
      const side = (Math.random() - 0.5) * 110 * scale
      const nx = sp > 1 ? -vy / sp : 0
      const ny = sp > 1 ? vx / sp : 0
      this.shav.push({
        x: x + (Math.random() - 0.5) * 10 * scale,
        y: y + (Math.random() - 0.5) * 10 * scale,
        z: 2,
        vx: ux * along + nx * side + (Math.random() - 0.5) * 50 * scale,
        vy: uy * along + ny * side + (Math.random() - 0.5) * 50 * scale,
        vz: (110 + Math.random() * 190) * scale,
        a: Math.random() * TAU,
        va: (Math.random() - 0.5) * 22,
        f: Math.random() * TAU,
        vf: (8 + Math.random() * 20) * (Math.random() < 0.5 ? -1 : 1),
        size: (2.1 + Math.random() * 3.2) * scale,
        front,
        back,
        shape: crescent(),
        state: 0,
        bounced: false,
        age: 0,
        life: 0.6,
      })
    }
    this.kick()
  }

  /** the crumbs on the card puff away (the card is done, or leaving) */
  puff() {
    // the resting ones come off the baked layer and fly again
    this.shav.push(...this.rest)
    this.rest = []
    this.cctx.setTransform(1, 0, 0, 1, 0, 0)
    this.cctx.clearRect(0, 0, this.crumbs.width, this.crumbs.height)
    for (const s of this.shav) {
      if (s.state === 3) continue
      s.state = 3
      s.age = 0
      s.life = 0.45 + Math.random() * 0.35
      const a = Math.random() * TAU
      const v = 60 + Math.random() * 160
      s.vx = Math.cos(a) * v
      s.vy = Math.sin(a) * v
      s.vz = 120 + Math.random() * 200
      s.vf = (10 + Math.random() * 16) * (Math.random() < 0.5 ? -1 : 1)
    }
    this.kick()
  }

  /** coins bursting up out of a point (client coordinates) */
  coins(cx: number, cy: number, n: number, power = 1) {
    const { x, y } = this.local(cx, cy)
    const count = this.lite ? Math.min(6, n) : n
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      const v = (420 + Math.random() * 520) * power
      this.add({
        kind: 'coin',
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 16,
        vx: Math.cos(a) * v * 0.75,
        vy: Math.sin(a) * v,
        a: (Math.random() - 0.5) * 0.6,
        va: (Math.random() - 0.5) * 3,
        f: Math.random() * TAU,
        vf: 7 + Math.random() * 9,
        size: 16 + Math.random() * 12,
        life: 1.5 + Math.random() * 0.7,
        g: 1500,
        drag: 0.25,
      })
    }
  }

  /** confetti from the top edge, or out of a point */
  confetti(n: number, colors: string[], at?: { cx: number; cy: number }) {
    const count = this.lite ? Math.min(10, n) : n
    const o = at ? this.local(at.cx, at.cy) : null
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6
      const v = 380 + Math.random() * 520
      this.add({
        kind: 'confetti',
        x: o ? o.x : Math.random() * this.w,
        y: o ? o.y : -10 - Math.random() * 60,
        vx: o ? Math.cos(a) * v * 0.8 : (Math.random() - 0.5) * 120,
        vy: o ? Math.sin(a) * v : 60 + Math.random() * 160,
        a: Math.random() * TAU,
        va: (Math.random() - 0.5) * 8,
        f: Math.random() * TAU,
        vf: 6 + Math.random() * 10,
        size: 5 + Math.random() * 5,
        life: o ? 1.8 + Math.random() : 3 + Math.random() * 1.5,
        g: o ? 700 : 180,
        drag: o ? 1.4 : 0.6,
        front: colors[i % colors.length],
        back: colors[(i + 2) % colors.length],
      })
    }
  }

  /** twinkles around a point */
  sparks(cx: number, cy: number, n: number, spread: number, color = '#fff6c8') {
    const { x, y } = this.local(cx, cy)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU
      const d = Math.sqrt(Math.random()) * spread
      this.add({ kind: 'spark', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vy: -20 - Math.random() * 40, size: 5 + Math.random() * 9, life: 0.5 + Math.random() * 0.6, front: color, age: -Math.random() * 0.35 })
    }
  }

  /** a puff of smoke: soft grey clouds that swell, drift up and thin out */
  smoke(cx: number, cy: number, n: number, spread: number) {
    const { x, y } = this.local(cx, cy)
    const count = this.lite ? Math.min(3, n) : n
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU
      const v = 40 + Math.random() * 120
      this.add({ kind: 'smoke', x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 50, size: 14 + Math.random() * 18, life: 0.7 + Math.random() * 0.6, drag: 2.2, g: -40, front: Math.random() < 0.5 ? '#8a7864' : '#5e5042' })
    }
  }

  /** a ring that spreads out from a point and fades */
  ring(cx: number, cy: number, size: number, color: string, life = 0.55) {
    const { x, y } = this.local(cx, cy)
    this.add({ kind: 'ring', x, y, size, life, front: color })
  }

  /** a steady shower of coins and confetti from the top for `seconds` */
  shower(seconds: number, colors: string[]) {
    this.rain = Math.max(this.rain, seconds)
    this.rainColors = colors
    this.kick()
  }

  stopShower() {
    this.rain = 0
  }

  clear() {
    this.parts = []
    this.shav = []
    this.rest = []
    this.cctx.setTransform(1, 0, 0, 1, 0, 0)
    this.cctx.clearRect(0, 0, this.crumbs.width, this.crumbs.height)
    this.rain = 0
    this.kick()
  }

  private kick() {
    if (this.raf || this.dead) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (now: number) => {
    // this.raf stays set while the frame runs, so pieces added during it don't start a second loop
    const dt = Math.min(0.033, (now - this.last) / 1000)
    this.last = now
    if (this.rain > 0) {
      this.rain -= dt
      if (Math.random() < (this.lite ? 0.15 : 0.9)) {
        this.add({ kind: 'coin', x: Math.random() * this.w, y: -30, vx: (Math.random() - 0.5) * 80, vy: 120 + Math.random() * 200, va: (Math.random() - 0.5) * 2, f: Math.random() * TAU, vf: 6 + Math.random() * 8, size: 18 + Math.random() * 14, life: 2.6, g: 900, drag: 0.3 })
        if (Math.random() < 0.8) this.confetti(1, this.rainColors)
      }
    }
    const ps = this.parts
    let j = 0
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      p.age += dt
      if (p.age >= p.life || p.y > this.h + 60) continue
      if (p.age > 0) {
        p.vy += p.g * dt
        const k = Math.exp(-p.drag * dt)
        p.vx *= k
        p.vy *= k
        if (p.kind === 'confetti') p.vx += Math.sin(p.f * 0.7) * 30 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.a += p.va * dt
        p.f += p.vf * dt
      }
      ps[j++] = p
    }
    ps.length = j
    const moving = this.stepShavings(dt)
    this.draw()
    this.raf = ps.length || this.rain > 0 || moving ? requestAnimationFrame(this.tick) : 0
  }

  /** moves the shavings; true while any of them is still moving */
  private stepShavings(dt: number) {
    const G = 1500
    const ss = this.shav
    let moving = false
    let j = 0
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i]
      moving = true
      s.age += dt
      if (s.state === 3 && s.age >= s.life) continue
      if (s.state === 0 || s.state === 3) {
        s.vz -= G * dt
        s.z += s.vz * dt
        const k = Math.exp(-1.1 * dt)
        s.vx *= k
        s.vy *= k
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.a += s.va * dt
        s.f += s.vf * dt
        if (s.state === 0 && s.z <= 0) {
          s.z = 0
          if (!s.bounced && s.vz < -70) {
            // one little bounce, then it slides
            s.vz = -s.vz * 0.26
            s.bounced = true
            s.vx *= 0.45
            s.vy *= 0.45
            s.vf *= 0.4
            s.va *= 0.5
          } else {
            s.vz = 0
            s.state = 1
          }
        } else if (s.state === 3 && s.z < 0) s.z = 0
      } else {
        // sliding to a stop
        const k = Math.exp(-10 * dt)
        s.vx *= k
        s.vy *= k
        s.va *= k
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.a += s.va * dt
        if (Math.hypot(s.vx, s.vy) < 5) {
          if (this.rest.length >= MAX_CRUMBS) {
            // enough crumbs on the card already: this one fades where it lies
            s.state = 3
            s.age = 0
            s.life = 0.35
            s.vz = 0
          } else {
            s.state = 2
            // it settles flat, face or back up, and is baked into the crumb layer
            s.f = Math.round(s.f / Math.PI) * Math.PI + (Math.random() - 0.5) * 0.8
            this.rest.push(s)
            this.drawShadow(this.cctx, s)
            this.drawShaving(this.cctx, s)
            continue
          }
        }
      }
      if (s.x < -40 || s.x > this.w + 40 || s.y < -60 || s.y > this.h + 40) continue
      ss[j++] = s
    }
    ss.length = j
    return moving
  }

  /** a shaving's shadow on the table, softer and wider the higher it is */
  private drawShadow(c: CanvasRenderingContext2D, s: S) {
    const d = this.dpr
    const fade = s.state === 3 ? Math.max(0, 1 - s.age / s.life) : 1
    const air = Math.min(1, s.z / 90)
    c.setTransform(d, 0, 0, d, (s.x + s.z * 0.18) * d, (s.y + 0.8) * d)
    c.globalAlpha = fade * (s.state === 2 ? 0.32 : 0.26 * (1 - air * 0.7))
    c.fillStyle = '#000'
    c.beginPath()
    c.ellipse(0, 0, s.size * (0.9 + air * 0.8), s.size * (0.5 + air * 0.4), 0, 0, TAU)
    c.fill()
    c.globalAlpha = 1
  }

  /** a shaving: its curl seen at its tumble, two-tone, the lit rim along it and a glint as it turns face on */
  private drawShaving(c: CanvasRenderingContext2D, s: S) {
    const d = this.dpr
    const fade = s.state === 3 ? Math.max(0, 1 - s.age / s.life) : 1
    const flip = Math.cos(s.f)
    const k = 1 + s.z / 240
    c.setTransform(d, 0, 0, d, s.x * d, (s.y - s.z * 0.6) * d)
    c.rotate(s.a)
    c.scale(k, k * Math.max(0.14, Math.abs(flip)))
    c.globalAlpha = fade
    c.fillStyle = flip > 0 ? s.front : s.back
    const sh = s.shape
    const z = s.size
    c.beginPath()
    c.moveTo(sh[0] * z, sh[1] * z)
    for (let i = 2; i < sh.length; i += 2) c.lineTo(sh[i] * z, sh[i + 1] * z)
    c.closePath()
    c.fill()
    if (flip > 0) {
      c.strokeStyle = 'rgba(255,255,255,.75)'
      c.lineWidth = Math.max(0.5, z * 0.16)
      c.beginPath()
      c.moveTo(sh[0] * z, sh[1] * z)
      for (let i = 2; i < 12; i += 2) c.lineTo(sh[i] * z, sh[i + 1] * z)
      c.stroke()
    }
    if (s.state !== 2 && Math.abs(flip) > 0.95) {
      c.globalAlpha = fade * 0.85
      c.fillStyle = '#fff'
      c.fill()
    }
    c.globalAlpha = 1
  }

  private draw() {
    const c = this.ctx
    const d = this.dpr
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.canvas.width, this.canvas.height)
    // the crumbs at rest, then the shavings still moving, under the celebration pieces
    if (this.rest.length) c.drawImage(this.crumbs, 0, 0)
    for (const s of this.shav) this.drawShadow(c, s)
    for (const s of this.shav) this.drawShaving(c, s)
    for (const p of this.parts) {
      if (p.age < 0) continue
      const t = p.age / p.life
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
      if (p.kind === 'coin') {
        const img = coin(d)
        const flip = Math.cos(p.f)
        c.setTransform(d, 0, 0, d, p.x * d, p.y * d)
        c.rotate(p.a)
        c.globalAlpha = fade
        const w = p.size * Math.max(0.08, Math.abs(flip))
        if (Math.abs(flip) < 0.25) {
          // edge on: a thin golden rim
          c.fillStyle = '#c98a12'
          c.fillRect(-Math.max(1.5, w / 2), -p.size / 2, Math.max(3, w), p.size)
        } else c.drawImage(img, -w / 2, -p.size / 2, w, p.size)
      } else if (p.kind === 'confetti') {
        const flip = Math.cos(p.f)
        c.setTransform(d, 0, 0, d, p.x * d, p.y * d)
        c.rotate(p.a)
        c.scale(1, Math.max(0.1, Math.abs(flip)))
        c.globalAlpha = fade
        c.fillStyle = flip > 0 ? p.front : p.back
        c.fillRect(-p.size / 2, -p.size * 0.32, p.size, p.size * 0.64)
      } else if (p.kind === 'spark') {
        const k = Math.sin(Math.min(1, t) * Math.PI)
        const r = p.size * k
        c.setTransform(d, 0, 0, d, p.x * d, p.y * d)
        c.globalAlpha = k
        c.fillStyle = p.front
        c.beginPath()
        const q = r * 0.2
        c.moveTo(0, -r)
        c.quadraticCurveTo(q, -q, r, 0)
        c.quadraticCurveTo(q, q, 0, r)
        c.quadraticCurveTo(-q, q, -r, 0)
        c.quadraticCurveTo(-q, -q, 0, -r)
        c.fill()
      } else if (p.kind === 'smoke') {
        const r = p.size * (0.6 + t * 1.4)
        c.setTransform(d, 0, 0, d, p.x * d, p.y * d)
        c.globalAlpha = (1 - t) * 0.5
        const g = c.createRadialGradient(0, 0, 0, 0, 0, r)
        g.addColorStop(0, p.front)
        g.addColorStop(1, 'rgba(94,80,66,0)')
        c.fillStyle = g
        c.beginPath()
        c.arc(0, 0, r, 0, TAU)
        c.fill()
      } else if (p.kind === 'ring') {
        const e = 1 - (1 - t) ** 3
        c.setTransform(d, 0, 0, d, p.x * d, p.y * d)
        c.globalAlpha = (1 - t) * 0.8
        c.strokeStyle = p.front
        c.lineWidth = 6 * (1 - t) + 1
        c.beginPath()
        c.ellipse(0, 0, p.size * (0.4 + e * 0.9), p.size * (0.4 + e * 0.9) * 0.62, 0, 0, TAU)
        c.stroke()
      }
    }
    c.globalAlpha = 1
  }

  dispose() {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.parts = []
    this.shav = []
    this.rest = []
    this.rain = 0
    this.crumbs.width = this.crumbs.height = 0
    this.canvas.width = this.canvas.height = 0
    coinImg = null
  }
}

/**
 * Coins fly from one point on screen to another (client coordinates), on a canvas of their own over the whole page:
 * a stream of n along curved paths, shrinking as they arrive. `hit(i)` fires as each lands; returns a cancel function.
 */
export function flyCoins(from: { x: number; y: number }, to: { x: number; y: number }, n: number, hit: (i: number) => void, done?: () => void): () => void {
  const cv = document.createElement('canvas')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const W = window.innerWidth
  const H = window.innerHeight
  cv.width = Math.round(W * dpr)
  cv.height = Math.round(H * dpr)
  cv.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:70`
  document.body.appendChild(cv)
  const c = cv.getContext('2d')!
  const img = coin(dpr)
  const count = reduce() ? Math.min(4, n) : n
  const coins = Array.from({ length: count }, (_, i) => {
    const sx = from.x + (Math.random() - 0.5) * 80
    const sy = from.y + (Math.random() - 0.5) * 30
    const bend = (Math.random() - 0.5) * 260
    return { sx, sy, cx: (sx + to.x) / 2 + bend, cy: Math.min(sy, to.y) - 60 - Math.random() * 120, delay: i * 45 + Math.random() * 30, dur: 620 + Math.random() * 220, f: Math.random() * TAU, hit: false, size: 22 + Math.random() * 8 }
  })
  const t0 = performance.now()
  let raf = 0
  let over = false
  const end = () => {
    if (over) return
    over = true
    cancelAnimationFrame(raf)
    cv.remove()
    done?.()
  }
  const step = (now: number) => {
    const t = now - t0
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, cv.width, cv.height)
    let live = 0
    coins.forEach((k, i) => {
      const u = (t - k.delay) / k.dur
      if (u < 0) {
        live++
        return
      }
      if (u >= 1) {
        if (!k.hit) {
          k.hit = true
          hit(i)
        }
        return
      }
      live++
      const e = u * u * (3 - 2 * u)
      const x = (1 - e) * (1 - e) * k.sx + 2 * (1 - e) * e * k.cx + e * e * to.x
      const y = (1 - e) * (1 - e) * k.sy + 2 * (1 - e) * e * k.cy + e * e * to.y
      const s = k.size * (1 - e * 0.55)
      const flip = Math.abs(Math.cos(k.f + u * 9))
      c.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr)
      c.globalAlpha = u > 0.9 ? (1 - u) * 10 : 1
      c.drawImage(img, (-s * Math.max(0.15, flip)) / 2, -s / 2, s * Math.max(0.15, flip), s)
    })
    if (live) raf = requestAnimationFrame(step)
    else end()
  }
  raf = requestAnimationFrame(step)
  return end
}
