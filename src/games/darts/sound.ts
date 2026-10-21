/* Bullseye's sounds. They live with the game so they load with it, not with every page; the synth they play on, and
   the sounds every page shares, are in src/lib/sound.ts.

   A dart is a whoosh off the hand, then a thud into the sisal whose voice says where it went: a dull thock for a
   single, a ring of steel for a treble or a double (the wire is close), a bright chord for the bull, and a hollow
   knock on the surround for a miss. The crowd answers the big moments: a murmur under a dart that could make the
   round, a roar for a ton, a ton-forty and the 180. */
import { gate, hold, noise, reverseCymbal, sweep, swell, tone } from '../../lib/sound'

export const dartsSfx = {
  // the darts are pulled from the board for the next round
  pluck: () => {
    noise(0.05, 0.05, 2400, 'bandpass')
    noise(0.04, 0.04, 3200, 'bandpass', 0.07)
    tone(520, 0.05, 'triangle', 0.02, 0.02, 760)
  },
  // a dart leaves the hand: a short whoosh, quicker in turbo; the slow one is the dart that could make the round
  whoosh: (slow = false) => {
    if (slow) {
      sweep(0.9, 0.05, 260, 2600, 'bandpass', 1.6)
      tone(110, 0.8, 'sine', 0.02, 0, 180)
      return
    }
    sweep(0.32, 0.045, 600, 3600, 'bandpass', 1.4)
  },
  /**
   * The dart sticks. kind: 'single', 'treble', 'double', 'outer' (the 25), 'bull' or 'miss'; the board answers in
   * its own voice for each.
   */
  thud: (kind: 'single' | 'treble' | 'double' | 'outer' | 'bull' | 'miss') => {
    if (kind === 'miss') {
      // a hollow knock on the surround
      noise(0.06, 0.1, 500, 'lowpass')
      tone(210, 0.12, 'triangle', 0.06, 0, 150)
      tone(160, 0.18, 'sine', 0.05, 0.01, 110)
      return
    }
    // the thock into the sisal
    noise(0.045, 0.16, 700, 'lowpass')
    tone(130, 0.11, 'sine', 0.12, 0, 72)
    noise(0.02, 0.05, 4200, 'bandpass')
    if (kind === 'treble' || kind === 'double') {
      // the wire close by rings
      tone(2350, 0.32, 'sine', 0.018, 0.01, undefined, [7, 14])
      tone(1568, 0.2, 'triangle', 0.035, 0.05)
      tone(kind === 'treble' ? 2093 : 1760, 0.28, 'triangle', 0.03, 0.11)
    } else if (kind === 'bull') {
      ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.32, 'triangle', 0.035, 0.04 + i * 0.05))
      sweep(0.5, 0.03, 1500, 6500, 'bandpass', 2, 0.06)
    } else if (kind === 'outer') {
      tone(1319, 0.2, 'triangle', 0.03, 0.05)
      tone(1568, 0.24, 'triangle', 0.025, 0.11)
    }
  },
  // the score of a dart goes up on the board: a tick that climbs with the dart's number
  call: (i = 0) => tone([660, 784, 988][i] ?? 784, 0.08, 'triangle', 0.035),
  // the last dart could make the round: the crowd hushes, a heartbeat under it
  tension: () => {
    swell(1.6, 0.022, 'bandpass', 700, 0.8, 0.5)
    for (let i = 0; i < 3; i++) {
      tone(62, 0.12, 'sine', 0.11, i * 0.5, 48)
      tone(58, 0.1, 'sine', 0.08, i * 0.5 + 0.17, 44)
    }
  },
  // the crowd roars: k from 0 (a ton) to 1 (the 180)
  roar: (k = 0) => {
    swell(1.4 + k * 1.6, 0.04 + k * 0.035, 'bandpass', 900 + k * 300, 0.6, 0.18)
    swell(1.1 + k * 1.2, 0.025 + k * 0.02, 'highpass', 2400, 0.7, 0.12)
    if (k >= 1) {
      reverseCymbal(0.45, 0.05)
      ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.34, 'square', 0.02, 0.45 + i * 0.08))
      hold(1047, 1.1, 'sawtooth', 0.014, 0.85)
      hold(1568, 1.1, 'triangle', 0.02, 0.85)
    }
  },
  // the round is in: a chime that brightens with what it pays (mult over the stake)
  win: (mult = 1) => {
    const k = Math.min(1, Math.log10(Math.max(1, mult)) / 2.5)
    const f = 660 + 520 * k
    ;[f, f * 1.25, f * 1.5].forEach((x, i) => tone(x, 0.26, 'triangle', 0.045, i * 0.07))
    noise(0.06, 0.04, 6000, 'highpass', 0.06)
    if (mult >= 10) [1568, 2093, 2637, 3136].forEach((x, i) => tone(x, 0.6, 'sine', 0.02, 0.28 + i * 0.08, undefined, [6, 9]))
  },
  // part of the stake back: a gentle two notes
  some: () => {
    tone(587, 0.12, 'triangle', 0.035)
    tone(740, 0.18, 'triangle', 0.03, 0.09)
  },
  // nothing back
  lose: () => {
    tone(392, 0.16, 'triangle', 0.03)
    tone(294, 0.28, 'triangle', 0.03, 0.12)
  },
  // a big win's amount counting up (p: how far, 0-1)
  count: (() => {
    const pass = gate(60)
    return (p = 0) => {
      if (!pass()) return
      tone(900 + p * 900, 0.03, 'square', 0.012)
    }
  })(),
  // the target or the thrower changes
  pick: () => {
    tone(880, 0.06, 'triangle', 0.035)
    tone(1175, 0.08, 'triangle', 0.03, 0.05)
  },
}
