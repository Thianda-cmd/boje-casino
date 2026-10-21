/* Pop Party's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { sfx, compressorBus, hold, noise, reverseCymbal, slam, squeak, sweep, tone, viaBus } from '../../lib/sound'

let lastPop = 0
/** A balloon bursting: a hiss, a chirp that falls from higher up the scale the longer the chain (n), a rubber tick. */
function balloonPop(n: number) {
  const now = performance.now()
  if (now - lastPop < 30) return
  lastPop = now
  const k = 2 ** (Math.min(n, 14) / 12) * (0.97 + Math.random() * 0.06)
  noise(0.06, 0.2, 2800, 'highpass')
  tone(900 * k, 0.07, 'sine', 0.08, 0, 180)
  noise(0.015, 0.06, 4000, 'bandpass')
}

/** Pop Party's recipes (sfx.party) play through a compressor of their own: a long cascade of pops can stack. */
const partyOut = compressorBus({ threshold: -14, knee: 12, ratio: 4, attack: 0.003, release: 0.15, trim: 0.65 })
const viaPartyBus = <T extends Record<string, (...args: never) => unknown>>(group: T): T => viaBus(partyOut, group)

/* pop party */
export const partySfx = viaPartyBus({
  pop: (n = 0) => balloonPop(n),
  squeak: () => squeak(1),
  boop: (col = 0) => tone(330 * 2 ** (col / 12), 0.08, 'sine', 0.06, 0, 220),
  stretch: () => {
    tone(300, 0.12, 'sawtooth', 0.015, 0, 900)
    noise(0.1, 0.03, 1200, 'bandpass')
  },
  // air rushing in, and the rubber's note rising as the new balloons fill
  inflate: () => {
    sweep(0.26, 0.2, 380, 1700, 'bandpass', 1.4)
    tone(250, 0.24, 'triangle', 0.02, 0.02, 520)
  },
  // each stroke of the pump sits a whole tone higher as the balloon fills
  pumpBreath: (i = 0) => {
    const k = 2 ** ((Math.min(i, 4) * 2) / 12)
    noise(0.15, 0.09, 1200 * k, 'bandpass')
    tone(220 * k, 0.15, 'sine', 0.02, 0, 260 * k)
  },
  tileLit: () => {
    tone(1568, 0.12, 'sine', 0.025)
    tone(2093, 0.12, 'sine', 0.025)
  },
  // one pentatonic step per level (2 is ×2, 8 is ×128); maxing a tile adds a five-note run on top
  tileUp: (level = 2) => {
    const f = [1047, 1175, 1319, 1568, 1760, 2093, 2349][Math.max(0, Math.min(6, level - 2))]
    tone(f, 0.2, 'triangle', 0.05)
    tone(f * 2, 0.24, 'sine', 0.02)
    if (level >= 8) [1047, 1319, 1568, 2093, 2637].forEach((g, i) => tone(g, 0.16, 'triangle', 0.03, 0.08 + i * 0.05))
  },
  orb: (i = 0) => tone(600, 0.1, 'sine', 0.04, 0, 900 * 2 ** (Math.min(i, 12) / 12)),
  slam: () => slam(1, 0),
  superPop: () => {
    reverseCymbal(0.35, 0.12)
    sweep(0.4, 0.1, 2000, 300, 'bandpass', 1, 0.35)
    slam(0.5, 0.35)
  },
  lightsOff: (i = 0) => tone(880 * 2 ** ((-Math.min(i, 12) * 2) / 12), 0.03, 'square', 0.02),
  disco: (n = 0) => {
    const k = 2 ** (Math.min(n, 6) / 12)
    ;[2637, 3136, 3520].forEach((f) => tone(f * k, 0.3, 'sine', 0.02, 0, undefined, [9, 20]))
    noise(0.02, 0.05, 6000, 'highpass')
  },
  tease: () => {
    sfx.tease()
    for (let i = 0; i < 3; i++) tone(150, 0.2, 'sine', 0.08, i * 0.5, 45)
  },
  scratch: () => {
    sweep(0.12, 0.08, 800, 2400)
    sweep(0.12, 0.08, 2400, 700, 'bandpass', 1, 0.12)
    tone(300, 0.12, 'square', 0.015, 0, 900)
    tone(900, 0.12, 'square', 0.015, 0.12, 300)
  },
  // three blasts of a detuned saw chord: short, short, long
  airhorn: () => [0, 0.17, 0.34].forEach((t, i) => [466, 470, 699].forEach((f) => hold(f, i < 2 ? 0.12 : 0.45, 'sawtooth', 0.03, t))),
  pinThrow: () => {
    noise(0.08, 0.08, 3500, 'highpass')
    tone(1400, 0.12, 'sine', 0.03, 0, 500)
  },
  pinHit: (n = 0) => {
    balloonPop(n)
    tone(1800 * 2 ** (Math.min(n, 12) / 12), 0.04, 'sine', 0.02)
  },
  beatDrop: () => {
    tone(150, 0.25, 'sine', 0.14, 0, 45)
    noise(0.6, 0.12, 5000, 'highpass')
    ;[523, 659, 784].forEach((f) => tone(f, 0.3, 'sawtooth', 0.03))
  },
  kick: () => tone(140, 0.14, 'sine', 0.05, 0, 50),
  hat: () => noise(0.03, 0.025, 8000, 'highpass'),
  heartbeat: () => {
    tone(70, 0.12, 'sine', 0.09, 0, 45)
    tone(70, 0.12, 'sine', 0.09, 0.18, 45)
  },
  confettiCannon: () => {
    noise(0.12, 0.18, 300, 'lowpass')
    for (let i = 0; i < 4; i++) noise(0.02, 0.07, 4000, 'highpass', 0.04 + i * 0.03)
  },
  partyHorn: () => hold(466, 0.6, 'square', 0.03, 0, 494, [6, 14]),
  tierUp: (k = 0) => {
    ;[523, 659, 784, 1046].forEach((f, i) => tone(f * 2 ** ((k * 2) / 12), 0.14, 'square', 0.03, i * 0.06))
    noise(0.4, 0.1, 5000, 'highpass')
  },
  glassPop: () => {
    noise(0.12, 0.3, 2000, 'highpass')
    tone(120, 0.16, 'sine', 0.12, 0, 40)
    squeak(2)
  },
  cheer: () => {
    tone(392, 0.12, 'triangle', 0.035, 0, 523, [8, 10])
    tone(523, 0.12, 'triangle', 0.035, 0.12, 784, [8, 10])
  },
  yawn: () => hold(500, 0.6, 'sine', 0.03, 0, 250),
})
