import { safeStorage } from './storage'

// Tiny WebAudio synth: no audio files, so the bundle stays small and mobile-friendly.
let ctx: AudioContext | null = null
let muted = safeStorage.getItem('lumen.muted') === '1'

export const isMuted = () => muted
export function setMuted(m: boolean) {
  muted = m
  safeStorage.setItem('lumen.muted', m ? '1' : '0')
}

function ac(): AudioContext | null {
  if (muted) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

// Pop Party's recipes play through their own compressor, so a long cascade of pops can stack without clipping. Every
// other sound still goes straight to the speakers: `out` hands out the compressor only while a party recipe runs.
let partyDepth = 0
let partyBus: AudioNode | null = null

function out(a: AudioContext): AudioNode {
  if (!partyDepth) return a.destination
  if (!partyBus) {
    const c = a.createDynamicsCompressor()
    c.threshold.value = -14
    c.knee.value = 12
    c.ratio.value = 4
    c.attack.value = 0.003
    // a new compressor starts fully clamped and opens at the release rate, which would swallow the first party
    // sounds; it releases instantly for its first moments, then settles to the real release
    c.release.value = 0
    c.release.setValueAtTime(0.15, a.currentTime + 0.06)
    // it also adds 3.7 dB of makeup gain on its own; trim that back so quiet party sounds sit level with the shared
    // ones the game also plays (coin, win)
    const trim = a.createGain()
    trim.gain.value = 0.65
    c.connect(trim).connect(a.destination)
    partyBus = c
  }
  return partyBus
}

/** An oscillator started at t, optionally sliding to `slideTo` over `dur` and wobbling by `vib` = [rate, depth] Hz. */
function osc(a: AudioContext, t: number, freq: number, dur: number, type: OscillatorType, slideTo?: number, vib?: [number, number]) {
  const o = a.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  if (vib) {
    const lfo = a.createOscillator()
    const depth = a.createGain()
    lfo.frequency.value = vib[0]
    depth.gain.value = vib[1]
    lfo.connect(depth).connect(o.frequency)
    lfo.start(t)
    lfo.stop(t + dur + 0.02)
  }
  o.start(t)
  o.stop(t + dur + 0.02)
  return o
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0, slideTo?: number, vib?: [number, number]) {
  const a = ac()
  if (!a) return
  const t = a.currentTime + delay
  const o = osc(a, t, freq, dur, type, slideTo, vib)
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(out(a))
}

function noise(dur: number, gain = 0.15, freq = 900, kind: BiquadFilterType = 'lowpass', delay = 0) {
  const a = ac()
  if (!a) return
  const len = Math.floor(a.sampleRate * dur)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
  const src = a.createBufferSource()
  const g = a.createGain()
  const f = a.createBiquadFilter()
  f.type = kind
  f.frequency.value = freq
  g.gain.value = gain
  src.buffer = buf
  src.connect(f).connect(g).connect(out(a))
  src.start(a.currentTime + delay)
}

/* voices and shared pieces of the Pop Party recipes (sfx.party) */

/** Like tone(), but held at full level until a short release, the way a horn plays. */
function hold(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number, vib?: [number, number]) {
  const a = ac()
  if (!a) return
  const t = a.currentTime + delay
  const o = osc(a, t, freq, dur, type, slideTo, vib)
  const g = a.createGain()
  const release = Math.min(0.12, dur * 0.3)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.02)
  g.gain.setValueAtTime(gain, t + dur - release)
  g.gain.linearRampToValueAtTime(0, t + dur)
  o.connect(g).connect(out(a))
}

/** Steady white noise from t for `dur` seconds through a filter, which is returned for the caller to shape. */
function noiseThrough(a: AudioContext, t: number, dur: number, kind: BiquadFilterType, freq: number, q = 1) {
  const len = Math.floor(a.sampleRate * dur)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  const f = a.createBiquadFilter()
  f.type = kind
  f.frequency.setValueAtTime(freq, t)
  f.Q.value = q
  src.buffer = buf
  src.connect(f)
  src.start(t)
  return f
}

