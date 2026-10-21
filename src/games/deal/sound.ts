/* Banker's Deal's sounds: a TV studio's. They live with the game so they load with it, not with every page; the synth
   they play on, and the sounds every page shares, are in src/lib/sound.ts.

   The studio's voice: a brass sting to open the show, the board's reveal (a soft chime for Classic, a fanfare with
   shimmer for Gold, the full works for Diamond), the latches and lid of a case, and the room's answer to its prize
   (a cheer when a small prize goes, a groan when a big one does). The Banker's phone is an old bell trill; his offer
   builds on a riser and lands on a stab. DEAL is a gavel and a till; NO DEAL a defiant brass hit. The player's own
   case gets a drumroll, and what it held is played in the mood it deserves. */
import { gate, hold, nasal, noise, reverseCymbal, sweep, swell, tone } from '../../lib/sound'

/** the crowd: filtered noise swelling in and out (warm and bright layers) */
const crowd = (dur: number, gain: number, delay = 0, bright = 1) => {
  swell(dur, gain, 'bandpass', 900 * bright, 0.7, dur * 0.25, delay)
  swell(dur * 0.9, gain * 0.6, 'bandpass', 2200 * bright, 1.1, dur * 0.2, delay + 0.03)
}
/** a pattering of claps */
const claps = (dur: number, gain: number, delay = 0) => {
  const n = Math.round(dur / 0.035)
  for (let i = 0; i < n; i++) noise(0.02 + Math.random() * 0.02, gain * (0.5 + Math.random() * 0.5) * (1 - (i / n) * 0.6), 1600 + Math.random() * 1800, 'bandpass', delay + i * 0.035 + Math.random() * 0.03)
}

