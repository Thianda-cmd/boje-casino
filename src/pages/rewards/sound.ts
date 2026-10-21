/* The Rewards page's sounds. They live with the page so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { gate, hold, noise, sweep, tone } from '../../lib/sound'

/* the Rewards page: the Lucky Wheel's pegs flicking the pointer (slowing as the wheel does), its landing and a prize
   fanfare that grows with the prize, and the claims: missions, the wheel unlocking, rakeback, tier bonuses */
export const rewardsSfx = (() => {
  const g = { tick: gate(24) }
  const bell = (f: number, gain: number, delay = 0, len = 0.6) => {
    tone(f, len, 'sine', gain, delay)
    tone(f * 2.76, len * 0.5, 'sine', gain * 0.35, delay)
    tone(f * 5.4, len * 0.25, 'sine', gain * 0.15, delay)
  }
  const coins = (n: number, delay = 0, gain = 0.012) => {
    for (let i = 0; i < n; i++) {
      const f = 2200 + Math.random() * 1200
      tone(f, 0.06, 'square', gain, delay + i * 0.055 + Math.random() * 0.02)
      tone(f * 1.34, 0.1, 'sine', gain * 1.2, delay + 0.02 + i * 0.055)
    }
  }
  return {
    // a peg flicks the pointer: a woody clack, a little brighter while the wheel is fast (speed 0..1)
    tick: (speed = 0.5) => {
      if (!g.tick()) return
      const k = 0.85 + Math.min(1, Math.max(0, speed)) * 0.3
      noise(0.016, 0.08, 2600 * k, 'bandpass')
      tone(1250 * k, 0.028, 'triangle', 0.026)
      tone(380 * k, 0.045, 'sine', 0.035, 0, 300 * k)
    },
    // the spin: a ratchet as the wheel is pulled back, then air rushing as it lets go
    spin: () => {
      for (let i = 0; i < 5; i++) noise(0.02, 0.06, 1900 + i * 320, 'bandpass', i * 0.04)
      sweep(0.8, 0.06, 350, 2400, 'bandpass', 1.1, 0.2)
      tone(200, 0.55, 'triangle', 0.025, 0.2, 640)
    },
    // the pointer drops into the winning slot: a soft clack and a bell
    land: () => {
      tone(170, 0.12, 'sine', 0.08, 0, 105)
      noise(0.03, 0.07, 1700, 'bandpass')
      bell(1319, 0.035, 0.06, 0.7)
    },
    // the prize, by size: a chime for a small one, an arpeggio and coins for a middling one, a sparkling run for 300,
    // and brass over a cymbal swell for 500 and the 1,000
    prize: (amount = 100) => {
      if (amount < 150) {
        ;[784, 988, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.045, i * 0.07))
        coins(3, 0.2)
        return
      }
      ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.05, i * 0.07))
      coins(amount >= 300 ? 8 : 5, 0.24)
      if (amount >= 300) [1568, 1976, 2349, 3136].forEach((f, i) => tone(f, 0.5, 'sine', 0.016, 0.34 + i * 0.06, undefined, [6, 8]))
      if (amount >= 500) {
        noise(0.7, 0.05, 6000, 'highpass', 0.3)
        ;[392, 523, 659].forEach((f, i) => hold(f, 0.14, 'sawtooth', 0.014, 0.42 + i * 0.12))
        ;[523, 659, 784, 1047].forEach((f) => hold(f, amount >= 1000 ? 1.3 : 0.8, 'sawtooth', 0.011, 0.8, f, [5, 4]))
        tone(65, 1, 'sine', 0.09, 0.8, 49)
      }
      if (amount >= 1000) {
        coins(10, 0.9, 0.011)
        ;[2093, 2637, 3136, 4186].forEach((f, i) => tone(f, 1, 'sine', 0.012, 1 + i * 0.07, undefined, [6, 9]))
      }
    },
    // a mission claimed: two bright bells and a coin
    mission: () => {
      bell(1047, 0.04)
      bell(1568, 0.04, 0.09)
      coins(2, 0.16)
    },
    // the third mission claimed: the wheel unlocks with a shimmer rising to a bright chord
    unlock: () => {
      sweep(0.55, 0.05, 600, 5200, 'bandpass', 1.6)
      ;[659, 784, 988, 1319, 1568, 1976].forEach((f, i) => tone(f, 0.18, 'triangle', 0.035, 0.08 + i * 0.05))
      ;[1319, 1661, 1976].forEach((f) => tone(f, 0.9, 'sine', 0.016, 0.42, undefined, [6, 9]))
    },
    // rakeback paid: coins trickling back, falling a little in pitch, then a soft bell
    rakeback: () => {
      for (let i = 0; i < 6; i++) {
        const f = 2900 - i * 160
        tone(f, 0.05, 'square', 0.012, i * 0.06)
        tone(f * 1.34, 0.09, 'sine', 0.014, 0.02 + i * 0.06)
      }
      bell(988, 0.03, 0.38, 0.5)
    },
    // a VIP tier's bonus: a regal brass flourish over a low drum
    tier: () => {
      tone(73, 0.5, 'sine', 0.1, 0, 55)
      ;[392, 523, 659].forEach((f, i) => hold(f, 0.13, 'sawtooth', 0.016, i * 0.11))
      ;[523, 659, 784, 1047].forEach((f) => hold(f, 0.9, 'sawtooth', 0.012, 0.36, f, [5, 4]))
      ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.8, 'sine', 0.014, 0.42 + i * 0.06, undefined, [6, 9]))
      coins(6, 0.4)
    },
    // the wheel's prize taken, or Claim all: coins poured into the purse, more for more rewards
    collect: (n = 1) => {
      tone(1568, 0.06, 'square', 0.03)
      tone(2093, 0.12, 'square', 0.03, 0.06)
      coins(Math.min(12, 3 + n * 2), 0.1)
    },
  }
})()
