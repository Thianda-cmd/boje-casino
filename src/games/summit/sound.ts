/* Summit's sounds: the mountain's. They live with the game so they load with it, not with every page; the synth they
   play on, and the sounds every page shares, are in src/lib/sound.ts.

   The mountain's voice: wind that blows harder, colder and higher-pitched the further up the climber is (with a
   whistle across the rocks near the top), footsteps that crunch gravel low down and snow above the snow line,
   the clink of a hand finding a hold and of a carabiner clipping in, a rope creaking under load on the Sheer Wall,
   and a low drone that rises under the riskier pitches while they hang in the balance. A pitch that holds lands on
   a bright chime that climbs in pitch with the altitude; one that gives way snaps (rock, or the rope) and the fall
   is a long whoosh down into the clouds. Banking jingles coins into the pouch; the summit gets the full fanfare. */
import { gate, hold, noise, reverseCymbal, sweep, swell, tone } from '../../lib/sound'

/** the altitude as a share of the climb (0 base camp, 1 the summit) */
const h = (k: number) => Math.max(0, Math.min(1, k / 10))

export const summitSfx = {
  /** a gust of wind at camp k: stronger, colder and higher the further up */
  wind: (k: number, dur = 2.2) => {
    const x = h(k)
    swell(dur, 0.014 + x * 0.045, 'bandpass', 320 + x * 520, 0.6, dur * 0.42)
    swell(dur * 0.85, 0.006 + x * 0.026, 'bandpass', 1300 + x * 1500, 2.2, dur * 0.5, 0.18)
    if (x > 0.55) sweep(dur * 0.7, 0.01 * x, 900, 2400 + x * 800, 'bandpass', 7, dur * 0.2)
  },
  /** a footstep: gravel low down, a crunch in the snow above the snow line */
  step: (() => {
    const pass = gate(90)
    return (snow: boolean) => {
      if (!pass()) return
      if (snow) {
        noise(0.08, 0.06, 3000, 'bandpass')
        noise(0.06, 0.05, 700, 'lowpass', 0.015)
      } else {
        noise(0.05, 0.075, 1100, 'lowpass')
        tone(105 + Math.random() * 20, 0.05, 'sine', 0.03)
      }
    }
  })(),
  /** a hand finds a hold, or a piton clinks */
  grab: (() => {
    const pass = gate(120)
    return () => {
      if (!pass()) return
      tone(2700 + Math.random() * 500, 0.03, 'square', 0.011)
      noise(0.03, 0.045, 3200, 'bandpass')
      noise(0.04, 0.04, 600, 'lowpass', 0.01)
    }
  })(),
  /** a carabiner clips in */
  clip: () => {
    tone(3300, 0.025, 'square', 0.014)
    tone(2500, 0.05, 'triangle', 0.02, 0.035)
    noise(0.02, 0.04, 5200, 'highpass', 0.01)
  },
  /** the rope creaks under the climber's weight */
  creak: (() => {
    const pass = gate(350)
    return () => {
      if (!pass()) return
      tone(150, 0.34, 'sawtooth', 0.011, 0, 112, [24, 16])
      tone(215, 0.22, 'sawtooth', 0.007, 0.12, 170, [31, 20])
    }
  })(),
  /** the climb begins: a clip, a gust, and a two-note call */
  start: () => {
    summitSfx.clip()
    summitSfx.wind(0, 1.6)
    tone(392, 0.16, 'triangle', 0.045, 0.08)
    tone(587, 0.3, 'triangle', 0.045, 0.2)
  },
  /** a route card is pointed at (i: 0 the Trail ... 3 the Wall) */
  pick: (i: number) => tone(500 + i * 110, 0.05, 'triangle', 0.03),
  /** under a pitch while it hangs in the balance: a drone rising with the risk (0 the Trail ... 1 the Wall) */
  tension: (risk: number, dur: number) => {
    if (risk <= 0.05) return
    tone(98, dur, 'sawtooth', 0.006 + risk * 0.012, 0, 98 * (1.3 + risk * 0.7))
    swell(dur, 0.008 + risk * 0.02, 'lowpass', 260 + risk * 200, 0.7, dur * 0.85)
    if (risk > 0.7) tone(49, dur, 'sine', 0.05, 0, 62)
  },
  /** the pitch held: a chime that climbs in pitch with the camp reached */
  made: (k: number, big = false) => {
    const f = 523 * 2 ** (h(k) * 1.1)
    ;[1, 1.26, 1.5].forEach((m, i) => tone(f * m, 0.18, 'triangle', 0.042, i * 0.055))
    tone(f * 2, 0.45, 'sine', 0.026, 0.17)
    if (big) {
      noise(0.05, 0.08, 500, 'lowpass')
      ;[1, 1.26, 1.5, 2].forEach((m, i) => tone(f * m * 2, 0.5, 'sine', 0.014, 0.25 + i * 0.05, undefined, [6, 8]))
    }
  },
  /** the rock gives way: a crack and a rattle of stones */
  crumble: () => {
    noise(0.06, 0.2, 1800, 'bandpass')
    tone(130, 0.12, 'sine', 0.07, 0, 60)
    for (let i = 0; i < 7; i++) noise(0.03, 0.05 * (1 - i / 9), 900 + Math.random() * 1500, 'bandpass', 0.06 + i * 0.07 + Math.random() * 0.04)
  },
  /** the rope snaps */
  snap: () => {
    noise(0.05, 0.26, 4300, 'highpass')
    tone(1900, 0.07, 'square', 0.03, 0, 280)
    tone(88, 0.16, 'sine', 0.08, 0.01, 46)
    sweep(0.25, 0.04, 3000, 600, 'bandpass', 3, 0.03)
  },
  /** the fall: a long whoosh down, a falling cry of a tone, and a soft thump far below in the clouds */
  fall: () => {
    sweep(1.5, 0.075, 2600, 150, 'bandpass', 1.3)
    tone(640, 1.1, 'triangle', 0.03, 0.05, 130)
    swell(1.2, 0.03, 'lowpass', 420, 0.8, 0.5, 0.2)
    noise(0.4, 0.05, 260, 'lowpass', 1.35)
  },
  /** banking: coins into the pouch and a cheerful sting, brighter for a bigger multiplier */
  bank: (m: number) => {
    const n = Math.min(10, 4 + Math.floor(Math.log2(Math.max(1, m)) * 1.5))
    for (let i = 0; i < n; i++) tone(1500 + Math.random() * 700, 0.07, 'square', 0.016, i * 0.045)
    ;[659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.05, 0.1 + i * 0.07))
    tone(1568, 0.5, 'sine', 0.03, 0.32)
    if (m >= 10) {
      reverseCymbal(0.4, 0.03)
      ;[1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.6, 'sine', 0.018, 0.4 + i * 0.06, undefined, [6, 9]))
    }
  },
  /** the summit: a cymbal swell into a brass fanfare, with sparkle on top */
  summit: () => {
    reverseCymbal(0.7, 0.05)
    ;[523, 659, 784].forEach((f) => hold(f, 0.22, 'sawtooth', 0.016, 0.7))
    ;[587, 740, 880].forEach((f) => hold(f, 0.22, 'sawtooth', 0.016, 0.95))
    ;[659, 831, 988, 1319].forEach((f) => hold(f, 1.2, 'sawtooth', 0.015, 1.2))
    tone(1319, 1.3, 'triangle', 0.03, 1.2)
    sweep(1.4, 0.03, 900, 7000, 'bandpass', 2, 1.15)
    ;[2093, 2637, 3136, 4186].forEach((f, i) => tone(f, 0.8, 'sine', 0.016, 1.3 + i * 0.09, undefined, [7, 12]))
    for (let i = 0; i < 10; i++) noise(0.02 + Math.random() * 0.02, 0.03, 1600 + Math.random() * 1800, 'bandpass', 1.3 + i * 0.05 + Math.random() * 0.03)
  },
}
