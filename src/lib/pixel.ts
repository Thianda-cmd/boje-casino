/* Tiny pixel-art toolkit: sprites are strings of palette keys, rendered once to
   data URLs and scaled up with `image-rendering: pixelated`. No image files ship. */

export type Palette = Record<string, string>

export interface Sprite {
  url: string
  w: number
  h: number
  /** the source canvas, for drawing into other canvases */
  canvas: HTMLCanvasElement
}

const cache = new Map<string, Sprite>()

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

const canvases = new Map<string, HTMLCanvasElement>()

function draw(rows: string[], pal: Palette, outline?: string) {
  const h0 = rows.length
  const w0 = Math.max(...rows.map((r) => r.length))
  const pad = outline ? 1 : 0
  const [c, ctx] = canvas(w0 + pad * 2, h0 + pad * 2)
  const solid = (x: number, y: number) => {
    const ch = rows[y]?.[x]
    return ch !== undefined && ch !== '.' && ch !== ' ' && pal[ch] !== undefined
  }
  if (outline) {
    ctx.fillStyle = outline
    for (let y = -1; y <= h0; y++)
      for (let x = -1; x <= w0; x++) {
        if (solid(x, y)) continue
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ctx.fillRect(x + pad, y + pad, 1, 1)
      }
  }
  for (let y = 0; y < h0; y++)
    for (let x = 0; x < w0; x++) {
      if (!solid(x, y)) continue
      ctx.fillStyle = pal[rows[y][x]]
      ctx.fillRect(x + pad, y + pad, 1, 1)
    }
  return c
}

/** Render a sprite. `outline` adds a 1px border around every opaque pixel. */
export function sprite(key: string, rows: string[], pal: Palette, outline?: string): Sprite {
  const hit = cache.get(key)
  if (hit) return hit
  const c = draw(rows, pal, outline)
  const s = { url: c.toDataURL('image/png'), w: c.width, h: c.height, canvas: c }
  cache.set(key, s)
  return s
}

/** The same sprite as a canvas, for drawing into other canvases with `drawImage`. */
export function spriteCanvas(key: string, rows: string[], pal: Palette, outline?: string) {
  let c = canvases.get(key)
  if (!c) canvases.set(key, (c = draw(rows, pal, outline)))
  return c
}

/** Procedural texture drawn with a seeded RNG so it looks the same every load. */
export function texture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void): Sprite {
  const hit = cache.get(key)
  if (hit) return hit
  const [c, ctx] = canvas(w, h)
  draw(ctx, mulberry32(hash(key)))
  const s = { url: c.toDataURL('image/png'), w, h, canvas: c }
  cache.set(key, s)
  return s
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))))
  const r = f(n >> 16)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export const pixelated = { imageRendering: 'pixelated' as const }
