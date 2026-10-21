/* Pot Luck's sounds. They live with the game so they load with it, not with every page; the synth they play on, and
   the sounds every page shares, are in src/lib/sound.ts. */
import { gate, hold, noise, reverseCymbal, sweep, swell, tone } from '../../lib/sound'

export const potSfx = {
  // someone's coins drop into the jar: a glassy clink, brighter and fuller the more they paid (k 0-1)
  clink: (() => {
    const pass = gate(55)
    return (k = 0.3) => {
      if (!pass()) return
      const s = Math.max(0, Math.min(1, k))
      const f = 2100 + 900 * s
      tone(f, 0.09, 'sine', 0.028, 0, f * 0.985, [9, 6])
      tone(f * 1.51, 0.06, 'sine', 0.012, 0.012)
      noise(0.02, 0.03, 6200, 'highpass')
      if (s > 0.55) for (let i = 1; i < 4; i++) tone(f * (1 + i * 0.07), 0.06, 'sine', 0.016, i * 0.05, undefined, [11, 5])
    }
  })(),
  // your own coins go in: a cascade down the glass, and a warm note under it
  pay: () => {
    for (let i = 0; i < 6; i++) {
      const f = 2600 - i * 140 + (i % 2) * 220
      tone(f, 0.07, 'sine', 0.03 - i * 0.003, i * 0.045, f * 0.98, [10, 6])
    }
    noise(0.03, 0.05, 5200, 'highpass', 0.02)
    tone(523, 0.18, 'triangle', 0.03, 0.04)
    tone(784, 0.22, 'triangle', 0.022, 0.1)
  },
  // a payment the pot wouldn't take
  refused: () => {
    tone(330, 0.1, 'square', 0.02)
    tone(262, 0.16, 'square', 0.02, 0.09)
  },
  // the last seconds of betting (3, 2, 1): a woodblock, brighter on the last one
  count: (n = 3) => {
    tone(n > 1 ? 880 : 1175, 0.07, 'triangle', 0.034)
    noise(0.014, 0.028, 4200, 'highpass')
  },
  // no more coins: the lid goes on with two notes stepping down
  close: () => {
    noise(0.05, 0.07, 900, 'lowpass')
    tone(784, 0.1, 'triangle', 0.036)
    tone(587, 0.18, 'triangle', 0.036, 0.09)
  },
  // the wheel is pushed off: a heave and a rising rush
  spin: () => {
    sweep(0.8, 0.05, 220, 2600, 'bandpass', 0.9)
    tone(98, 0.3, 'sine', 0.07, 0, 147)
    reverseCymbal(0.5, 0.015)
  },
  // a sliver of the ring passes the pointer (speed 0-1); gated so a fast wheel never stacks them
  tick: (() => {
    const pass = gate(26)
    return (speed = 0) => {
      if (!pass()) return
      const s = Math.max(0, Math.min(1, speed))
      const f = 760 + 900 * s ** 0.7
      tone(f, 0.028, 'triangle', 0.034 - s * 0.016)
      noise(0.01, 0.026 - s * 0.012, f * 2.2, 'bandpass')
    }
  })(),
  // the wheel stops on the winner: a thunk and a bright bell
  land: () => {
    noise(0.05, 0.08, 700, 'lowpass')
    tone(150, 0.14, 'sine', 0.08, 0, 90)
    tone(1047, 0.35, 'sine', 0.035, 0.04, undefined, [5, 8])
    tone(1568, 0.3, 'sine', 0.018, 0.08)
  },
  // you won the pot: coins pour out under a fanfare that grows with the pot (big: a pot well over your coins)
  win: (big = false) => {
    ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, 'triangle', 0.045, i * 0.08))
    hold(1568, 0.8, 'triangle', 0.016, 0.34, undefined, [5, 7])
    for (let i = 0; i < 14; i++) tone(2400 + ((i * 373) % 900), 0.06, 'sine', 0.016, 0.2 + i * 0.055, undefined, [10, 6])
    sweep(0.9, 0.03, 1200, 7000, 'bandpass', 2, 0.25)
    if (big) {
      swell(1.2, 0.025, 'bandpass', 2400, 1.4, 0.4, 0.3)
      ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.7, 'sine', 0.02, 0.55 + i * 0.09, undefined, [6, 9]))
    }
  },
  // someone else won: a polite little flourish
  other: () => {
    tone(659, 0.16, 'triangle', 0.03)
    tone(880, 0.22, 'triangle', 0.026, 0.1)
  },
  // you were in and lost: a soft two-note fall
  lose: () => {
    tone(392, 0.16, 'triangle', 0.028)
    tone(311, 0.26, 'triangle', 0.028, 0.12)
  },
  // the next round opens: the empty jar rings
  open: () => {
    tone(1319, 0.25, 'sine', 0.014, 0, undefined, [4, 6])
    tone(1976, 0.2, 'sine', 0.008, 0.05)
  },
}
