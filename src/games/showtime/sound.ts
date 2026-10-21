/* Showtime's sounds. They live with the game so they load with it, not with every page; the synth they play on, and
   the sounds every page shares, are in src/lib/sound.ts. */
import { gate, hold, noise, reverseCymbal, sweep, swell, tone } from '../../lib/sound'

export const showtimeSfx = {
  // a chip lands on a spot: a clack with a note that climbs from the 1 to Mega Spin
  chip: (i = 0) => {
    const f = [523, 587, 659, 784, 880, 988, 1047, 1175][i] ?? 659
    noise(0.025, 0.09, 3200, 'bandpass')
    tone(f, 0.07, 'triangle', 0.05, 0, f * 1.25)
  },
  // the Booster's reels start: a rising mechanical whirr
  boostStart: () => {
    sweep(0.5, 0.04, 400, 2400, 'bandpass', 1.4)
    tone(220, 0.3, 'square', 0.012, 0, 440)
  },
  // a reel symbol clicks past
  reel: (() => {
    const pass = gate(40)
    return () => {
      if (!pass()) return
      tone(1400, 0.02, 'square', 0.012)
      noise(0.01, 0.02, 5000, 'highpass')
    }
  })(),
  // a reel stops: a clunk
  reelStop: (n = 0) => {
    noise(0.04, 0.07, 900, 'lowpass')
    tone(330 + n * 110, 0.1, 'triangle', 0.05)
  },
  // the Booster lights a spot: a bright chord that grows with the multiplier; a miss is a soft two-note fall
  boost: (mult = 0) => {
    if (!mult) {
      tone(523, 0.12, 'triangle', 0.03)
      tone(392, 0.2, 'triangle', 0.03, 0.1)
      return
    }
    const big = mult >= 10
    ;[784, 988, 1175].forEach((f, i) => tone(f, 0.2, 'triangle', 0.045, i * 0.05))
    sweep(0.4, 0.04, 1200, 6000, 'bandpass', 2, 0.05)
    if (big) [1568, 1976, 2349].forEach((f, i) => tone(f, 0.5, 'sine', 0.02, 0.2 + i * 0.06, undefined, [6, 9]))
  },
  // the wheel is pushed off: a heave and a whoosh
  spin: () => {
    sweep(0.9, 0.05, 200, 2400, 'bandpass', 0.8)
    tone(90, 0.4, 'sine', 0.08, 0, 140)
  },
  // a peg of the wheel slaps the flapper (speed 0-1); gated so a fast wheel never stacks them
  tick: (() => {
    const pass = gate(28)
    return (speed = 0) => {
      if (!pass()) return
      const s = Math.max(0, Math.min(1, speed))
      tone(900 + 700 * s, 0.025, 'triangle', 0.035 - s * 0.015)
      noise(0.012, 0.03 - s * 0.012, 2600, 'bandpass')
    }
  })(),
  // the wheel stops on a number: a thunk and a chime; on a bonus round, a drumroll into a fanfare
  land: (bonus = false) => {
    noise(0.05, 0.08, 700, 'lowpass')
    tone(150, 0.14, 'sine', 0.08, 0, 90)
    if (!bonus) {
      tone(784, 0.2, 'triangle', 0.05, 0.05)
      tone(1175, 0.3, 'sine', 0.024, 0.12)
      return
    }
    for (let i = 0; i < 14; i++) noise(0.04, 0.03 + i * 0.003, 240, 'lowpass', 0.05 + i * 0.045)
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'square', 0.022, 0.72 + i * 0.09))
    hold(1047, 0.9, 'sawtooth', 0.016, 1.08)
    sweep(1.2, 0.03, 600, 5200, 'bandpass', 1.4, 0.72)
  },
  // into a bonus round: a cymbal swells up to the reveal
  bonusIn: () => {
    reverseCymbal(0.9, 0.05)
    swell(0.9, 0.03, 'bandpass', 1800, 1.2, 0.8)
  },
  // a pick or choice is made
  choose: () => {
    tone(988, 0.08, 'triangle', 0.05)
    tone(1319, 0.14, 'triangle', 0.04, 0.06)
  },
  // the countdown's last seconds
  count: (n = 3) => tone(n > 1 ? 880 : 1175, 0.07, 'triangle', 0.034),
  // the coin goes up, spinning; it lands
  toss: () => {
    sweep(0.5, 0.05, 900, 4200, 'bandpass', 2)
    for (let i = 0; i < 8; i++) tone(2200 + (i % 2) * 400, 0.03, 'sine', 0.012, i * 0.09)
  },
  coinLand: () => {
    tone(1568, 0.5, 'sine', 0.05, 0, undefined, [8, 12])
    tone(2093, 0.4, 'sine', 0.03, 0.02)
    noise(0.03, 0.06, 6000, 'highpass')
  },
  // the puck hits a peg (pitch 0-1 down the board)
  peg: (() => {
    const pass = gate(30)
    return (k = 0) => {
      if (!pass()) return
      tone(1800 - k * 900, 0.04, 'sine', 0.035)
      noise(0.01, 0.02, 4000, 'bandpass')
    }
  })(),
  // a DOUBLE or TRIPLE: a rising siren with sparkle
  double: () => {
    sweep(0.7, 0.05, 300, 3000, 'bandpass', 3)
    ;[659, 880, 1175, 1568].forEach((f, i) => tone(f, 0.18, 'square', 0.024, 0.1 + i * 0.07))
  },
  // a prize is shot on the wall; the rest flip over
  shot: () => {
    noise(0.08, 0.12, 2400, 'bandpass')
    tone(180, 0.18, 'sine', 0.09, 0, 70)
  },
  flip: (() => {
    const pass = gate(18)
    return () => {
      if (!pass()) return
      tone(2400, 0.02, 'triangle', 0.012)
    }
  })(),
  // a result is revealed: a chime that brightens with how much it pays
  reveal: (mult = 1) => {
    const k = Math.min(1, Math.log10(Math.max(1, mult)) / 3)
    const f = 660 + 600 * k
    ;[f, f * 1.25, f * 1.5].forEach((x, i) => tone(x, 0.3, 'triangle', 0.045, i * 0.06))
    if (mult >= 100) sweep(0.8, 0.04, 1000, 7000, 'bandpass', 2, 0.15)
  },
  // a bet is paid: coins, with a bigger fanfare for a big win
  win: (big = false) => {
    ;[1047, 1319, 1568].forEach((f, i) => tone(f, 0.14, 'triangle', 0.045, i * 0.07))
    noise(0.06, 0.04, 6000, 'highpass', 0.05)
    if (big) [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.6, 'sine', 0.02, 0.25 + i * 0.08, undefined, [6, 9]))
  },
  // nothing won
  lose: () => {
    tone(392, 0.16, 'triangle', 0.03)
    tone(311, 0.26, 'triangle', 0.03, 0.12)
  },
}
