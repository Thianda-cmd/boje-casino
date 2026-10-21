/* Robo Riot's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { compressorBus, crackle, gate, hold, noise, reverseCymbal, sweep, tone, viaBus } from '../../lib/sound'

/* Robo Riot's recipes (sfx.robo) play through a compressor of their own, like Pop Party's, because a Power Grid can
   stack bolts, latch clamps and coin pings by the dozen. */
const roboOut = compressorBus({ threshold: -16, knee: 10, ratio: 5, attack: 0.002, release: 0.18, trim: 0.7 })
const viaRoboBus = <T extends Record<string, (...args: never) => unknown>>(group: T): T => viaBus(roboOut, group)

const roboGate = { vac: gate(45), beep: gate(60), cell: gate(40), zap: gate(40), plus: gate(35), ping: gate(30), clamp: gate(30), tick: gate(28), collect: gate(30) }

/* robo riot */
export const roboSfx = viaRoboBus({
  // Volt's lever: a ratchet run as it swings down, then a heavy clunk
  lever: () => {
    for (let i = 0; i < 4; i++) noise(0.018, 0.07, 2400 + i * 350, 'bandpass', i * 0.03)
    tone(92, 0.22, 'sine', 0.15, 0.12, 46)
    noise(0.08, 0.16, 520, 'lowpass', 0.12)
    tone(1180, 0.05, 'square', 0.012, 0.13)
  },
  // a tube sucks its robots up and out of the top: air rushing upwards, a little higher per tube
  vacuum: (col = 0) => {
    if (!roboGate.vac()) return
    const k = 2 ** (col / 12)
    sweep(0.3, 0.05, 420 * k, 3600 * k, 'bandpass', 1.8)
  },
  // a column lands in its tube: a metal clunk, a step higher per tube
  land: (col = 0) => {
    const k = 2 ** ((col * 2) / 12)
    tone(150 * k, 0.12, 'sine', 0.1, 0, 72 * k)
    noise(0.05, 0.08, 1500 + col * 200, 'bandpass')
    tone(660 * k, 0.05, 'triangle', 0.02, 0.012)
  },
  // the robots' screen faces blink on: a tiny two-note boop
  beep: (col = 0) => {
    if (!roboGate.beep()) return
    const f = [988, 1175, 1319, 1480, 1760][col % 5]
    tone(f, 0.045, 'square', 0.014)
    tone(f * 1.5, 0.06, 'square', 0.012, 0.05)
  },
  // a power cell comes to rest: an electric ping that climbs with each one in the spin
  cell: (n = 1) => {
    if (!roboGate.cell()) return
    const k = 2 ** (((Math.min(n, 9) - 1) * 2) / 12)
    tone(587 * k, 0.16, 'triangle', 0.05)
    tone(1174 * k, 0.22, 'sine', 0.035, 0.035, undefined, [14, 12])
    crackle(0.06, 0.05)
  },
  // a tube holds back: a rising charge hum with a pulse on top
  tease: () => {
    hold(98, 1.3, 'sawtooth', 0.016, 0, 196, [9, 5])
    tone(196, 1.3, 'square', 0.008, 0, 392)
    for (let i = 0; i < 3; i++) tone(1568, 0.06, 'square', 0.012, 0.3 + i * 0.36)
  },
  // charging up: a rising whine with a fizz (Volt's Power Surge, a boost bot's dish, the payout); k scales its length
  charge: (k = 1) => {
    tone(180, 0.5 * k, 'sawtooth', 0.022, 0, 1500, [28, 18])
    sweep(0.5 * k, 0.05, 500, 5000, 'bandpass', 3)
  },
  // one lightning bolt: a crack, a sizzle and a falling zing, higher for each bolt in a row
  zap: (i = 0) => {
    if (!roboGate.zap()) return
    noise(0.03, 0.2, 2600, 'highpass')
    tone(110, 0.08, 'square', 0.04, 0, 55)
    crackle(0.16, 0.08, 0.01)
    tone(2200 * 2 ** (Math.min(i, 12) / 12), 0.12, 'sawtooth', 0.014, 0, 420)
  },
  // a zap bot winds up its coil
  coil: () => {
    tone(220, 0.36, 'sawtooth', 0.02, 0, 880, [40, 30])
    crackle(0.36, 0.05)
  },
  // a boost bot's shockwave: a deep thump and a wave of air
  boost: () => {
    tone(72, 0.34, 'sine', 0.18, 0, 38)
    noise(0.1, 0.12, 400, 'lowpass')
    sweep(0.45, 0.06, 260, 2600, 'bandpass', 1.2)
    tone(392, 0.3, 'triangle', 0.025, 0.02, 784)
  },
  // the shockwave passes a cell: a soft rising blip
  plus: (i = 0) => {
    if (!roboGate.plus()) return
    const f = 784 * 2 ** (Math.min(i, 16) / 16)
    tone(f, 0.07, 'sine', 0.03, 0, f * 1.4)
  },
  // a magnet bot pulls: a pulsing electric hum
  magnet: () => {
    hold(110, 0.9, 'sawtooth', 0.016, 0, 147, [11, 9])
    hold(220, 0.9, 'triangle', 0.014, 0, 294, [11, 14])
  },
  // a coin rides in on a field line: a bright ping, higher each time
  ping: (i = 0) => {
    if (!roboGate.ping()) return
    const f = 1319 * 2 ** (Math.min(i, 24) / 24)
    tone(f, 0.07, 'square', 0.012)
    tone(f * 1.5, 0.1, 'sine', 0.02, 0.03)
  },
  // a magnet lands its haul: a ka-ching
  cash: () => {
    noise(0.05, 0.08, 4000, 'highpass')
    ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.18, 'triangle', 0.03, i * 0.05))
  },
  // a socket's latches bite: a mechanical clack with a spark
  clamp: () => {
    if (!roboGate.clamp()) return
    noise(0.03, 0.15, 2000, 'bandpass')
    tone(260, 0.06, 'square', 0.022, 0, 130)
    tone(3100, 0.03, 'sine', 0.012, 0.025)
  },
  // an empty socket shuts: a dry little tick
  tick: () => {
    if (!roboGate.tick()) return
    tone(1700 + Math.random() * 300, 0.025, 'square', 0.008)
  },
  // the empty sockets start spinning: a servo whir
  respin: () => {
    tone(260, 0.42, 'sawtooth', 0.012, 0, 560, [45, 12])
    noise(0.4, 0.035, 1600, 'bandpass')
  },
  // Volt moves: his arm servos whine up and settle
  servo: () => {
    tone(330, 0.16, 'square', 0.009, 0, 620, [60, 14])
    tone(620, 0.12, 'square', 0.008, 0.17, 420, [60, 10])
  },
  // red alert: a boom and a two-tone klaxon as the Power Grid switches on
  alarm: () => {
    tone(70, 0.5, 'sine', 0.14, 0, 40)
    for (let i = 0; i < 4; i++) hold(i % 2 ? 622 : 831, 0.2, 'square', 0.022, 0.05 + i * 0.22, i % 2 ? 831 : 622)
  },
  // the power cells flare for the Power Grid: a power-up arpeggio
  trigger: () => {
    ;[392, 523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.14, 'square', 0.026, i * 0.05))
    sweep(0.5, 0.06, 800, 6000, 'bandpass', 2)
    tone(1568, 0.6, 'sine', 0.03, 0.3, undefined, [6, 10])
  },
  // the Power Grid banner: a synth fanfare
  intro: () => {
    ;[523, 659, 784].forEach((f, i) => hold(f, 0.1, 'sawtooth', 0.02, i * 0.12))
    hold(1046, 0.55, 'sawtooth', 0.02, 0.4, undefined, [5, 6])
    ;[1046, 1319, 1568].forEach((f) => tone(f, 0.8, 'triangle', 0.025, 0.4))
    noise(0.5, 0.06, 6000, 'highpass', 0.38)
  },
  // something landed and the respins are back to three: a power-up chord
  reset: () => {
    sweep(0.25, 0.05, 600, 4000, 'bandpass', 2)
    ;[523, 784, 1046].forEach((f, i) => tone(f, 0.16, 'square', 0.02, i * 0.04))
    ;[1046, 1319, 1568].forEach((f) => tone(f, 0.45, 'triangle', 0.022, 0.14))
  },
  // a gold bot locks in or fires again: a shimmering bell run
  gold: () => {
    ;[1319, 1661, 1976, 2637].forEach((f, i) => tone(f, 0.3, 'sine', 0.03, i * 0.05, undefined, [7, 12]))
    tone(659, 0.4, 'triangle', 0.03)
  },
  // the last respin: a slow double heartbeat
  heartbeat: () => {
    tone(64, 0.14, 'sine', 0.11, 0, 42)
    tone(64, 0.14, 'sine', 0.1, 0.2, 42)
  },
  // a Full Grid and the max win: a brassy synth fanfare over a cymbal swell
  fanfare: () => {
    reverseCymbal(0.3, 0.1)
    ;[523, 659, 784, 1046].forEach((f, i) => hold(f, 0.11, 'sawtooth', 0.02, 0.3 + i * 0.09))
    ;[1046, 1319, 1568, 2093].forEach((f) => hold(f, 0.7, 'sawtooth', 0.012, 0.66, undefined, [5, 6]))
    ;[523, 784].forEach((f) => tone(f, 0.9, 'triangle', 0.035, 0.66))
    tone(65, 0.5, 'sine', 0.14, 0.3, 40)
  },
  // a payout orb reaches the total: a chime that climbs a half step every second orb
  collect: (i = 0) => {
    if (!roboGate.collect()) return
    const f = 880 * 2 ** (Math.min(i, 24) / 24)
    tone(f, 0.08, 'triangle', 0.035)
    tone(f * 2, 0.1, 'sine', 0.015, 0.02)
  },
  // a way win: a synth chime, longer for bigger wins (size 0-2)
  win: (size = 0) => {
    const notes = size >= 2 ? [523, 659, 784, 1046, 1319] : size === 1 ? [659, 784, 1046] : [784, 1046]
    notes.forEach((f, i) => tone(f, 0.16, 'square', 0.022, i * 0.06))
    tone(notes[notes.length - 1] * 2, 0.4, 'sine', 0.02, notes.length * 0.06, undefined, [6, 10])
  },
  // a win banner passes a tier: a robotic synth stab, three semitones higher each time, and a cymbal
  tierUp: (k = 0) => {
    const s = 2 ** ((k * 3) / 12)
    ;[392, 523, 659, 784].forEach((f, i) => hold(f * s, i === 3 ? 0.4 : 0.09, 'square', 0.018, i * 0.06))
    ;[784, 1046, 1319].forEach((f) => tone(f * s, 0.5, 'triangle', 0.022, 0.24))
    noise(0.45, 0.07, 6000, 'highpass', 0.24)
  },
  // back to the base game: a falling power-down
  powerDown: () => {
    tone(880, 0.5, 'sawtooth', 0.012, 0, 110)
    sweep(0.5, 0.04, 3000, 300, 'bandpass', 2)
  },
  // Volt's voice: chirpy robot syllables
  voice: (mood: 'happy' | 'sad' | 'wow' | 'alert' = 'happy') => {
    const syl: [number, number, number, number][] =
      mood === 'happy'
        ? [[660, 990, 0, 0.09], [880, 1320, 0.11, 0.12]]
        : mood === 'sad'
          ? [[520, 400, 0, 0.18], [440, 260, 0.2, 0.32]]
          : mood === 'wow'
            ? [[440, 1320, 0, 0.26]]
            : [[880, 880, 0, 0.08], [660, 660, 0.1, 0.08], [880, 880, 0.2, 0.08]]
    for (const [f0, f1, t, d] of syl) {
      hold(f0, d, 'square', 0.014, t, f1, [32, 18])
      tone(f0 * 2, d, 'sine', 0.012, t, f1 * 2)
    }
  },
})
