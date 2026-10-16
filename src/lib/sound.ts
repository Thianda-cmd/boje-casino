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
  if (roboDepth) return roboOut(a)
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

/* Robo Riot's recipes (sfx.robo) play through a compressor of their own, like Pop Party's, because a Power Grid can
   stack bolts, latch clamps and coin pings by the dozen. Like `partyDepth`, `roboDepth` is only non-zero while a
   robo recipe runs, so nothing else is routed through it. */
let roboDepth = 0
let roboBus: AudioNode | null = null

function roboOut(a: AudioContext): AudioNode {
  if (!roboBus) {
    const c = a.createDynamicsCompressor()
    c.threshold.value = -16
    c.knee.value = 10
    c.ratio.value = 5
    c.attack.value = 0.002
    // opens instantly for its first moments (see the party bus), then settles to the real release
    c.release.value = 0
    c.release.setValueAtTime(0.18, a.currentTime + 0.06)
    const trim = a.createGain()
    trim.gain.value = 0.7
    c.connect(trim).connect(a.destination)
    roboBus = c
  }
  return roboBus
}

function viaRoboBus<T extends Record<string, (...args: never) => void>>(group: T): T {
  const routed: Record<string, (...args: never) => void> = {}
  for (const [name, play] of Object.entries(group))
    routed[name] = (...args) => {
      roboDepth++
      try {
        play(...args)
      } finally {
        roboDepth--
      }
    }
  return routed as T
}

/** lets a sound through at most once every `ms`: for the ones a Power Grid can fire twenty times in a blink */
function gate(ms: number) {
  let last = 0
  return () => {
    const now = performance.now()
    if (now - last < ms) return false
    last = now
    return true
  }
}
const roboGate = { vac: gate(45), beep: gate(60), cell: gate(40), zap: gate(40), plus: gate(35), ping: gate(30), clamp: gate(30), tick: gate(28), collect: gate(30) }