export const dealSfx = {
  // the show opens: a brass sting over a swell
  start: () => {
    ;[392, 494, 587].forEach((f) => hold(f, 0.16, 'sawtooth', 0.016, 0))
    ;[523, 659, 784].forEach((f) => hold(f, 0.42, 'sawtooth', 0.018, 0.18))
    tone(1047, 0.5, 'triangle', 0.03, 0.18)
    sweep(0.5, 0.025, 800, 5200, 'bandpass', 1.2)
  },
  // the board's badge flicks past a tier
  flick: (() => {
    const pass = gate(40)
    return (i = 0) => {
      if (!pass()) return
      tone(880 + (i % 3) * 220, 0.04, 'square', 0.014)
      noise(0.012, 0.025, 5000, 'highpass')
    }
  })(),
  // the board is set: a chime for Classic; Gold and Diamond are events
  board: (id: 'classic' | 'gold' | 'diamond') => {
    if (id === 'classic') {
      ;[659, 988].forEach((f, i) => tone(f, 0.3, 'triangle', 0.04, i * 0.07))
      return
    }
    if (id === 'gold') {
      reverseCymbal(0.5, 0.04)
      ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.24, 'square', 0.022, 0.5 + i * 0.08))
      hold(1047, 0.8, 'sawtooth', 0.014, 0.82)
      ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.7, 'sine', 0.02, 0.9 + i * 0.07, undefined, [6, 10]))
      crowd(1.6, 0.03, 0.6)
      return
    }
    reverseCymbal(0.8, 0.05)
    for (let i = 0; i < 12; i++) noise(0.04, 0.025 + i * 0.003, 240, 'lowpass', i * 0.06)
    ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'square', 0.024, 0.8 + i * 0.08))
    hold(1319, 1.3, 'sawtooth', 0.016, 1.2)
    hold(659, 1.3, 'sawtooth', 0.012, 1.2)
    sweep(1.4, 0.035, 900, 8000, 'bandpass', 2, 0.85)
    ;[2093, 2637, 3136, 4186].forEach((f, i) => tone(f, 0.8, 'sine', 0.018, 1 + i * 0.09, undefined, [7, 12]))
    crowd(2.4, 0.045, 0.8, 1.1)
    claps(1.8, 0.05, 1.0)
  },
  // the player keeps a case: a thunk and a confident two-note chime
  pick: () => {
    noise(0.05, 0.08, 700, 'lowpass')
    tone(140, 0.14, 'sine', 0.08, 0, 90)
    tone(784, 0.14, 'triangle', 0.045, 0.06)
    tone(1175, 0.24, 'triangle', 0.04, 0.13)
  },
  // a case is opened: two latches snap, the lid swings
  latch: () => {
    tone(2600, 0.02, 'square', 0.02)
    noise(0.015, 0.05, 4200, 'bandpass')
    tone(2300, 0.02, 'square', 0.02, 0.06)
    noise(0.015, 0.05, 3800, 'bandpass', 0.06)
    sweep(0.22, 0.03, 600, 2400, 'bandpass', 1.2, 0.08)
  },
  /**
   * The room answers the prize that came out, by its rank on the board (0 the smallest, 1 the top): a small one gone
   * is a cheer, a big one gone a groan, the top one a crushing one; in between, a plain chime.
   */
  prize: (rank: number) => {
    if (rank <= 0.3) {
      // a small prize gone: good news
      const k = 1 + (0.3 - rank)
      ;[659, 831, 988].forEach((f, i) => tone(f * k * 0.9, 0.16, 'triangle', 0.035, i * 0.05))
      crowd(0.9, 0.028 + (0.3 - rank) * 0.04, 0.02, 1.15)
      claps(0.5, 0.03, 0.08)
    } else if (rank >= 0.7) {
      // a big prize gone: the groan
      const top = rank >= 0.99
      nasal(220, top ? 0.9 : 0.6, 0.05, 0, top ? 110 : 150, 700)
      nasal(165, top ? 0.9 : 0.6, 0.04, 0.02, top ? 82 : 110, 520)
      swell(top ? 1.3 : 0.9, top ? 0.05 : 0.035, 'lowpass', 600, 0.8, 0.15)
      tone(196, 0.5, 'sawtooth', 0.025, 0.05, 98)
    } else {
      tone(740, 0.12, 'triangle', 0.04)
      tone(988, 0.2, 'sine', 0.03, 0.05)
    }
  },
  // the prize board's bar goes dark
  flip: (() => {
    const pass = gate(30)
    return () => {
      if (!pass()) return
      noise(0.03, 0.05, 2600, 'bandpass')
      tone(420, 0.06, 'square', 0.012, 0, 260)
    }
  })(),
  // the Banker's phone: an old bell trill, twice
  ring: () => {
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 16; i++) tone(i % 2 ? 1260 : 1480, 0.035, 'triangle', 0.032, r * 0.62 + i * 0.026)
      noise(0.36, 0.012, 3200, 'bandpass', r * 0.62)
    }
  },
  // he picks up; the offer builds
  pickup: () => {
    noise(0.05, 0.08, 500, 'lowpass')
    tone(180, 0.08, 'square', 0.02, 0, 120)
  },
  build: (dur = 1.1) => {
    sweep(dur, 0.04, 300, 3800, 'bandpass', 2)
    tone(110, dur, 'sawtooth', 0.016, 0, 330)
    tone(220, dur, 'triangle', 0.014, 0, 660)
    for (let i = 0; i < 10; i++) noise(0.03, 0.015 + i * 0.002, 260, 'lowpass', (i / 10) * dur)
  },
  // the offer lands on the screen
  offer: () => {
    noise(0.06, 0.1, 900, 'lowpass')
    ;[392, 494, 587, 784].forEach((f) => hold(f, 0.4, 'sawtooth', 0.012, 0))
    tone(1568, 0.5, 'sine', 0.02, 0.02, undefined, [6, 8])
  },
  // the offer's digits count up
  count: (() => {
    const pass = gate(55)
    return (k = 0) => {
      if (!pass()) return
      tone(900 + 700 * Math.min(1, k), 0.025, 'square', 0.01)
    }
  })(),
  // DEAL: the gavel, the till, the applause
  deal: () => {
    noise(0.05, 0.16, 800, 'lowpass')
    tone(120, 0.16, 'sine', 0.1, 0, 70)
    tone(2637, 0.08, 'square', 0.02, 0.18)
    tone(3520, 0.3, 'sine', 0.03, 0.24, undefined, [9, 14])
    crowd(1.4, 0.035, 0.15)
    claps(1.2, 0.045, 0.2)
  },
  // NO DEAL: a defiant brass hit and a roar
  noDeal: () => {
    noise(0.06, 0.12, 900, 'lowpass')
    ;[262, 330, 392].forEach((f) => hold(f, 0.32, 'sawtooth', 0.02, 0))
    ;[349, 440, 523].forEach((f) => hold(f, 0.5, 'sawtooth', 0.02, 0.16))
    crowd(1.1, 0.04, 0.1, 1.05)
  },
  // the cases change places
  swap: () => {
    sweep(0.5, 0.05, 500, 3000, 'bandpass', 1.4)
    sweep(0.5, 0.04, 3000, 500, 'bandpass', 1.4, 0.25)
    tone(660, 0.1, 'triangle', 0.03, 0.6)
    tone(880, 0.16, 'triangle', 0.03, 0.68)
  },
  // the drumroll before the player's case opens, into a cymbal
  drumroll: (dur = 1.6) => {
    const n = Math.round(dur / 0.045)
    for (let i = 0; i < n; i++) noise(0.05, 0.03 + (i / n) * 0.05, 260 + (i / n) * 120, 'lowpass', i * 0.045)
    swell(dur, 0.02, 'lowpass', 400, 1, dur * 0.8)
  },
  cymbal: () => {
    noise(0.9, 0.06, 6000, 'highpass')
    noise(0.12, 0.12, 300, 'lowpass')
  },
  // what the player's case held, played in its mood: m is what the game paid as a multiple of the stake
  reveal: (m: number, good: boolean) => {
    if (m >= 5) {
      ;[523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.3, 'square', 0.022, i * 0.07))
      hold(1568, 1.1, 'sawtooth', 0.014, 0.45)
      hold(784, 1.1, 'sawtooth', 0.012, 0.45)
      ;[2093, 2637, 3136].forEach((f, i) => tone(f, 0.8, 'sine', 0.02, 0.5 + i * 0.08, undefined, [6, 10]))
      crowd(2.2, 0.05, 0.1, 1.1)
      claps(1.8, 0.05, 0.3)
    } else if (m >= 1 || good) {
      ;[784, 988, 1175].forEach((f, i) => tone(f, 0.2, 'triangle', 0.045, i * 0.07))
      crowd(1.2, 0.03, 0.1)
      claps(0.9, 0.035, 0.2)
    } else {
      // the sad trombone
      ;[392, 370, 349].forEach((f, i) => nasal(f, 0.32, 0.04, i * 0.3, f * 0.97, 900))
      nasal(330, 0.8, 0.04, 0.9, 300, 900)
      swell(1, 0.025, 'lowpass', 600, 0.8, 0.2, 0.3)
    }
  },
  // coins counted up in the celebration
  tick: (() => {
    const pass = gate(45)
    return (k = 0) => {
      if (!pass()) return
      tone(1300 + 900 * Math.min(1, k), 0.03, 'triangle', 0.016)
    }
  })(),
  // a refused press (a case that can't be opened now)
  nope: () => tone(220, 0.08, 'triangle', 0.03, 0, 180),
}
