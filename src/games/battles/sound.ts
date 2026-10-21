/* Case Battles' sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { hold, noise, sweep, tone } from '../../lib/sound'

/* case battles */
export const battlesSfx = {
  // the countdown before the first round: 3, 2, 1 as short beeps, then a bright go (n = 0)
  count: (n = 0) => {
    if (n > 0) {
      tone(660, 0.12, 'triangle', 0.06)
      tone(1320, 0.08, 'sine', 0.015)
    } else {
      tone(988, 0.22, 'triangle', 0.07)
      tone(1319, 0.3, 'sine', 0.035, 0.02)
      sweep(0.3, 0.04, 600, 3200, 'bandpass', 1.2)
    }
  },
  // every reel pushes off at once: a low whoosh under a rising rush of air
  push: () => {
    sweep(0.5, 0.05, 300, 2400, 'bandpass', 0.9)
    tone(110, 0.22, 'sine', 0.06, 0, 165)
  },
  // a seat fills: a two-note pop up
  join: () => {
    tone(523, 0.1, 'triangle', 0.06)
    tone(784, 0.16, 'triangle', 0.06, 0.08)
    noise(0.02, 0.05, 3600, 'highpass')
  },
  // a seat empties, or the battle is called off: the same two notes down, softer
  leave: () => {
    tone(659, 0.1, 'triangle', 0.045)
    tone(440, 0.18, 'triangle', 0.045, 0.08)
  },
  // the house bots roll in: three quick robot blips
  bots: () => {
    ;[880, 1175, 1568].forEach((f, i) => tone(f, 0.06, 'square', 0.022, i * 0.07))
    tone(196, 0.24, 'sine', 0.05, 0, 392)
  },
  // the last round is in and the winner is about to show: a snare roll that swells for `dur` seconds
  roll: (dur = 1.2) => {
    const n = Math.round(dur / 0.045)
    for (let i = 0; i < n; i++) noise(0.03, 0.025 + (i / n) * 0.06, 1800 + (i % 2) * 300, 'bandpass', i * 0.045)
    tone(98, dur, 'sine', 0.03, 0, 147)
  },
  // the winner: a fanfare for a win (or a share of a split pot), a soft low fall for a loss
  reveal: (won = false) => {
    if (won) {
      noise(0.12, 0.1, 900, 'lowpass')
      tone(65, 0.6, 'sine', 0.12, 0, 49)
      ;[523, 659, 784, 1046].forEach((f, i) => tone(f, 0.26, 'triangle', 0.06, i * 0.08))
      ;[1046, 1319, 1568].forEach((f) => hold(f, 0.8, 'sawtooth', 0.006, 0.32, undefined, [5, 6]))
      ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.5, 'sine', 0.016, 0.4 + i * 0.09, undefined, [7, 10]))
    } else {
      noise(0.1, 0.06, 600, 'lowpass')
      tone(392, 0.2, 'triangle', 0.045)
      tone(330, 0.24, 'triangle', 0.04, 0.12)
      tone(262, 0.4, 'sine', 0.04, 0.24, 196)
    }
  },
}
