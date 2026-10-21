/* Market Rush's sounds. They live with the game so they load with it, not with every page; the synth they play on,
   and the sounds every page shares, are in src/lib/sound.ts. The trading floor's palette: short electronic blips
   for the orders, a cash-register sparkle for profit, a downward buzz and a crunch for a liquidation, a low rumble
   under a rising siren when the market turns wild. */
import { crackle, gate, hold, noise, reverseCymbal, sweep, swell, tone } from '../../lib/sound'

export const marketSfx = {
  // an order goes in: a solid click and a two-note chirp, rising for Up and falling for Down
  open: (side: 'up' | 'down') => {
    noise(0.03, 0.08, 2600, 'bandpass')
    tone(160, 0.09, 'sine', 0.07, 0, side === 'up' ? 220 : 120)
    const [a, b] = side === 'up' ? [740, 1109] : [880, 587]
    tone(a, 0.07, 'square', 0.026, 0.02)
    tone(b, 0.12, 'square', 0.026, 0.08)
    tone(b * 2, 0.16, 'sine', 0.014, 0.08)
  },
  // a position closed by hand or by its target: a cash-register sparkle that brightens with the multiple; a close at
  // a loss is a soft two-note settle
  close: (mult: number) => {
    if (mult < 1) {
      noise(0.025, 0.05, 1800, 'bandpass')
      tone(523, 0.1, 'triangle', 0.035)
      tone(440, 0.16, 'triangle', 0.03, 0.08)
      return
    }
    const k = Math.min(1, Math.log10(Math.max(1, mult)) / 2)
    noise(0.04, 0.07, 6000, 'highpass')
    tone(1568, 0.06, 'square', 0.022)
    tone(2093, 0.14, 'square', 0.022, 0.06)
    ;[1047, 1319, 1568, 2093].slice(0, 2 + Math.round(k * 2)).forEach((f, i) => tone(f * (1 + k * 0.12), 0.18, 'triangle', 0.04, 0.1 + i * 0.06))
  },
  // a take profit fills: a bright little arpeggio over the register
  takeProfit: () => {
    ;[1175, 1480, 1760, 2349].forEach((f, i) => tone(f, 0.16, 'triangle', 0.035, i * 0.05))
    tone(2349, 0.5, 'sine', 0.018, 0.2, undefined, [7, 10])
  },
  // a stop loss fills: a muted, falling pair
  stopLoss: () => {
    noise(0.03, 0.06, 1200, 'lowpass')
    tone(587, 0.12, 'triangle', 0.035)
    tone(392, 0.22, 'triangle', 0.035, 0.1)
  },
  // liquidated: a downward electric buzz, a crunch and a low thump
  liquidated: () => {
    hold(330, 0.42, 'sawtooth', 0.03, 0, 70)
    tone(110, 0.32, 'square', 0.03, 0.02, 45)
    noise(0.28, 0.16, 900, 'lowpass')
    crackle(0.22, 0.05, 0.04)
    tone(60, 0.4, 'sine', 0.12, 0.05, 32)
  },
  // a position worth the cap: a fanfare
  cap: () => {
    ;[523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.3, 'square', 0.022, i * 0.07))
    hold(1568, 0.9, 'sawtooth', 0.012, 0.45)
    sweep(1, 0.03, 900, 6000, 'bandpass', 1.4, 0.3)
  },
  // a position close to its liquidation line: a quick warning beep, never more than every 0.7 s
  danger: (() => {
    const pass = gate(700)
    return () => {
      if (!pass()) return
      tone(1320, 0.05, 'square', 0.018)
      tone(1320, 0.05, 'square', 0.014, 0.09)
    }
  })(),
  // the market turns wild: a low rumble under a rising siren; it calms: a soft falling chime
  wild: () => {
    swell(1.4, 0.07, 'lowpass', 160, 0.8, 0.25)
    reverseCymbal(0.7, 0.035)
    tone(330, 0.9, 'sawtooth', 0.014, 0.1, 990, [5, 14])
    tone(60, 0.8, 'sine', 0.08, 0.05, 40)
  },
  calm: () => {
    ;[1319, 1047, 784].forEach((f, i) => tone(f, 0.4, 'sine', 0.024, i * 0.09))
  },
  steady: () => {
    tone(784, 0.18, 'triangle', 0.026)
    tone(988, 0.24, 'triangle', 0.022, 0.08)
  },
  // a big win's lettering lands, by tier
  bigWin: (tier: number) => {
    sweep(0.6, 0.05, 400, 5200, 'bandpass', 1.6)
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.26, 'square', 0.024, 0.1 + i * 0.08))
    if (tier >= 2) [1319, 1568, 2093].forEach((f, i) => tone(f, 0.5, 'sine', 0.024, 0.45 + i * 0.08, undefined, [6, 9]))
    if (tier >= 3) {
      hold(1047, 1.1, 'sawtooth', 0.014, 0.7)
      crackle(0.8, 0.03, 0.6)
    }
  },
  // the win counting up (k from 0 to 1)
  count: (k: number) => tone(900 + 900 * k, 0.03, 'triangle', 0.02),
  // an order refused (no market here, the book is full, not enough coins)
  nope: () => {
    tone(220, 0.08, 'square', 0.03)
    tone(180, 0.12, 'square', 0.03, 0.07)
  },
}
