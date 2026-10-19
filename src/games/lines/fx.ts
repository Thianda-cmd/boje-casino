import { COL, GOLD, INK } from './art'

/*
  The particle layer over Lucky Lines' stage: one canvas the size of the stage in real pixels, whose loop runs only
  while something is in the air. Ink drops thrown off a daub, twinkles along a finished line, and for the big wins a
  confetti fall and a fountain of coins. Toon-drawn like the rest (flat fills, ink edges on the coins), and fewer of
  everything when the player asks the system for less motion.
*/

type Kind = 'drop' | 'spark' | 'confetti' | 'coin'

interface P {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  /** rotation and its speed; tumble phase and its speed */
  a: number
  va: number
  f: number
  vf: number
  size: number
  age: number
  life: number
  g: number
  drag: number
  color: string
}

const TAU = Math.PI * 2
const CONFETTI = [...COL.map((c) => c.main), GOLD, '#ffffff']
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export class Fx {
  private c: CanvasRenderingContext2D
  private ps: P[] = []
  private raf = 0
  private last = 0
  private dpr = 1
  private w = 0
  private h = 0
  private few = reduce()

  constructor(private canvas: HTMLCanvasElement) {
    this.c = canvas.getContext('2d')!
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = w
    this.h = h
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
  }

  private n(k: number) {
    return this.few ? Math.ceil(k / 4) : k
  }

  private add(p: Partial<P> & Pick<P, 'kind' | 'x' | 'y'>) {
    this.ps.push({ vx: 0, vy: 0, a: 0, va: 0, f: 0, vf: 0, size: 4, age: 0, life: 1, g: 0, drag: 0, color: '#fff', ...p })
    if (!this.raf) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.step)
    }
  }

  /** ink thrown off a daub at (x, y), in the column's colour; `s` scales it with the stage */
  splat(x: number, y: number, color: string, s = 1) {
    for (let i = 0; i < this.n(9); i++) {
      const a = Math.random() * TAU
      const v = (140 + Math.random() * 220) * s
      this.add({ kind: 'drop', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * s, size: (2.5 + Math.random() * 3.5) * s, life: 0.45 + Math.random() * 0.25, g: 900 * s, drag: 3, color })
    }
  }

  /** twinkles strewn along a finished line from (x0, y0) to (x1, y1) */
  line(x0: number, y0: number, x1: number, y1: number, s = 1) {
    const k = this.n(16)
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1)
      this.add({
        kind: 'spark',
        x: x0 + (x1 - x0) * t + (Math.random() - 0.5) * 14 * s,
        y: y0 + (y1 - y0) * t + (Math.random() - 0.5) * 14 * s,
        vx: (Math.random() - 0.5) * 40 * s,
        vy: (-30 - Math.random() * 60) * s,
        a: Math.random() * TAU,
        va: (Math.random() - 0.5) * 6,
        size: (5 + Math.random() * 6) * s,
        life: 0.55 + Math.random() * 0.4,
        age: -t * 0.25,
        color: Math.random() < 0.6 ? '#fff' : GOLD,
      })
    }
  }

  /** a puff of twinkles round (x, y) */
  sparkle(x: number, y: number, s = 1, n = 8) {
    for (let i = 0; i < this.n(n); i++) {
      const a = Math.random() * TAU
      const v = (40 + Math.random() * 90) * s
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30 * s, a: Math.random() * TAU, va: (Math.random() - 0.5) * 6, size: (4 + Math.random() * 6) * s, life: 0.5 + Math.random() * 0.35, color: Math.random() < 0.5 ? '#fff' : GOLD })
    }
  }

  /** confetti from the top edge, `n` pieces */
  confetti(n: number) {
    for (let i = 0; i < this.n(n); i++) {
      this.add({
        kind: 'confetti',
        x: Math.random() * this.w,
        y: -20 - Math.random() * this.h * 0.4,
        vx: (Math.random() - 0.5) * 80,
        vy: 60 + Math.random() * 120,
        a: Math.random() * TAU,
        va: (Math.random() - 0.5) * 8,
        f: Math.random() * TAU,
        vf: 6 + Math.random() * 8,
        size: 6 + Math.random() * 6,
        life: 2.6 + Math.random() * 1.6,
        g: 60,
        drag: 0.6,
        color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
      })
    }
  }

  /** a fountain of coins thrown up from (x, y) */
  coins(x: number, y: number, n: number, s = 1) {
    for (let i = 0; i < this.n(n); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
      const v = (380 + Math.random() * 420) * s
      this.add({ kind: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, f: Math.random() * TAU, vf: 8 + Math.random() * 10, size: (9 + Math.random() * 5) * s, life: 1.6 + Math.random() * 0.6, age: -Math.random() * 0.5, g: 1100 * s, drag: 0.4 })
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ps = []
  }

  private step = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    const c = this.c
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.canvas.width, this.canvas.height)
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.ps = this.ps.filter((p) => {
      p.age += dt
      if (p.age < 0) return true
      if (p.age >= p.life || p.y > this.h + 60) return false
      p.vy += p.g * dt
      const k = Math.max(0, 1 - p.drag * dt)
      p.vx *= k
      p.vy *= k
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.a += p.va * dt
      p.f += p.vf * dt
      draw(c, p)
      return true
    })
    this.raf = this.ps.length ? requestAnimationFrame(this.step) : 0
  }
}

function draw(c: CanvasRenderingContext2D, p: P) {
  const t = p.age / p.life
  if (p.kind === 'drop') {
    c.globalAlpha = 1 - t * t
    c.fillStyle = p.color
    c.beginPath()
    c.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, TAU)
    c.fill()
  } else if (p.kind === 'spark') {
    // swells in, twinkles out
    const s = p.size * Math.sin(Math.min(1, t * 1.15) * Math.PI)
    if (s <= 0.2) return
    c.globalAlpha = 1
    c.fillStyle = p.color
    c.save()
    c.translate(p.x, p.y)
    c.rotate(p.a)
    c.beginPath()
    const q = s * 0.22
    c.moveTo(0, -s)
    c.quadraticCurveTo(q, -q, s, 0)
    c.quadraticCurveTo(q, q, 0, s)
    c.quadraticCurveTo(-q, q, -s, 0)
    c.quadraticCurveTo(-q, -q, 0, -s)
    c.fill()
    c.restore()
  } else if (p.kind === 'confetti') {
    c.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1
    c.fillStyle = p.color
    c.save()
    c.translate(p.x, p.y)
    c.rotate(p.a)
    c.scale(1, Math.cos(p.f))
    c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
    c.restore()
  } else {
    c.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1
    const sx = Math.max(0.12, Math.abs(Math.cos(p.f)))
    c.save()
    c.translate(p.x, p.y)
    c.scale(sx, 1)
    c.lineWidth = 1.6 / sx
    c.strokeStyle = INK
    c.fillStyle = '#c77d12'
    c.beginPath()
    c.arc(1.2, 1.2, p.size, 0, TAU)
    c.fill()
    c.fillStyle = Math.cos(p.f) > 0 ? '#ffd23d' : '#f2b024'
    c.beginPath()
    c.arc(0, 0, p.size, 0, TAU)
    c.fill()
    c.stroke()
    c.strokeStyle = '#d99a2b'
    c.lineWidth = 1.2 / sx
    c.beginPath()
    c.arc(0, 0, p.size * 0.62, 0, TAU)
    c.stroke()
    c.restore()
  }
  c.globalAlpha = 1
}
