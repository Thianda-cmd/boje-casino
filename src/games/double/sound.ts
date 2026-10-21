/* Double's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { gate, hold, noise, sweep, tone } from '../../lib/sound'

/* double: colours are 0 red, 1 green, 2 black */
export const doubleSfx = {
  // a chip lands on a colour: a clack on the felt with a little note in the colour's key (green sparkles)
  chip: (c = 0) => {
    const f = [587, 784, 494][c] ?? 587
    noise(0.025, 0.09, 3200, 'bandpass')
    tone(f, 0.07, 'triangle', 0.05, 0, f * 1.25)
    tone(f * 2, 0.05, 'sine', 0.014, 0.012)
    if (c === 1) tone(1568, 0.2, 'sine', 0.014, 0.03, undefined, [7, 10])
  },
  // the last seconds of betting (3, 2, 1): a soft woodblock, brighter on the last one
  count: (n = 3) => {
    tone(n > 1 ? 880 : 1175, 0.07, 'triangle', 0.034)
    noise(0.014, 0.028, 4200, 'highpass')
  },
  // no more bets: two notes stepping down
  close: () => {
    tone(784, 0.1, 'triangle', 0.038)
    tone(587, 0.18, 'triangle', 0.038, 0.09)
  },
  // the strip pushes off: a low thump under a rush of air
  spin: () => {
    sweep(0.6, 0.05, 260, 2600, 'bandpass', 0.9)
    tone(98, 0.26, 'sine', 0.07, 0, 147)
  },
  // a tile passes the marker (speed 0-1): a soft tick, light while the strip races and rounder as it slows; gated so
  // a fast strip never stacks ticks
  tick: (() => {
    const pass = gate(24)
    return (speed = 0) => {
      if (!pass()) return
      const s = Math.max(0, Math.min(1, speed))
      const f = 700 + 900 * s ** 0.7
      tone(f, 0.03, 'triangle', 0.032 - s * 0.016)
      noise(0.01, 0.026 - s * 0.012, f * 2.3, 'bandpass')
    }
  })(),
  // the strip comes to rest: a soft thunk, then a chime in the winning colour; green gets a run of bells
  land: (c = 0) => {
    noise(0.05, 0.08, 700, 'lowpass')
    tone(150, 0.14, 'sine', 0.08, 0, 90)
    if (c === 1) {
      sweep(0.5, 0.04, 900, 5200, 'bandpass', 2, 0.05)
      ;[784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.26, 'triangle', 0.045, 0.06 + i * 0.06))
      ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.7, 'sine', 0.018, 0.4 + i * 0.07, undefined, [6, 9]))
    } else {
      const f = c === 0 ? 659 : 523
      tone(f, 0.2, 'triangle', 0.05, 0.05)
      tone(f * 1.5, 0.32, 'sine', 0.024, 0.12)
    }
  },
  // your bets paid: coins, with a fanfare when it is big (a green win)
  win: (big = false) => {
    ;[1047, 1319, 1568].forEach((f, i) => tone(f, 0.14, 'triangle', 0.045, i * 0.07))
    noise(0.06, 0.04, 6000, 'highpass', 0.05)
    if (big) {
      ;[523, 659, 784, 1047].forEach((f, i) => hold(f, 0.16, 'sawtooth', 0.012, 0.22 + i * 0.09))
      ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.6, 'sine', 0.018, 0.6 + i * 0.08, undefined, [6, 9]))
    }
  },
  // nothing came in
  lose: () => {
    tone(330, 0.16, 'triangle', 0.03)
    tone(262, 0.3, 'sine', 0.03, 0.12, 220)
  },
  // the table refused a chip (it comes straight back)
  refused: () => {
    tone(220, 0.12, 'square', 0.018)
    tone(185, 0.18, 'square', 0.016, 0.1)
  },
}
