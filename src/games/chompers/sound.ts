/* Chompers' sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { hold, noise, sweep, tone } from '../../lib/sound'

export const chompersSfx = {
  /* chompers */
  reelStop: (n = 0) => {
    tone(118 - n * 6, 0.1, 'sine', 0.08, 0, 58)
    noise(0.04, 0.05, 1700, 'bandpass')
  },
  boing: () => {
    tone(196, 0.32, 'sine', 0.08, 0, 587)
    tone(392, 0.18, 'triangle', 0.03, 0.04, 784)
  },
  eggLand: (n = 0) => {
    const f = 659 * 2 ** ((Math.min(n, 5) * 4) / 12)
    tone(f, 0.16, 'triangle', 0.07)
    tone(f * 1.5, 0.24, 'sine', 0.045, 0.06)
  },
  donutLand: () => tone(700, 0.07, 'sine', 0.045, 0, 1100),
  // the bite itself (sfx.chomp(n)), with the newer Chompers moments hung off it as sfx.chomp.*: the Feast Pick, Big
  // Mama's voice, the meter, the multiplier stamps and the win tiers
  chomp: Object.assign(
    (n = 0) => {
      noise(0.08, 0.2, 900, 'lowpass')
      tone(150 + Math.min(n, 10) * 12, 0.08, 'square', 0.035, 0, 80)
      noise(0.05, 0.1, 2600, 'bandpass')
      tone(880 * 2 ** (Math.min(n, 12) / 12), 0.14, 'triangle', 0.04, 0.05)
    },
    {
      // Big Mama's three eggs rise: a rising wobble and a little chime as they settle
      rise: () => {
        sweep(0.55, 0.07, 260, 1500, 'bandpass', 1.2)
        tone(300, 0.55, 'triangle', 0.03, 0, 640, [7, 14])
        ;[784, 988, 1175].forEach((f, i) => tone(f, 0.2, 'sine', 0.03, 0.4 + i * 0.08))
      },
      // the pick's countdown: a woodblock that climbs as time runs out
      tick: (n = 0) => {
        tone(1050 * 2 ** ((Math.min(n, 4) * 2) / 12), 0.05, 'triangle', 0.04)
        noise(0.02, 0.05, 3200, 'bandpass')
      },
      // an eggshell giving way: a few crunchy snaps
      crack: () => {
        for (let i = 0; i < 4; i++) noise(0.045, 0.18 - i * 0.03, 2400 + i * 600, 'bandpass', i * 0.07)
        tone(260, 0.1, 'square', 0.02, 0, 130)
      },
      // the picked egg bursts: a thump, a sparkle run and a shimmering chord
      reveal: () => {
        noise(0.12, 0.22, 1800, 'highpass')
        tone(120, 0.22, 'sine', 0.12, 0, 50)
        ;[659, 784, 988, 1319, 1568].forEach((f, i) => tone(f, 0.2, 'triangle', 0.045, 0.05 + i * 0.05))
        ;[1319, 1661, 1976].forEach((f) => tone(f, 0.9, 'sine', 0.018, 0.32, undefined, [6, 9]))
      },
      // the eggs nobody picked: a muffled pop each, a little lower
      peek: (i = 0) => {
        noise(0.05, 0.1, 900, 'lowpass', i * 0.12)
        tone(560 - i * 70, 0.14, 'sine', 0.035, i * 0.12, 330 - i * 40)
      },
      // the modifier takes hold: a rising zap into a bright ding
      power: () => {
        sweep(0.3, 0.06, 600, 3200, 'bandpass', 2)
        tone(440, 0.28, 'square', 0.02, 0, 1320)
        tone(1760, 0.4, 'sine', 0.04, 0.26)
      },
      // +5 spins: five quick rising blips
      extra: () => [0, 2, 4, 7, 12].forEach((s, i) => tone(988 * 2 ** (s / 12), 0.09, 'square', 0.022, i * 0.06)),
      // Big Mama's voice: a big furry "mmmm", low, growly and wobbling
      grumble: () => {
        hold(98, 0.55, 'sawtooth', 0.02, 0, 78, [5, 5])
        hold(147, 0.55, 'triangle', 0.025, 0, 117, [5, 7])
        noise(0.45, 0.05, 380, 'lowpass')
      },
      // and her delighted "woo-hoo!"
      cheer: () => {
        hold(233, 0.16, 'sawtooth', 0.016, 0, 349, [7, 10])
        tone(466, 0.16, 'triangle', 0.025, 0, 698, [7, 10])
        hold(311, 0.38, 'sawtooth', 0.016, 0.17, 523, [7, 16])
        tone(622, 0.38, 'triangle', 0.025, 0.17, 1046, [7, 16])
      },
      // a hungry tummy, for Hungry Mode
      rumble: () => {
        for (let i = 0; i < 3; i++) tone(70 + i * 9, 0.22, 'sawtooth', 0.03, i * 0.17, 52 + i * 6, [11, 7])
        noise(0.55, 0.06, 260, 'lowpass')
      },
      // the collect multiplier stamped on the donuts, higher for a bigger one
      stamp: (mult = 2) => {
        const k = 2 ** ((Math.min(mult, 10) - 2) / 12)
        tone(160 * k, 0.12, 'sine', 0.1, 0, 80 * k)
        noise(0.06, 0.12, 1400, 'bandpass')
        tone(1320 * k, 0.16, 'triangle', 0.03, 0.04)
      },
      // wilds drip into the free-spins meter: one rising slime note per segment
      meter: (filled = 1) => {
        const f = [587, 698, 880, 1175][Math.max(0, Math.min(3, filled - 1))]
        tone(f * 0.5, 0.12, 'sine', 0.05, 0, f)
        tone(f, 0.2, 'triangle', 0.03, 0.06)
      },
      // the last free spin: a slow double heartbeat
      heartbeat: () => {
        tone(66, 0.14, 'sine', 0.1, 0, 44)
        tone(66, 0.14, 'sine', 0.09, 0.2, 44)
      },
      // a win banner passes a tier: a brassy stab, three semitones higher each time, and a cymbal swell
      tierUp: (k = 0) => {
        const s = 2 ** ((k * 3) / 12)
        ;[392, 494, 587, 784].forEach((f, i) => hold(f * s, i === 3 ? 0.42 : 0.12, 'sawtooth', 0.016, i * 0.07))
        ;[784, 988, 1175].forEach((f) => tone(f * s, 0.5, 'triangle', 0.025, 0.28))
        noise(0.5, 0.08, 6000, 'highpass', 0.28)
      },
    },
  ),
  whoosh: () => {
    noise(0.4, 0.1, 1100, 'bandpass')
    tone(900, 0.35, 'sine', 0.025, 0, 180)
  },
  hatch: () => {
    noise(0.3, 0.22, 2400, 'highpass')
    ;[523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.26, 'triangle', 0.055, 0.12 + i * 0.07))
  },
}
