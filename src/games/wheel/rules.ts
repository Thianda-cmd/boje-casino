/* Wheel: every segment table returns 99% on average (sum of multipliers = 0.99 × segments). */

export type WheelRisk = 'low' | 'medium' | 'high'
export const SEGMENT_COUNTS = [10, 20, 30, 40, 50] as const
export type SegmentCount = (typeof SEGMENT_COUNTS)[number]

const LOW = [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0]
const MEDIUM: Record<SegmentCount, number[]> = {
  10: [0, 1.9, 0, 1.5, 0, 2, 0, 1.5, 0, 3],
  20: [1.5, 0, 2, 0, 2, 0, 2, 0, 1.5, 0, 3, 0, 1.8, 0, 2, 0, 2, 0, 2, 0],
  30: [1.5, 0, 2, 0, 1.5, 0, 2, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 2, 0, 1.7, 0, 4, 0, 1.5, 0, 2, 0, 1.5, 0],
  40: [1.5, 0, 3, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.6, 0, 2, 0, 3, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0],
  50: [1.5, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.5, 0, 2, 0, 1.5, 0, 5, 0, 1.5, 0, 2, 0],
}

export function wheelSegments(n: SegmentCount, risk: WheelRisk): number[] {
  if (risk === 'low') return Array.from({ length: n }, (_, i) => LOW[i % 10])
  if (risk === 'medium') return MEDIUM[n]
  return Array.from({ length: n }, (_, i) => (i === 0 ? Math.round(0.99 * n * 100) / 100 : 0))
}

export function segmentColor(m: number) {
  if (m === 0) return '#34495c'
  if (m < 1.5) return '#d7e2ec'
  if (m === 1.5) return '#22d36f'
  if (m < 2) return '#4cb4ff'
  if (m === 2) return '#f7c548'
  if (m === 3) return '#9b7bff'
  if (m === 4) return '#ff8a3d'
  if (m < 9) return '#ff5fa2'
  return '#ff4d61'
}
