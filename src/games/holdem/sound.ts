/* Hold'em Showdown's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { gate, hold, noise, reverseCymbal, sweep, tone } from '../../lib/sound'

/* hold'em showdown: cards sliding out of the shoe and turning over (the dealer's reveal a deeper snap with a breath
   of tension), chips set down and pushed out for the Play bet, the check's two knuckle knocks on the felt, a fold's
   swish, the dealer's rake and payout, stings for the verdict by size, a fanfare for a big hand that wins (the
   royal's the grandest), and a chime for one only Trips paid on */
export const holdemSfx = (() => {
  const g = { deal: gate(40), flip: gate(35), chip: gate(30), count: gate(60) }
  /** a soft bell: a sine with two faint partials */
  const bell = (f: number, gain: number, delay = 0, len = 0.5) => {
    tone(f, len, 'sine', gain, delay)
    tone(f * 2.76, len * 0.45, 'sine', gain * 0.3, delay)
  }
  return {
    // a card leaves the shoe: a short slide across the felt and a soft landing (quieter for the board's cards)
    deal: (soft = false) => {
      if (!g.deal()) return
      sweep(0.15, soft ? 0.03 : 0.05, 1400, 3200, 'bandpass', 1.4)
      noise(0.04, soft ? 0.03 : 0.05, 800, 'lowpass', 0.14)
    },
    // a card turned over: a crisp snap of card stock
    flip: () => {
      if (!g.flip()) return
      noise(0.05, 0.08, 2600, 'bandpass')
      noise(0.03, 0.045, 700, 'lowpass', 0.05)
    },
    // the dealer turns over: a breath of tension, a deeper snap and a small bell
    reveal: () => {
      sweep(0.32, 0.025, 500, 1600, 'bandpass', 2)
      noise(0.06, 0.1, 2200, 'bandpass', 0.28)
      tone(110, 0.18, 'sine', 0.05, 0.28, 80)
      bell(988, 0.02, 0.32, 0.4)
    },
    // a chip set in a circle: a clay clack
    chip: () => {
      if (!g.chip()) return
      noise(0.025, 0.11, 3400, 'bandpass')
      tone(2350, 0.035, 'triangle', 0.018)
      tone(1650, 0.05, 'sine', 0.02, 0.018)
    },
    // a chip taken back off
    remove: () => {
      noise(0.03, 0.06, 2100, 'bandpass')
      tone(1450, 0.07, 'sine', 0.016, 0, 1000)
    },
    // the Play bet pushed out: chips sliding, then a clack for each of the multiple (4×: four)
    bet: (k: number) => {
      sweep(0.22, 0.04, 900, 2600, 'bandpass', 1.1)
      for (let i = 0; i < Math.max(1, Math.min(4, k)); i++) {
        noise(0.022, 0.09, 3200 + i * 120, 'bandpass', 0.16 + i * 0.06)
        tone(2200 + i * 90, 0.03, 'triangle', 0.014, 0.16 + i * 0.06)
      }
    },
    // a check: two knuckle knocks on the felt
    check: () => {
      for (let i = 0; i < 2; i++) {
        tone(150, 0.09, 'sine', 0.09, i * 0.13, 95)
        noise(0.035, 0.07, 520, 'lowpass', i * 0.13)
      }
    },
    // a fold: the cards pushed away face down
    fold: () => {
      sweep(0.3, 0.04, 2200, 700, 'bandpass', 0.9)
      noise(0.05, 0.03, 600, 'lowpass', 0.24)
    },
    // a chip or a move the table won't take
    nope: () => tone(233, 0.1, 'triangle', 0.045, 0, 165),
    // the dealer rakes in the losing chips
    sweep: () => {
      sweep(0.36, 0.045, 2600, 900, 'bandpass', 1.2)
      ;[2900, 2500].forEach((f, i) => tone(f, 0.03, 'square', 0.01, 0.12 + i * 0.09))
    },
    // winnings slide in beside the stakes: a run of chip clicks
    pay: () => {
      noise(0.2, 0.04, 1600, 'bandpass')
      ;[2700, 3150, 2900, 3300].forEach((f, i) => tone(f, 0.03, 'square', 0.012, 0.06 + i * 0.055))
    },
    // the verdict: a win by size (0 a small one, 1 a good one, 2 a big one), a push, a loss
    win: (size: number) => {
      const notes = size >= 2 ? [523, 659, 784, 1047, 1319] : size >= 1 ? [587, 740, 880, 1175] : [659, 831, 988]
      notes.forEach((f, i) => tone(f, 0.24, 'triangle', 0.05, i * 0.07))
      bell(notes[notes.length - 1] * 2, 0.012, notes.length * 0.07, 0.6)
      if (size >= 2) notes.slice(0, 4).forEach((f) => hold(f, 0.9, 'triangle', 0.012, 0.4, undefined, [5, 3]))
    },
    push: () => {
      bell(784, 0.03)
      bell(784, 0.026, 0.14)
    },
    lose: () => {
      ;[523, 440, 349].forEach((f, i) => tone(f, 0.26, 'sine', 0.04, i * 0.12))
      tone(98, 0.5, 'sine', 0.05, 0.3, 70)
    },
    // a big hand (flush and up): a brass flourish; a royal flush gets the cymbal swell and the full chord
    bigHand: (royal: boolean) => {
      const lead = royal ? 0.6 : 0
      if (royal) reverseCymbal(0.6, 0.05)
      ;[392, 523, 659, 784, 1047].forEach((f, i) => hold(f, 0.13, 'sawtooth', 0.013, lead + i * 0.08))
      ;[523, 659, 784, 1047].forEach((f) => hold(f, royal ? 1.6 : 0.9, 'sawtooth', 0.01, lead + 0.42, f, [5, 4]))
      ;[1568, 2093, 2637].forEach((f, i) => tone(f, 1, 'sine', 0.012, lead + 0.46 + i * 0.07, undefined, [6, 8]))
      tone(65, 1.2, 'sine', royal ? 0.12 : 0.07, lead + 0.4, 49)
    },
    // the royal's win counted up
    count: () => {
      if (!g.count()) return
      tone(1500 + Math.random() * 400, 0.04, 'square', 0.01)
    },
    // Trips paid on a big hand that didn't win the rest: a bright little three-bell rise, no brass
    trips: () => {
      ;[1047, 1319, 1568].forEach((f, i) => bell(f, 0.026, i * 0.09, 0.45))
      tone(3136, 0.5, 'sine', 0.008, 0.3, undefined, [6, 8])
    },
    // a hand picked up where it was left
    welcome: () => {
      bell(784, 0.03)
      bell(1175, 0.025, 0.1)
    },
  }
})()