/** electric crackle: a scatter of tiny bright noise ticks over `dur` seconds */
function crackle(dur: number, gain: number, delay = 0) {
  const n = Math.max(3, Math.round(dur / 0.018))
  for (let i = 0; i < n; i++) noise(0.008 + Math.random() * 0.01, gain * (0.4 + Math.random() * 0.6), 2500 + Math.random() * 4500, 'bandpass', delay + (i / n) * dur + Math.random() * 0.01)
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
  spinStart: () => tone(260, 0.18, 'triangle', 0.04, 0, 520),
  coin: () => {
    tone(1568, 0.06, 'square', 0.03)
    tone(2093, 0.12, 'square', 0.03, 0.06)
  },
  tease: () => tone(196, 0.9, 'sawtooth', 0.02, 0, 392),
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
  // the bite itself (sfx.chomp(n)), with the newer Chompers moments hung off it as sfx.chomp.*: the Feast Pick, Big
  // Mama's voice, the meter, the multiplier stamps and the win tiers
  chomp: Object.assign(
    (n = 0) => {
      noise(0.08, 0.2, 900, 'lowpass')
      tone(150 + Math.min(n, 10) * 12, 0.08, 'square', 0.035, 0, 80)
      noise(0.05, 0.1, 2600, 'bandpass')
      tone(880 * 2 ** (Math.min(n, 12) / 12), 0.14, 'triangle', 0.04, 0.05)
    },
    {
      // Big Mama's three eggs rise: a rising wobble and a little chime as they settle
      rise: () => {
        sweep(0.55, 0.07, 260, 1500, 'bandpass', 1.2)
        tone(300, 0.55, 'triangle', 0.03, 0, 640, [7, 14])
        ;[784, 988, 1175].forEach((f, i) => tone(f, 0.2, 'sine', 0.03, 0.4 + i * 0.08))
      },
      // the pick's countdown: a woodblock that climbs as time runs out
      tick: (n = 0) => {
        tone(1050 * 2 ** ((Math.min(n, 4) * 2) / 12), 0.05, 'triangle', 0.04)
        noise(0.02, 0.05, 3200, 'bandpass')
      },
      // an eggshell giving way: a few crunchy snaps
      crack: () => {
        for (let i = 0; i < 4; i++) noise(0.045, 0.18 - i * 0.03, 2400 + i * 600, 'bandpass', i * 0.07)
        tone(260, 0.1, 'square', 0.02, 0, 130)
      },
      // the picked egg bursts: a thump, a sparkle run and a shimmering chord
      reveal: () => {
        noise(0.12, 0.22, 1800, 'highpass')
        tone(120, 0.22, 'sine', 0.12, 0, 50)
        ;[659, 784, 988, 1319, 1568].forEach((f, i) => tone(f, 0.2, 'triangle', 0.045, 0.05 + i * 0.05))
        ;[1319, 1661, 1976].forEach((f) => tone(f, 0.9, 'sine', 0.018, 0.32, undefined, [6, 9]))
      },
      // the eggs nobody picked: a muffled pop each, a little lower
      peek: (i = 0) => {
        noise(0.05, 0.1, 900, 'lowpass', i * 0.12)
        tone(560 - i * 70, 0.14, 'sine', 0.035, i * 0.12, 330 - i * 40)
      },
      // the modifier takes hold: a rising zap into a bright ding
      power: () => {
        sweep(0.3, 0.06, 600, 3200, 'bandpass', 2)
        tone(440, 0.28, 'square', 0.02, 0, 1320)
        tone(1760, 0.4, 'sine', 0.04, 0.26)
      },
      // +5 spins: five quick rising blips
      extra: () => [0, 2, 4, 7, 12].forEach((s, i) => tone(988 * 2 ** (s / 12), 0.09, 'square', 0.022, i * 0.06)),
      // Big Mama's voice: a big furry "mmmm", low, growly and wobbling
      grumble: () => {
        hold(98, 0.55, 'sawtooth', 0.02, 0, 78, [5, 5])
        hold(147, 0.55, 'triangle', 0.025, 0, 117, [5, 7])
        noise(0.45, 0.05, 380, 'lowpass')
      },
      // and her delighted "woo-hoo!"
      cheer: () => {
        hold(233, 0.16, 'sawtooth', 0.016, 0, 349, [7, 10])
        tone(466, 0.16, 'triangle', 0.025, 0, 698, [7, 10])
        hold(311, 0.38, 'sawtooth', 0.016, 0.17, 523, [7, 16])
        tone(622, 0.38, 'triangle', 0.025, 0.17, 1046, [7, 16])
      },
      // a hungry tummy, for Hungry Mode
      rumble: () => {
        for (let i = 0; i < 3; i++) tone(70 + i * 9, 0.22, 'sawtooth', 0.03, i * 0.17, 52 + i * 6, [11, 7])
        noise(0.55, 0.06, 260, 'lowpass')
      },
      // the collect multiplier stamped on the donuts, higher for a bigger one
      stamp: (mult = 2) => {
        const k = 2 ** ((Math.min(mult, 10) - 2) / 12)
        tone(160 * k, 0.12, 'sine', 0.1, 0, 80 * k)
        noise(0.06, 0.12, 1400, 'bandpass')
        tone(1320 * k, 0.16, 'triangle', 0.03, 0.04)
      },
      // wilds drip into the free-spins meter: one rising slime note per segment
      meter: (filled = 1) => {
        const f = [587, 698, 880, 1175][Math.max(0, Math.min(3, filled - 1))]
        tone(f * 0.5, 0.12, 'sine', 0.05, 0, f)
        tone(f, 0.2, 'triangle', 0.03, 0.06)
      },
      // the last free spin: a slow double heartbeat
      heartbeat: () => {
        tone(66, 0.14, 'sine', 0.1, 0, 44)
        tone(66, 0.14, 'sine', 0.09, 0.2, 44)
      },
      // a win banner passes a tier: a brassy stab, three semitones higher each time, and a cymbal swell
      tierUp: (k = 0) => {
        const s = 2 ** ((k * 3) / 12)
        ;[392, 494, 587, 784].forEach((f, i) => hold(f * s, i === 3 ? 0.42 : 0.12, 'sawtooth', 0.016, i * 0.07))
        ;[784, 988, 1175].forEach((f) => tone(f * s, 0.5, 'triangle', 0.025, 0.28))
        noise(0.5, 0.08, 6000, 'highpass', 0.28)
      },
    },
  ),
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
  /* robo riot */
  robo: viaRoboBus({
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
  }),
}