/** Noise whose filter glides from f0 to f1 Hz: air rushing in, a record scratch, a whoosh. */
function sweep(dur: number, gain: number, f0: number, f1: number, kind: BiquadFilterType = 'bandpass', q = 1, delay = 0) {
  const a = ac()
  if (!a) return
  const t = a.currentTime + delay
  const f = noiseThrough(a, t, dur, kind, f0, q)
  f.frequency.exponentialRampToValueAtTime(f1, t + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.2)
  g.gain.linearRampToValueAtTime(0, t + dur)
  f.connect(g).connect(out(a))
}

/** Highpass noise that swells up and stops dead: a cymbal played backwards. */
function reverseCymbal(dur: number, gain: number) {
  const a = ac()
  if (!a) return
  const t = a.currentTime
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + dur)
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02)
  noiseThrough(a, t, dur + 0.02, 'highpass', 5000).connect(g).connect(out(a))
}

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

/** A twisted-balloon squeak, k times the normal pitch. */
function squeak(k: number) {
  tone(1300 * k, 0.12, 'triangle', 0.025, 0, 1600 * k, [18, 30 * k])
  tone(1340 * k, 0.12, 'triangle', 0.025, 0, 1600 * k, [18, 30 * k])
}

/** The multiplier landing: a low thump, a thud and a bright chord, scaled in pitch by k. */
function slam(k: number, delay: number) {
  tone(98 * k, 0.18, 'sine', 0.1, delay, 49 * k)
  noise(0.1, 0.12, 600 * k, 'lowpass', delay)
  ;[784, 988, 1175].forEach((f) => tone(f * k, 0.25, 'triangle', 0.035, delay))
}

/** Wraps a group of recipes so every voice they start plays through the party compressor. */
function viaPartyBus<T extends Record<string, (...args: never) => void>>(group: T): T {
  const routed: Record<string, (...args: never) => void> = {}
  for (const [name, play] of Object.entries(group))
    routed[name] = (...args) => {
      partyDepth++
      try {
        play(...args)
      } finally {
        partyDepth--
      }
    }
  return routed as T
}

