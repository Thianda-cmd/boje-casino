/* Live Blackjack's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { noise, tone } from '../../lib/sound'

/* live blackjack table */
export const tableSfx = {
  turn: () => {
    tone(784, 0.16, 'sine', 0.07)
    tone(1175, 0.28, 'sine', 0.06, 0.13)
  },
  // a riffle: a quick run of soft card snaps
  shuffle: () => {
    for (let i = 0; i < 14; i++) noise(0.035, 0.05, 1800 + (i % 3) * 500, 'bandpass', i * 0.045 + Math.random() * 0.012)
    noise(0.12, 0.06, 900, 'lowpass', 0.68)
  },
  flip: () => {
    noise(0.07, 0.08, 2200, 'bandpass')
    tone(660, 0.09, 'triangle', 0.035, 0.03, 880)
  },
  pop: () => tone(520, 0.09, 'sine', 0.05, 0, 980),
  chipsSlide: () => {
    noise(0.22, 0.05, 1400, 'bandpass')
    ;[2600, 3100, 2850].forEach((f, i) => tone(f, 0.03, 'square', 0.014, 0.08 + i * 0.06))
  },
}
