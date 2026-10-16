/*
  The motion curves behind every loot reel (Cases' horizontal reels and the Case Battles columns). A curve maps
  milliseconds to a position in tiles; the reels sample it into a few hundred keyframes of one Web Animation, so the
  compositor runs the spin at the display's rate whatever the page is doing.
*/

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smooth = (x: number) => x * x * (3 - 2 * x)

export interface Curve {
  dur: number
  posAt: (ms: number) => number
}

export interface SpinShape {
  /** seconds of the push and the long ease-out */
  main: number
  /** seconds of the slide back from the overshoot */
  settle: number
  /** how sharply the speed falls: (1 − s)^k */
  k: number
  /** share of the main phase spent speeding up */
  ramp: number
  /** tiles carried past the stop before settling back */
  overshoot: number
}

/**
 * Position (in tiles) over time for a spin from `from` to `to`: speed rises over the first `ramp` of the main phase,
 * then falls as (1 − s)^k, carrying the reel `overshoot` tiles past the stop, and a gentle cosine brings it back.
 */
export function spinCurve(from: number, to: number, o: SpinShape): Curve {
  const N = 720
  const cum = new Float64Array(N + 1)
  for (let i = 1; i <= N; i++) {
    const s = (i - 0.5) / N
    cum[i] = cum[i - 1] + smooth(Math.min(1, s / o.ramp)) * (1 - s) ** o.k
  }
  const total = cum[N]
  const span = to + o.overshoot - from
  const main = o.main * 1000
  const settle = o.settle * 1000
  return {
    dur: main + settle,
    posAt: (ms) => {
      if (ms <= 0) return from
      if (ms < main) {
        const f = (ms / main) * N
        const i = Math.floor(f)
        return from + (span * (cum[i] + (cum[Math.min(N, i + 1)] - cum[i]) * (f - i))) / total
      }
      const u = Math.min(1, (ms - main) / settle)
      return to + (o.overshoot * (1 + Math.cos(Math.PI * u))) / 2
    },
  }
}

/** A Hermite glide from `from` (moving at v0 tiles per ms) to rest at `to`, shortened if needed so it never overshoots. */
export function glideCurve(from: number, to: number, v0: number, ms: number): Curve {
  const d = to - from
  let T = ms
  if (v0 > 0 && v0 * T > 3 * d) T = Math.max(60, (3 * d) / v0)
  const m0 = Math.min(v0 * T, 3 * d)
  return {
    dur: T,
    posAt: (t) => {
      const s = clamp01(t / T)
      const s2 = s * s
      const s3 = s2 * s
      return from * (2 * s3 - 3 * s2 + 1) + m0 * (s3 - 2 * s2 + s) + to * (3 * s2 - 2 * s3)
    },
  }
}

/** The same curve held at its start for `ms` first (a staggered reel waits its turn inside its own animation). */
export function delayed(c: Curve, ms: number): Curve {
  if (ms <= 0) return c
  return { dur: c.dur + ms, posAt: (t) => c.posAt(t - ms) }
}

/** Keyframes for a curve, sampled at 60 per second, with `tf` turning a position into a transform. */
export function keyframes(c: Curve, to: number, tf: (pos: number) => string): Keyframe[] {
  const frames: Keyframe[] = []
  const step = 1000 / 60
  for (let t = 0; t < c.dur; t += step) frames.push({ transform: tf(c.posAt(t)), offset: t / c.dur })
  frames.push({ transform: tf(to), offset: 1 })
  return frames
}
