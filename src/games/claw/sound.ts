/* Lucky Claw's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, gate, hold, noise, out, reverseCymbal, sweep, tone } from '../../lib/sound'

/* lucky claw: the cabinet's motors and clunks, plush squeaks and the prize fanfares */
export const clawSfx = (() => {
  const g = { squeak: gate(70), thud: gate(60), slip: gate(80), hop: gate(90) }
  /** a held machine noise from now until the returned function is called: a tone through a lowpass with a wobble */
  const drone = (f: number, type: OscillatorType, cut: number, gain: number, wobble: [number, number], noiseGain = 0) => {
    const a = ac()
    if (!a) return () => {}
    const t = a.currentTime
    const o = a.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f * 0.8, t)
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12)
    const lfo = a.createOscillator()
    const depth = a.createGain()
    lfo.frequency.value = wobble[0]
    depth.gain.value = wobble[1]
    lfo.connect(depth).connect(o.frequency)
    const lp = a.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = cut
    const v = a.createGain()
    v.gain.setValueAtTime(0, t)
    v.gain.linearRampToValueAtTime(gain, t + 0.06)
    o.connect(lp).connect(v).connect(out(a))
    let hiss: AudioBufferSourceNode | null = null
    if (noiseGain > 0) {
      const len = Math.floor(a.sampleRate * 1)
      const buf = a.createBuffer(1, len, a.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      hiss = a.createBufferSource()
      hiss.buffer = buf
      hiss.loop = true
      const bp = a.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = cut * 2.4
      bp.Q.value = 1.2
      const ng = a.createGain()
      ng.gain.value = noiseGain
      hiss.connect(bp).connect(ng).connect(v)
      hiss.start(t)
    }
    o.start(t)
    lfo.start(t)
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      const n = a.currentTime
      v.gain.cancelScheduledValues(n)
      v.gain.setValueAtTime(v.gain.value, n)
      v.gain.linearRampToValueAtTime(0, n + 0.09)
      o.frequency.cancelScheduledValues(n)
      o.frequency.setValueAtTime(o.frequency.value, n)
      o.frequency.exponentialRampToValueAtTime(f * 0.7, n + 0.09)
      o.stop(n + 0.1)
      lfo.stop(n + 0.1)
      hiss?.stop(n + 0.1)
    }
  }
  return {
    // the coin drops in: a bright clink, a little roll and a thunk in the box
    coin: () => {
      tone(2093, 0.07, 'square', 0.022)
      tone(2637, 0.12, 'square', 0.02, 0.05)
      for (let i = 0; i < 4; i++) noise(0.02, 0.04 - i * 0.007, 3200, 'bandpass', 0.12 + i * 0.045)
      tone(150, 0.12, 'sine', 0.06, 0.33, 90)
      noise(0.05, 0.05, 700, 'lowpass', 0.33)
    },
    // the big plastic button: a hollow tock
    button: () => {
      tone(760, 0.05, 'triangle', 0.05, 0, 380)
      noise(0.03, 0.05, 1800, 'bandpass')
    },
    // the gantry motor while the carriage moves; returns its off switch
    motor: (rate = 1) => drone(96 * rate, 'sawtooth', 520 * rate, 0.035, [13, 3], 0.012),
    // the carriage stops: a small mechanical knock
    stop: () => {
      tone(150, 0.08, 'sine', 0.05, 0, 90)
      noise(0.04, 0.05, 500, 'lowpass')
    },
    // the winch paying out (down) or winding in; returns its off switch
    winch: (down = true) => drone(down ? 210 : 250, 'triangle', down ? 900 : 1100, 0.022, [22, down ? 6 : 9], 0.006),
    // the prongs snap shut: a metal clunk with a ring
    clunk: () => {
      tone(190, 0.1, 'square', 0.03, 0, 95)
      noise(0.05, 0.08, 2600, 'bandpass')
      tone(1250, 0.18, 'triangle', 0.022, 0.01, 1180)
      tone(1870, 0.12, 'sine', 0.012, 0.01)
    },
    // a plush squeaker, k times the usual pitch
    squeak: (k = 1) => {
      if (!g.squeak()) return
      tone(1100 * k, 0.14, 'triangle', 0.028, 0, 1500 * k, [20, 40 * k])
      tone(1150 * k, 0.14, 'sine', 0.022, 0, 1560 * k, [20, 40 * k])
      noise(0.04, 0.02, 3500, 'bandpass', 0.02)
    },
    // felt sliding against metal
    slip: () => {
      if (!g.slip()) return
      sweep(0.22, 0.06, 3400, 900, 'bandpass', 1.6)
      tone(520, 0.2, 'triangle', 0.012, 0.02, 300)
    },
    // a plushie lands (size 0-1): a soft felt thump
    thud: (size = 1) => {
      if (!g.thud()) return
      noise(0.12 + size * 0.08, 0.1 + size * 0.1, 320, 'lowpass')
      tone(120, 0.14, 'sine', 0.05 + size * 0.05, 0, 62)
    },
    // a plushie hops: a cartoon boing
    hop: () => {
      if (!g.hop()) return
      tone(300, 0.2, 'sine', 0.05, 0, 760, [14, 30])
      tone(600, 0.12, 'triangle', 0.015, 0.02, 1100)
    },
    // it lands on the chute's rim: a hollow plastic bonk
    rim: () => {
      tone(540, 0.12, 'triangle', 0.06, 0, 380)
      noise(0.05, 0.08, 1800, 'bandpass')
      tone(260, 0.2, 'sine', 0.04, 0.02, 200)
    },
    // something falls through the air
    whoosh: () => {
      sweep(0.35, 0.05, 600, 2600, 'bandpass', 0.9)
      tone(800, 0.3, 'sine', 0.014, 0, 260)
    },
    // the prize door swings up: a clack and a springy wobble
    flap: () => {
      noise(0.05, 0.12, 1500, 'bandpass')
      tone(260, 0.1, 'square', 0.025, 0, 170)
      tone(330, 0.35, 'sine', 0.035, 0.05, 300, [16, 30])
    },
    // the win, scaled by the prize: a ding for the small ones up to a full fanfare with sparkles for the top ones
    fanfare: (mult = 2) => {
      const tier = mult >= 50 ? 3 : mult >= 10 ? 2 : mult >= 3 ? 1 : 0
      if (tier === 0) {
        ;[784, 988, 1175].forEach((f, i) => tone(f, 0.18, 'triangle', 0.05, i * 0.07))
        tone(1568, 0.4, 'sine', 0.025, 0.22, undefined, [6, 8])
        return
      }
      ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, i * 0.08))
      ;[1047, 1319, 1568].forEach((f) => tone(f, 0.55, 'triangle', 0.028, 0.32))
      if (tier >= 2) {
        ;[392, 523, 659].forEach((f, i) => hold(f, 0.12, 'sawtooth', 0.016, i * 0.1))
        hold(784, 0.6, 'sawtooth', 0.018, 0.3, 784, [5, 5])
        ;[2093, 2637, 3136, 2637, 3136, 4186].forEach((f, i) => tone(f, 0.12, 'sine', 0.016, 0.55 + i * 0.06))
      }
      if (tier >= 3) {
        reverseCymbal(0.5, 0.05)
        ;[523, 659, 784, 1047, 1319].forEach((f, i) => hold(f, i === 4 ? 1.1 : 0.14, 'sawtooth', 0.014, 0.6 + i * 0.1, f, [5, 4]))
        ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 1.2, 'sine', 0.014, 1.0 + i * 0.05, undefined, [6, 9]))
        noise(0.9, 0.05, 6000, 'highpass', 1.0)
      }
    },
    // the shown-off plushie bows out: a sparkly pop
    poof: () => {
      noise(0.08, 0.1, 3000, 'highpass')
      tone(880, 0.16, 'sine', 0.04, 0, 1760)
      ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.1, 'sine', 0.014, 0.05 + i * 0.04))
    },
    // a new plushie falls in to fill the spot
    restock: () => {
      tone(1400, 0.45, 'sine', 0.02, 0, 500)
      sweep(0.4, 0.03, 2400, 700, 'bandpass', 1.4)
    },
    // the claw came up empty: a soft "aww"
    aww: () => {
      tone(440, 0.26, 'triangle', 0.03, 0, 415, [5, 6])
      tone(392, 0.5, 'triangle', 0.03, 0.24, 330, [5, 9])
    },
  }
})()
