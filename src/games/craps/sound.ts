/* Craps' sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { crackle, gate, hold, noise, reverseCymbal, sweep, tone } from '../../lib/sound'

/**
 * Craps' sounds: clay chips on felt, the dice rattled in the shooter's hand and let go, their knocks down the table
 * (a muffled thud on the felt, a padded knock on the rail, a hard clack off the rubber pyramids, a click die on
 * die), the stickman's stick, the puck, a little melodic sting for each call, the dealer's sweep and payout, the
 * wins by tier and the Fire Bet catching light.
 */
export const crapsSfx = (() => {
  const g = { felt: gate(32), wall: gate(30), back: gate(26), die: gate(28), chip: gate(30), count: gate(45), knock: gate(40) }
  /** a marimba-ish note: a sine with a quick knock of its octave on top */
  const mallet = (f: number, gain: number, delay = 0, len = 0.32) => {
    tone(f, len, 'sine', gain, delay)
    tone(f * 4, 0.05, 'sine', gain * 0.35, delay)
    tone(f * 2, len * 0.6, 'triangle', gain * 0.25, delay)
  }
  return {
    // a chip set on a spot: a clay clack on felt
    chip: () => {
      if (!g.chip()) return
      noise(0.022, 0.1, 3300, 'bandpass')
      tone(2300, 0.03, 'triangle', 0.015)
      tone(1600, 0.05, 'sine', 0.018, 0.016)
    },
    // a chip taken back off: the same clack, softer, sliding away
    remove: () => {
      noise(0.03, 0.06, 2100, 'bandpass')
      tone(1450, 0.07, 'sine', 0.016, 0, 1000)
    },
    // a chip the table won't take
    nope: () => tone(233, 0.1, 'triangle', 0.045, 0, 165),
    // the stickman's stick pushes the dice back over the felt
    collect: () => {
      sweep(0.55, 0.022, 900, 320, 'lowpass', 0.7)
      noise(0.05, 0.035, 1500, 'bandpass', 0.46)
      tone(1250, 0.03, 'triangle', 0.008, 0.48)
    },
    // the dice rattled in the shooter's closed hand: a quick run of knocks, then the hand opens
    shake: (dur = 0.42) => {
      const n = Math.max(4, Math.round(dur / 0.05))
      for (let i = 0; i < n; i++) {
        const t = i * (dur / n) + Math.random() * 0.012
        noise(0.014, 0.045 + Math.random() * 0.035, 2400 + Math.random() * 1600, 'bandpass', t)
        if (i % 2) tone(1300 + Math.random() * 600, 0.022, 'triangle', 0.007, t)
      }
    },
    // the dice leave the hand: a soft whoosh
    release: () => sweep(0.3, 0.028, 450, 2300, 'bandpass', 1.1),
    // a knock (k 0-1, how hard): the felt, the padded rail, the rubber pyramids of the backboard, the other die
    hit: (on: 'felt' | 'wall' | 'back' | 'die', k: number) => {
      if (k < 0.06) return
      if (on === 'felt') {
        if (!g.felt()) return
        noise(0.05, 0.03 + 0.09 * k, 480, 'lowpass')
        tone(140, 0.06, 'sine', 0.012 + 0.03 * k, 0, 85)
      } else if (on === 'wall') {
        if (!g.wall()) return
        noise(0.03, 0.04 + 0.08 * k, 900, 'lowpass')
        tone(310 + Math.random() * 60, 0.07, 'triangle', 0.012 + 0.025 * k, 0, 200)
      } else if (on === 'back') {
        if (!g.back()) return
        noise(0.016, 0.06 + 0.12 * k, 3000 + Math.random() * 1200, 'bandpass')
        tone(720 + Math.random() * 160, 0.05, 'square', 0.006 + 0.014 * k, 0, 520)
        tone(190, 0.07, 'sine', 0.02 + 0.03 * k, 0.004, 120)
      } else {
        if (!g.die()) return
        noise(0.016, 0.04 + 0.1 * k, 2700 + Math.random() * 900, 'bandpass')
        tone(1300 + Math.random() * 450, 0.034, 'triangle', 0.01 + 0.022 * k)
      }
    },
    // the dice lie still and can be read
    settle: () => {
      tone(98, 0.16, 'sine', 0.045, 0, 70)
      tone(1175, 0.3, 'sine', 0.012, 0.04)
    },
    // the dealer sets the puck down, flipped ON or OFF
    puck: (on: boolean) => {
      if (!g.knock()) return
      noise(0.02, 0.08, 1700, 'bandpass')
      tone(on ? 920 : 620, 0.05, 'triangle', 0.02)
      tone(240, 0.09, 'sine', 0.035, 0.012, 170)
    },
    // the stickman's call, as a little sting: a natural rises, craps sags, the point is marked with two firm notes,
    // a point made gets a fanfare, a seven-out falls away; any other roll a single note by its total (a pair
    // sparkles)
    call: (event: 'natural' | 'craps' | 'point-set' | 'point-made' | 'seven-out' | 'roll', total: number, hard: boolean) => {
      switch (event) {
        case 'natural':
          ;[659, 831, 988, 1319].forEach((f, i) => mallet(f, 0.04, i * 0.065))
          break
        case 'craps':
          mallet(392, 0.045)
          mallet(370, 0.04, 0.13)
          tone(185, 0.4, 'triangle', 0.03, 0.26, 150)
          break
        case 'point-set':
          mallet(523, 0.045)
          mallet(784, 0.05, 0.12, 0.45)
          break
        case 'point-made':
          ;[523, 659, 784].forEach((f, i) => mallet(f, 0.045, i * 0.07))
          ;[523, 659, 784, 1047].forEach((f) => hold(f, 0.7, 'triangle', 0.012, 0.24, undefined, [5, 3]))
          break
        case 'seven-out':
          ;[659, 523, 440, 349].forEach((f, i) => mallet(f, 0.042, i * 0.11, 0.4))
          tone(87, 0.6, 'sine', 0.06, 0.4, 60)
          break
        default:
          mallet(330 * 2 ** ((total - 2) / 12), 0.035)
          if (hard) [1568, 2093, 2637].forEach((f, i) => tone(f, 0.22, 'sine', 0.012, 0.08 + i * 0.05))
      }
    },
    // the dealer sweeps the losing chips off to the house
    sweep: () => {
      sweep(0.34, 0.04, 2500, 800, 'bandpass', 1.2)
      ;[2800, 2400].forEach((f, i) => tone(f, 0.03, 'square', 0.009, 0.1 + i * 0.09))
    },
    // winnings slide in beside the winning stakes: a run of chip clicks
    pay: () => {
      noise(0.2, 0.035, 1600, 'bandpass')
      ;[2700, 3150, 2900, 3300].forEach((f, i) => tone(f, 0.03, 'square', 0.011, 0.06 + i * 0.055))
    },
    // the win, by tier: 0 a plain win (bigger for a win over the stakes), 1 Big, 2 Huge, 3 Massive
    win: (tier: number) => {
      if (tier <= 0) {
        ;[784, 988, 1175].forEach((f, i) => tone(f, 0.24, 'triangle', 0.045, i * 0.07))
        tone(2349, 0.45, 'sine', 0.011, 0.22)
        return
      }
      if (tier >= 3) reverseCymbal(0.6, 0.05)
      const lead = tier >= 3 ? 0.6 : 0
      ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, 'triangle', 0.06, lead + i * 0.07))
      ;[523, 659, 784, 1047].forEach((f) => hold(f, 0.9 + tier * 0.3, 'triangle', 0.016, lead + 0.36, undefined, [5, 3]))
      ;[2093, 2637, 3136].forEach((f, i) => tone(f, 0.9, 'sine', 0.01, lead + 0.42 + i * 0.08, undefined, [6, 8]))
      if (tier >= 2) tone(65, 1.2, 'sine', 0.1, lead + 0.34, 46)
    },
    // a big win counted up (p 0-1): ticks that climb
    count: (p: number) => {
      if (!g.count()) return
      tone(1150 + p * 900, 0.04, 'square', 0.011)
    },
    // a point made lights the Fire Bet's square (n: points made so far, 1-6): a flame's whoosh and a bell that
    // climbs with every point; the payouts get a roar
    fire: (n: number) => {
      sweep(0.45, 0.03 + 0.008 * n, 300, 2600, 'bandpass', 0.9)
      crackle(0.3 + 0.05 * n, 0.012 + 0.003 * n, 0.05)
      const f = 587 * 2 ** ([0, 2, 4, 7, 9, 12][Math.max(0, Math.min(5, n - 1))] / 12)
      tone(f, 0.6, 'sine', 0.025, 0.08, undefined, [6, 6])
      tone(f * 1.5, 0.5, 'sine', 0.012, 0.12)
      if (n >= 4) {
        noise(0.9, 0.05, 260, 'lowpass', 0.1)
        ;[1047, 1319, 1568, 2093].forEach((x, i) => tone(x, 0.7, 'sine', 0.012, 0.2 + i * 0.06, undefined, [6, 7]))
      }
    },
  }
})()
