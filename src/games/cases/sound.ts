/* Cases' (and Case Battles') sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { gate, hold, noise, sweep, tone } from '../../lib/sound'

/* cases */
export const casesSfx = {
  // choosing a crate (tier 0-3): a knock on wood, a clink of steel, a gold ring, a low obsidian hum
  pick: (tier = 0) => {
    if (tier === 0) {
      noise(0.05, 0.12, 700, 'lowpass')
      tone(210, 0.09, 'sine', 0.07, 0, 150)
    } else if (tier === 1) {
      tone(1250, 0.12, 'triangle', 0.028)
      tone(1870, 0.2, 'sine', 0.018, 0.01)
      noise(0.02, 0.05, 4200, 'highpass')
    } else if (tier === 2) {
      tone(1047, 0.22, 'sine', 0.032)
      tone(1568, 0.32, 'sine', 0.022, 0.05)
    } else {
      tone(110, 0.38, 'sawtooth', 0.016, 0, 82, [5, 3])
      tone(220, 0.38, 'sine', 0.04, 0, 164)
      tone(1320, 0.3, 'sine', 0.012, 0.05, 990)
    }
  },
  // the latch springs and the lid lifts: a clack, a puff of air rising, and a soft shimmer from inside
  open: (tier = 0) => {
    noise(0.03, 0.14, 2600 - tier * 300, 'bandpass')
    tone(170 - tier * 16, 0.12, 'sine', 0.09, 0, 85 - tier * 8)
    sweep(0.34, 0.045, 500, 2600, 'bandpass', 1.2, 0.03)
    ;[784, 1175].forEach((f, i) => tone(f, 0.34, 'sine', 0.016, 0.08 + i * 0.05, f * 1.5))
  },
  // a tile passes the marker: a short click, bright and light while the reel races, lower and fuller as it slows
  // (speed 0-1); gated so a fast reel never stacks clicks
  tick: (() => {
    const pass = gate(26)
    return (speed = 0) => {
      if (!pass()) return
      const s = Math.max(0, Math.min(1, speed))
      const f = 620 + 980 * s ** 0.7
      tone(f, 0.035, 'triangle', 0.046 - s * 0.022)
      noise(0.012, 0.036 - s * 0.016, f * 2.2, 'bandpass')
    }
  })(),
  // the reel rests on an item: a chime that grows with its rarity (0 common to 4 legendary)
  land: (rarity = 0) => {
    if (rarity <= 0) {
      noise(0.06, 0.06, 500, 'lowpass')
      tone(392, 0.16, 'triangle', 0.05)
      tone(330, 0.24, 'sine', 0.04, 0.07)
    } else if (rarity === 1) {
      ;[659, 880].forEach((f, i) => tone(f, 0.2, 'triangle', 0.055, i * 0.08))
      tone(1760, 0.34, 'sine', 0.014, 0.16)
    } else if (rarity === 2) {
      ;[659, 831, 988].forEach((f, i) => tone(f, 0.22, 'triangle', 0.055, i * 0.07))
      ;[1319, 1661].forEach((f) => tone(f, 0.55, 'sine', 0.02, 0.22, undefined, [6, 8]))
    } else if (rarity === 3) {
      sweep(0.42, 0.045, 800, 5000, 'bandpass', 2)
      ;[587, 740, 880, 1175].forEach((f, i) => tone(f, 0.24, 'triangle', 0.052, i * 0.07))
      ;[1175, 1480, 1760].forEach((f) => tone(f, 0.85, 'sine', 0.02, 0.3, undefined, [5, 9]))
    } else {
      // legendary: a low swell under a bright fanfare and a run of bells
      tone(65, 0.7, 'sine', 0.13, 0, 41)
      noise(0.7, 0.06, 6000, 'highpass')
      ;[523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.048, i * 0.06))
      ;[1046, 1319, 1568, 2093].forEach((f) => hold(f, 1, 'sawtooth', 0.007, 0.32, undefined, [5, 6]))
      ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.6, 'sine', 0.018, 0.42 + i * 0.08, undefined, [7, 10]))
    }
  },
  // one reel of a stack comes to rest (rarity 0-4, i its place in the stack): a soft clack, pitched up the stack, with
  // a little bell for anything from rare up; gated so a stack landing together never piles up
  stop: (() => {
    const pass = gate(40)
    return (rarity = 0, i = 0) => {
      if (!pass()) return
      const k = 2 ** ((i * 2) / 12)
      noise(0.03, 0.08, 1800 * k, 'bandpass')
      tone(260 * k, 0.09, 'triangle', 0.05, 0, 190 * k)
      if (rarity >= 2) tone([0, 0, 1319, 1568, 2093][rarity] * k, 0.3, 'sine', 0.02, 0.02, undefined, [6, 8])
    }
  })(),
}