export const sfx = {
  click: () => tone(520, 0.05, 'triangle', 0.04),
  bet: () => tone(330, 0.08, 'triangle', 0.06, 0, 440),
  tick: () => tone(1200, 0.03, 'square', 0.015),
  peg: () => tone(900 + Math.random() * 500, 0.04, 'sine', 0.025),
  step: () => {
    tone(420, 0.07, 'triangle', 0.06, 0, 640)
  },
  card: () => noise(0.05, 0.06),
  gem: () => {
    tone(880, 0.09, 'sine', 0.06)
    tone(1320, 0.12, 'sine', 0.05, 0.05)
  },
  win: () => {
    tone(523, 0.12, 'triangle', 0.07)
    tone(659, 0.12, 'triangle', 0.07, 0.08)
    tone(784, 0.2, 'triangle', 0.07, 0.16)
  },
  bigWin: () => {
    ;[523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.07))
  },
  lose: () => {
    noise(0.35, 0.22)
    tone(180, 0.35, 'sawtooth', 0.05, 0, 60)
  },
  pin: (n = 0) => {
    tone(1900 + n * 140, 0.03, 'square', 0.035)
    tone(640, 0.06, 'triangle', 0.06)
  },
  vault: () => {
    noise(0.22, 0.25)
    tone(120, 0.32, 'sawtooth', 0.06, 0, 55)
    ;[392, 523, 659, 784].forEach((f, i) => tone(f, 0.2, 'triangle', 0.06, 0.25 + i * 0.07))
  },
  alarm: () => {
    for (let i = 0; i < 4; i++) tone(i % 2 ? 620 : 880, 0.22, 'sawtooth', 0.045, i * 0.24, i % 2 ? 880 : 620)
  },
  reel: () => {
    tone(150, 0.07, 'square', 0.025)
    noise(0.05, 0.05)
  },
  spinStart: () => tone(260, 0.18, 'triangle', 0.04, 0, 520),
  coin: () => {
    tone(1568, 0.06, 'square', 0.03)
    tone(2093, 0.12, 'square', 0.03, 0.06)
  },
  /* slots */
  drop: (heavy = false) => {
    tone(heavy ? 92 : 128, 0.1, 'sine', heavy ? 0.1 : 0.065, 0, 52)
    noise(0.045, 0.05, 2600, 'bandpass')
    tone(2400 + Math.random() * 900, 0.035, 'sine', 0.012, 0.01)
  },
  shatter: () => {
    noise(0.3, 0.16, 3000, 'highpass')
    ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f * (0.98 + Math.random() * 0.04), 0.18, 'sine', 0.028, 0.02 + i * 0.035))
  },
  cascade: (n = 0) => {
    const f = 523.25 * 2 ** (Math.min(n, 10) * 2 / 12)
    tone(f, 0.14, 'triangle', 0.06)
    tone(f * 1.5, 0.2, 'triangle', 0.045, 0.07)
    tone(f * 2, 0.26, 'sine', 0.03, 0.14)
  },
  star: () => {
    ;[1046, 1318, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.28, 'sine', 0.04, i * 0.055))
  },
  tease: () => tone(196, 0.9, 'sawtooth', 0.02, 0, 392),
  orb: () => tone(330, 0.32, 'sawtooth', 0.022, 0, 1320),
  orbHit: (n = 0) => {
    const f = 784 * 2 ** (Math.min(n, 12) / 12)
    tone(f, 0.18, 'triangle', 0.07)
    tone(f * 2, 0.24, 'sine', 0.035, 0.04)
  },
  feature: () => {
    ;[392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.06, i * 0.09))
    ;[523, 659, 784].forEach((f) => tone(f * 2, 0.7, 'sine', 0.03, 0.5))
  },
  /* chompers */
  reelStop: (n = 0) => {
    tone(118 - n * 6, 0.1, 'sine', 0.08, 0, 58)
    noise(0.04, 0.05, 1700, 'bandpass')
  },
  boing: () => {
    tone(196, 0.32, 'sine', 0.08, 0, 587)
    tone(392, 0.18, 'triangle', 0.03, 0.04, 784)
  },
  eggLand: (n = 0) => {
    const f = 659 * 2 ** ((Math.min(n, 5) * 4) / 12)
    tone(f, 0.16, 'triangle', 0.07)
    tone(f * 1.5, 0.24, 'sine', 0.045, 0.06)
  },
  donutLand: () => tone(700, 0.07, 'sine', 0.045, 0, 1100),
  chomp: (n = 0) => {
    noise(0.08, 0.2, 900, 'lowpass')
    tone(150 + Math.min(n, 10) * 12, 0.08, 'square', 0.035, 0, 80)
    noise(0.05, 0.1, 2600, 'bandpass')
    tone(880 * 2 ** (Math.min(n, 12) / 12), 0.14, 'triangle', 0.04, 0.05)
  },
  whoosh: () => {
    noise(0.4, 0.1, 1100, 'bandpass')
    tone(900, 0.35, 'sine', 0.025, 0, 180)
  },
  hatch: () => {
    noise(0.3, 0.22, 2400, 'highpass')
    ;[523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.26, 'triangle', 0.055, 0.12 + i * 0.07))
  },
  levelUp: () => {
    ;[392, 494, 587, 784, 988, 1175].forEach((f, i) => tone(f, 0.24, 'square', 0.03, i * 0.06))
    tone(1568, 0.6, 'sine', 0.035, 0.4)
  },
  /* pop party */
  party: viaPartyBus({
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
  }),
  /* live blackjack table */
  table: {
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
  },
}
