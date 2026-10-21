/* Baccarat's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { noise, sweep, tone } from '../../lib/sound'

/* baccarat */
export const baccaratSfx = {
  // a card leaves the shoe: a short slide across the felt and a soft landing
  deal: () => {
    sweep(0.16, 0.05, 1400, 3200, 'bandpass', 1.4)
    noise(0.04, 0.05, 800, 'lowpass', 0.15)
  },
  // a face-down card turned straight over
  flip: () => {
    noise(0.06, 0.07, 2400, 'bandpass')
    noise(0.03, 0.04, 700, 'lowpass', 0.06)
  },
  // the squeeze: card stock bending slowly under the thumb, a quiet rising tension
  squeeze: () => {
    sweep(1.05, 0.024, 420, 1500, 'bandpass', 2.2)
    tone(196, 1.05, 'sine', 0.014, 0, 262)
    tone(392, 0.9, 'sine', 0.006, 0.15, 523)
  },
  // the peeled card shows its face: a crisp snap of the card settling and a small bell
  reveal: () => {
    noise(0.05, 0.09, 2800, 'bandpass')
    noise(0.04, 0.05, 600, 'lowpass', 0.02)
    tone(1175, 0.22, 'sine', 0.022, 0.02)
  },
  // a chip set down on the layout: a clay clack
  chip: () => {
    noise(0.025, 0.11, 3400, 'bandpass')
    tone(2350, 0.035, 'triangle', 0.018)
    tone(1650, 0.05, 'sine', 0.02, 0.018)
  },
  // the dealer rakes in the losing chips
  collect: () => {
    sweep(0.36, 0.045, 2600, 900, 'bandpass', 1.2)
    ;[2900, 2500].forEach((f, i) => tone(f, 0.03, 'square', 0.01, 0.12 + i * 0.09))
  },
  // winnings slide in beside a stake: a run of chip clicks
  pay: () => {
    noise(0.2, 0.04, 1600, 'bandpass')
    ;[2700, 3150, 2900, 3300].forEach((f, i) => tone(f, 0.03, 'square', 0.012, 0.06 + i * 0.055))
  },
  // a new shoe: a long riffle, then the cards squared up
  shuffle: () => {
    for (let i = 0; i < 20; i++) noise(0.03, 0.045, 1500 + (i % 4) * 450, 'bandpass', 0.15 + i * 0.045 + Math.random() * 0.012)
    noise(0.1, 0.07, 700, 'lowpass', 1.2)
    noise(0.08, 0.05, 900, 'lowpass', 1.32)
  },
  // the result, softly: a rising pair for Player, a falling pair for Banker, a little triad for a Tie
  announce: (winner: 'P' | 'B' | 'T') => {
    const notes = winner === 'P' ? [659, 988] : winner === 'B' ? [880, 659] : [784, 988, 1175]
    notes.forEach((f, i) => tone(f, 0.32, 'sine', 0.035, i * 0.1))
    tone(notes[notes.length - 1] * 2, 0.5, 'sine', 0.008, notes.length * 0.1)
  },
}
