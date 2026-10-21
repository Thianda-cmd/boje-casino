/* Duck Derby's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, gate, hold, nasal, noise, out, sweep, swell, tone } from '../../lib/sound'

/** each duck's voice, by lane: Sir Waddles low, Nugget a squeaky little thing */
const DUCK_VOICE = [1, 1.1, 0.8, 1.18, 1.04, 1.36]
const derbyGate = { quack: gate(90), splash: gate(70) }

/* duck derby */
export const derbySfx = {
  // a duck's quack, in its own voice (lane 0-5): a short "qua" and a longer falling "ack"
  quack: (lane = 0) => {
    if (!derbyGate.quack()) return
    const k = DUCK_VOICE[lane] ?? 1
    const f = 470 * k * (0.96 + Math.random() * 0.08)
    nasal(f, 0.075, 0.07, 0, f * 0.86, 1500 * Math.sqrt(k))
    nasal(f * 0.97, 0.15, 0.08, 0.072, f * 0.6, 1200 * Math.sqrt(k))
    noise(0.03, 0.03, 2400, 'bandpass', 0.07)
  },
  // a bet goes on the slip: a rubber duck squeezed
  squeeze: () => {
    tone(1250, 0.11, 'triangle', 0.035, 0, 1750, [26, 55])
    tone(1300, 0.11, 'sine', 0.03, 0, 1800, [26, 55])
    noise(0.05, 0.025, 3800, 'bandpass', 0.02)
  },
  // and comes off it: the squeak let go
  release: () => tone(1500, 0.1, 'triangle', 0.03, 0, 900, [22, 40]),
  // the countdown pips: two short ones, then the horn
  pip: () => {
    tone(784, 0.12, 'square', 0.022)
    tone(1568, 0.1, 'sine', 0.014)
  },
  // the starting horn: a brassy chord held, bending up into the note
  horn: () => {
    ;[233, 294, 349, 466].forEach((f, i) => hold(f * 0.94, 0.95, 'sawtooth', i === 3 ? 0.012 : 0.022, 0, f, [5, 2]))
    hold(117, 0.95, 'square', 0.02, 0, 117)
    noise(0.12, 0.05, 1200, 'bandpass')
  },
  // the river under the race; returns a function that fades it out
  river: () => {
    const a = ac()
    if (!a) return () => {}
    const t = a.currentTime
    const len = Math.floor(a.sampleRate * 2)
    const buf = a.createBuffer(1, len, a.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = a.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = a.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 650
    const bp = a.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1900
    bp.Q.value = 1.6
    const g = a.createGain()
    const g2 = a.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.05, t + 0.8)
    g2.gain.value = 0.012
    // a slow wobble on the bright layer: water rushing past
    const lfo = a.createOscillator()
    const depth = a.createGain()
    lfo.frequency.value = 0.35
    depth.gain.value = 700
    lfo.connect(depth).connect(bp.frequency)
    src.connect(lp).connect(g).connect(out(a))
    src.connect(bp).connect(g2).connect(g)
    src.start(t)
    lfo.start(t)
    // bubbles now and then
    const timer = setInterval(() => {
      if (Math.random() < 0.6) tone(260 + Math.random() * 380, 0.09, 'sine', 0.018, Math.random() * 0.2, 520 + Math.random() * 500)
    }, 380)
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      const n = a.currentTime
      g.gain.cancelScheduledValues(n)
      g.gain.setValueAtTime(g.gain.value, n)
      g.gain.linearRampToValueAtTime(0, n + 0.6)
      src.stop(n + 0.65)
      lfo.stop(n + 0.65)
    }
  },
  // a splash (size 0-1): a slap on the water and a blub
  splash: (size = 1) => {
    if (!derbyGate.splash()) return
    noise(0.22 + size * 0.15, 0.1 + size * 0.08, 1400, 'lowpass')
    noise(0.12, 0.05 * size, 4200, 'highpass', 0.02)
    tone(210 + Math.random() * 60, 0.16, 'sine', 0.05 * size, 0.03, 95)
  },
  // straight into the log: a hollow wooden thunk, a cartoon boing and birds tweeting round a dizzy head
  bonk: () => {
    tone(240, 0.14, 'sine', 0.13, 0, 120)
    noise(0.05, 0.14, 650, 'lowpass')
    tone(330, 0.42, 'sine', 0.05, 0.05, 640, [11, 40])
    ;[2300, 2600, 2300].forEach((f, i) => tone(f, 0.06, 'sine', 0.018, 0.32 + i * 0.11, f * 1.15))
  },
  // the whirlpool: a swirling sweep and a dizzy falling whistle
  whirl: () => {
    sweep(1.3, 0.05, 320, 1800, 'bandpass', 3)
    sweep(1.1, 0.04, 1800, 380, 'bandpass', 3, 0.55)
    tone(950, 1.3, 'sine', 0.022, 0.05, 320, [6, 50])
  },
  // a wave picks a duck up: a whoosh and a rising "wheee"
  wave: () => {
    sweep(0.7, 0.07, 400, 3200, 'bandpass', 0.8)
    noise(0.5, 0.035, 5000, 'highpass', 0.15)
    tone(520, 0.55, 'triangle', 0.022, 0.05, 1250, [7, 14])
  },
  // the waterfall: a roar and a falling whistle
  falls: () => {
    swell(1.6, 0.09, 'lowpass', 700, 0.7, 0.15)
    sweep(1.2, 0.04, 2200, 500, 'bandpass', 1.2, 0.05)
    tone(880, 0.6, 'triangle', 0.024, 0, 220)
  },
  // white water
  rapids: () => {
    for (let i = 0; i < 7; i++) noise(0.2, 0.05, 1300 + Math.random() * 1600, 'bandpass', i * 0.16 + Math.random() * 0.05)
  },
  // the crowd (level 0-1) for `dur` seconds: layered voices, a few whoops and a whistle
  crowd: (level = 1, dur = 3) => {
    swell(dur, 0.045 * level, 'bandpass', 750, 0.8, 0.5)
    swell(dur, 0.03 * level, 'bandpass', 1500, 0.9, 0.4)
    swell(dur * 0.85, 0.016 * level, 'bandpass', 2900, 1.2, 0.3)
    for (let i = 0; i < Math.round(3 + level * 5); i++) {
      const d = Math.random() * dur * 0.7
      const f = 380 + Math.random() * 320
      tone(f, 0.45, 'triangle', 0.01 * level, d, f * 1.5, [5, 8])
    }
    if (level > 0.7) {
      tone(2300, 0.18, 'sine', 0.02, 0.3, 3100)
      tone(3100, 0.3, 'sine', 0.02, 0.5, 2200)
    }
  },
  // the finish-line camera: a shutter and the flash charging back up
  shutter: () => {
    noise(0.02, 0.16, 3200, 'highpass')
    noise(0.03, 0.1, 1300, 'bandpass', 0.045)
    tone(2800, 0.45, 'sine', 0.008, 0.08, 6200)
  },
  // the result for the player: a fanfare when the slip pays (bigger for a big win)
  fanfare: (big = false) => {
    ;[392, 523, 659].forEach((f, i) => hold(f, 0.12, 'sawtooth', 0.016, i * 0.11))
    hold(784, 0.5, 'sawtooth', 0.018, 0.33, 784, [5, 5])
    ;[523, 659, 784].forEach((f) => tone(f, 0.6, 'triangle', 0.03, 0.33))
    if (big) {
      ;[1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.5, 'sine', 0.02, 0.7 + i * 0.08, undefined, [6, 8]))
      hold(1047, 0.7, 'sawtooth', 0.01, 0.7, 1047, [5, 5])
    }
  },
  // nothing came in: a soft cartoon "wah-wah"
  lose: () => {
    tone(392, 0.28, 'triangle', 0.035, 0, 370, [5, 6])
    tone(349, 0.5, 'triangle', 0.035, 0.3, 311, [5, 9])
  },
}
