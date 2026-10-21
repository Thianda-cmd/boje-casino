/* Lucky Lines' sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, gate, noiseThrough, osc } from '../../lib/sound'

/* lucky lines: the reels' whirr and wooden stops (a shimmer rising under a teased one), the dauber's stamp (higher
   the fuller its line), a chime run for a line and a brassy step up the ladder, the jester's bells for a Joker
   (golden ones for a Super Joker), a torn ticket for a free spin, a coin for a bought spin, coins for the collect
   and the big wins by tier. Its own compressor, like Pop Party's, so five stops, daubs and a chime at once never
   clip; the voices here are local so nothing else is routed through it. */
export const linesSfx = (() => {
  let bus: AudioNode | null = null
  const linesOut = (a: AudioContext) => {
    if (!bus) {
      const c = a.createDynamicsCompressor()
      c.threshold.value = -15
      c.knee.value = 10
      c.ratio.value = 4
      c.attack.value = 0.003
      // opens instantly for its first moments (see the party bus), then settles to the real release
      c.release.value = 0
      c.release.setValueAtTime(0.16, a.currentTime + 0.06)
      const trim = a.createGain()
      trim.gain.value = 0.72
      c.connect(trim).connect(a.destination)
      bus = c
    }
    return bus
  }
  /** a note: quick attack, exponential fall over `dur` */
  const v = (f: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number, vib?: [number, number]) => {
    const a = ac()
    if (!a) return
    const t = a.currentTime + delay
    const o = osc(a, t, f, dur, type, slideTo, vib)
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(linesOut(a))
  }
  /** a burst of filtered noise, falling away */
  const n = (dur: number, gain: number, freq: number, kind: BiquadFilterType = 'lowpass', delay = 0, q = 1) => {
    const a = ac()
    if (!a) return
    const len = Math.max(1, Math.floor(a.sampleRate * dur))
    const buf = a.createBuffer(1, len, a.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
    const src = a.createBufferSource()
    src.buffer = buf
    const fl = a.createBiquadFilter()
    fl.type = kind
    fl.frequency.value = freq
    fl.Q.value = q
    const g = a.createGain()
    g.gain.value = gain
    src.connect(fl).connect(g).connect(linesOut(a))
    src.start(a.currentTime + delay)
  }
  /** noise whose filter glides from f0 to f1 (a whirr, a tear, a whoosh); `up` swells to the end and stops dead */
  const sw = (dur: number, gain: number, f0: number, f1: number, kind: BiquadFilterType = 'bandpass', q = 1, delay = 0, up = false) => {
    const a = ac()
    if (!a) return
    const t = a.currentTime + delay
    const fl = noiseThrough(a, t, dur + 0.02, kind, f0, q)
    fl.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    if (up) {
      g.gain.exponentialRampToValueAtTime(gain, t + dur)
      g.gain.linearRampToValueAtTime(0, t + dur + 0.02)
    } else {
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.2)
      g.gain.linearRampToValueAtTime(0, t + dur)
    }
    fl.connect(g).connect(linesOut(a))
  }
  /** a little bell: the strike and its bright partials */
  const bell = (f: number, gain: number, delay = 0, len = 0.5) => {
    v(f, len, 'sine', gain, delay)
    v(f * 2.76, len * 0.5, 'sine', gain * 0.4, delay)
    v(f * 5.4, len * 0.25, 'sine', gain * 0.18, delay)
  }
  const ping = (f: number, gain: number, delay: number) => {
    v(f, 0.1, 'square', gain * 0.45, delay)
    v(f * 1.5, 0.2, 'sine', gain, delay + 0.035)
  }
  /** a brass-ish held note */
  const horn = (f: number, dur: number, gain: number, delay = 0) => {
    v(f, dur, 'sawtooth', gain, delay, undefined, [5, 3])
    v(f * 1.004, dur, 'sawtooth', gain * 0.6, delay)
    v(f * 2, Math.min(dur, 0.3), 'triangle', gain * 0.7, delay)
  }
  const gt = { stop: gate(25), daub: gate(30), count: gate(40), line: gate(80) }
  // C major pentatonic, rising: the stamps and the chimes climb it as the card fills
  const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093]
  const note = (i: number) => PENTA[Math.max(0, Math.min(PENTA.length - 1, i))]
  return {
    // the reels kick off: a whirr rising under a soft clatter
    spin: (quick = false) => {
      sw(quick ? 0.3 : 0.45, 0.05, 300, 1800, 'bandpass', 1.2)
      v(140, quick ? 0.25 : 0.4, 'sawtooth', 0.012, 0, 260)
      for (let i = 0; i < 4; i++) n(0.02, 0.04, 2500, 'bandpass', i * 0.05, 2)
    },
    // reel i stops: a wooden clunk, a little higher reel by reel
    stop: (i = 0) => {
      if (!gt.stop()) return
      const k = 2 ** ((i * 2) / 12)
      v(170 * k, 0.09, 'sine', 0.09, 0, 95 * k)
      n(0.04, 0.09, 1400 * k, 'bandpass', 0, 1.5)
      v(880 * k, 0.05, 'triangle', 0.02)
    },
    // a reel that could finish a line crawls to its stop: a shimmer rising
    tease: () => {
      v(392, 0.75, 'triangle', 0.025, 0, 784, [9, 6])
      v(588, 0.75, 'sine', 0.012, 0, 1176, [9, 9])
      sw(0.75, 0.025, 1500, 5000, 'bandpass', 2)
    },
    // the dauber's stamp: a wet thump and a pop, higher the fuller its fullest line (1-5); a joker's rings a bell too
    daub: (fill = 1, joker = false) => {
      if (!gt.daub()) return
      const f = note((fill - 1) * 2)
      v(150, 0.1, 'sine', 0.12, 0, 70)
      n(0.07, 0.12, 900, 'lowpass')
      n(0.03, 0.05, 3500, 'bandpass', 0.005, 2)
      v(f, 0.16, 'triangle', 0.05, 0.01, f * 1.02)
      v(f * 2, 0.1, 'sine', 0.018, 0.01)
      if (joker) bell(f * 1.5, 0.03, 0.04, 0.4)
    },
    // `fresh` lines finished at once (`total` on the card): a chime run, longer for more, higher as lines add up
    line: (fresh = 1, total = 1) => {
      if (!gt.line()) return
      const base = Math.min(4, total - 1)
      const notes = 3 + Math.min(3, fresh)
      for (let i = 0; i < notes; i++) v(note(base + i), 0.3, 'triangle', 0.045, i * 0.055)
      bell(note(base + notes), 0.03, notes * 0.055, 0.8)
      n(0.4, 0.02, 7000, 'highpass', 0.05)
    },
    // the ladder steps up (to step s, 0-9): a brassy pair, higher each step
    step: (s = 0) => {
      const f = 261.63 * 2 ** ((Math.min(9, s) * 2) / 12)
      horn(f, 0.12, 0.016)
      horn(f * 1.5, 0.34, 0.018, 0.09)
    },
    // a Joker lands: the jester's bells jingle over a springy boing
    joker: () => {
      for (let i = 0; i < 6; i++) bell(2400 + (i % 3) * 300 + Math.random() * 80, 0.016, i * 0.045, 0.22)
      v(260, 0.25, 'sine', 0.05, 0.02, 620, [14, 25])
    },
    // a Super Joker: golden bells climbing, a sweep and a sparkle
    superJoker: () => {
      ;[784, 988, 1175, 1568, 1976].forEach((f, i) => bell(f, 0.028, i * 0.06, 0.6))
      sw(0.5, 0.03, 1200, 7000, 'bandpass', 1.5)
      for (let i = 0; i < 6; i++) v(3000 + i * 400, 0.08, 'sine', 0.012, 0.3 + i * 0.04)
    },
    // a joker sent to its number: a cheeky slide whistle (the stamp follows as it lands)
    placed: () => v(500, 0.16, 'sine', 0.035, 0, 1100),
    // a free spin: a ticket torn off and a happy two-note ding
    free: () => {
      sw(0.16, 0.06, 2500, 800, 'bandpass', 1.4)
      v(1047, 0.16, 'triangle', 0.05, 0.1)
      v(1568, 0.35, 'triangle', 0.05, 0.2)
      bell(2093, 0.02, 0.2, 0.5)
    },
    // a fresh card is dealt: a paper flick and a riffle
    deal: () => {
      n(0.06, 0.07, 3000, 'bandpass', 0, 1.2)
      for (let i = 0; i < 5; i++) n(0.025, 0.035, 2200 + i * 300, 'bandpass', 0.05 + i * 0.03, 1.5)
    },
    // an extra spin bought: a coin into the slot
    buy: () => {
      v(2093, 0.06, 'square', 0.02)
      v(2637, 0.12, 'square', 0.018, 0.05)
      v(160, 0.1, 'sine', 0.05, 0.16, 90)
    },
    // collected, under a big win: a little fanfare and coins into the purse
    collect: (mult = 1) => {
      ;[784, 988, 1175, 1568].forEach((f, i) => v(f, 0.18, 'triangle', 0.04, i * 0.07))
      const k = Math.min(10, 3 + Math.round(mult * 2))
      for (let i = 0; i < k; i++) ping(1800 + Math.random() * 900, 0.02, 0.25 + i * 0.05)
    },
    // collected with nothing: a soft "aww"
    over: () => {
      v(440, 0.24, 'triangle', 0.03, 0, 415, [5, 6])
      v(370, 0.45, 'triangle', 0.03, 0.22, 330, [5, 9])
    },
    // a game picked up again: a soft rising chime
    welcome: () => [659, 880, 1175].forEach((f, i) => v(f, 0.25, 'sine', 0.03, i * 0.08)),
    // the big win's amount rolling up
    count: () => {
      if (!gt.count()) return
      v(1400 + Math.random() * 300, 0.04, 'square', 0.012)
    },
    // the big wins: Big (1), Mega (2), the full card (3)
    bigWin: (tier = 1) => {
      ;[523, 659, 784, 1047].forEach((f, i) => v(f, 0.16, 'triangle', 0.055, i * 0.08))
      ;[1047, 1319, 1568].forEach((f) => v(f, 0.8, 'triangle', 0.03, 0.34))
      for (let i = 0; i < 8; i++) ping(2000 + Math.random() * 1200, 0.016, 0.4 + i * 0.06)
      if (tier >= 2) {
        ;[392, 523, 659].forEach((f, i) => horn(f, 0.12, 0.014, i * 0.1))
        horn(784, 0.7, 0.016, 0.32)
        ;[2093, 2637, 3136, 2637, 3136, 4186].forEach((f, i) => v(f, 0.12, 'sine', 0.016, 0.6 + i * 0.06))
      }
      if (tier >= 3) {
        sw(0.6, 0.05, 3000, 9000, 'highpass', 0.7, 0, true)
        ;[523, 659, 784, 1047, 1319].forEach((f, i) => horn(f, i === 4 ? 1.4 : 0.14, 0.013, 0.7 + i * 0.1))
        ;[1568, 2093, 2637, 3136].forEach((f, i) => v(f, 1.4, 'sine', 0.014, 1.1 + i * 0.05, undefined, [6, 9]))
        v(65, 1.4, 'sine', 0.12, 0.7, 49)
        n(1.0, 0.04, 6000, 'highpass', 1.1)
      }
    },
  }
})()
