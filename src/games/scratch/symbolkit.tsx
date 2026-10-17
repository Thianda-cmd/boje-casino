/* Drawing helpers shared by the scratch card symbols (symbols.tsx and coversymbols.tsx). */

export type Grad = [offset: number, color: string][]

export function Lin({ id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1 }: { id: string; stops: Grad; x1?: number; y1?: number; x2?: number; y2?: number }) {
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </linearGradient>
  )
}

export function Rad({ id, stops, cx = 0.36, cy = 0.3, r = 0.8 }: { id: string; stops: Grad; cx?: number; cy?: number; r?: number }) {
  return (
    <radialGradient id={id} cx={cx} cy={cy} r={r}>
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </radialGradient>
  )
}

export const GOLD: Grad = [
  [0, '#fff4c2'],
  [0.35, '#ffd451'],
  [0.75, '#e8a21a'],
  [1, '#b06e08'],
]
export const shadow = (rx = 27, cy = 90, o = 0.2) => <ellipse cx="50" cy={cy} rx={rx} ry={rx * 0.18} fill="#000" opacity={o} />

/** a five-point star path */
export function starPath(cx: number, cy: number, ro: number, ri: number, n = 5) {
  return (
    'M' +
    Array.from({ length: n * 2 }, (_, i) => {
      const a = (i * Math.PI) / n - Math.PI / 2
      const r = i % 2 ? ri : ro
      return `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`
    }).join('L') +
    'Z'
  )
}

/** a four-point twinkle */
export function twinkle(x: number, y: number, r: number) {
  const k = r * 0.2
  return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`
}
