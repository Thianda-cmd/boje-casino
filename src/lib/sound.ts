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

/* voices of the Duck Derby recipes (sfx.derby) */

/** a sawtooth through a vocal formant: the nasal part of a quack */
function nasal(f: number, dur: number, gain: number, delay: number, slideTo: number, formant: number) {
  const a = ac()
  if (!a) return
  const t = a.currentTime + delay
  const o = osc(a, t, f, dur, 'sawtooth', slideTo)
  const bp = a.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(formant, t)
  bp.frequency.exponentialRampToValueAtTime(formant * 0.8, t + dur)
  bp.Q.value = 2.4
  const lp = a.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3400
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.014)
  g.gain.setValueAtTime(gain, t + dur * 0.45)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(bp).connect(lp).connect(g).connect(out(a))
}

/** each duck's voice, by lane: Sir Waddles low, Nugget a squeaky little thing */
const DUCK_VOICE = [1, 1.1, 0.8, 1.18, 1.04, 1.36]
const derbyGate = { quack: gate(90), splash: gate(70) }

/** steady filtered noise swelling in and out over `dur`: a crowd layer, the river */
function swell(dur: number, gain: number, kind: BiquadFilterType, freq: number, q: number, attack: number, delay = 0) {
  const a = ac()
  if (!a) return
  const t = a.currentTime + delay
  const f = noiseThrough(a, t, dur, kind, freq, q)
  const g = a.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + attack)
  g.gain.setValueAtTime(gain, t + dur * 0.6)
  g.gain.linearRampToValueAtTime(0, t + dur)
  f.connect(g).connect(out(a))
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
  /* cases */
  cases: {
    // choosing a crate (tier 0-3): a knock on wood, a clink of steel, a gold ring, a low obsidian hum
    pick: (tier = 0) => {
      if (tier === 0) {
        noise(0.05, 0.12, 700, 'lowpass')
        tone(210, 0.09, 'sine', 0.07, 0, 150)
      } else if (tier === 1) {
        tone(1250, 0.12, 'triangle', 0.028)
        tone(1870, 0.2, 'sine', 0.018, 0.01)
        noise(0.02, 0.05, 4200, 'highpass')
      } else if (tier === 2) {
        tone(1047, 0.22, 'sine', 0.032)
        tone(1568, 0.32, 'sine', 0.022, 0.05)
      } else {
        tone(110, 0.38, 'sawtooth', 0.016, 0, 82, [5, 3])
        tone(220, 0.38, 'sine', 0.04, 0, 164)
        tone(1320, 0.3, 'sine', 0.012, 0.05, 990)
      }
    },
    // the latch springs and the lid lifts: a clack, a puff of air rising, and a soft shimmer from inside
    open: (tier = 0) => {
      noise(0.03, 0.14, 2600 - tier * 300, 'bandpass')
      tone(170 - tier * 16, 0.12, 'sine', 0.09, 0, 85 - tier * 8)
      sweep(0.34, 0.045, 500, 2600, 'bandpass', 1.2, 0.03)
      ;[784, 1175].forEach((f, i) => tone(f, 0.34, 'sine', 0.016, 0.08 + i * 0.05, f * 1.5))
    },
    // a tile passes the marker: a short click, bright and light while the reel races, lower and fuller as it slows
    // (speed 0-1); gated so a fast reel never stacks clicks
    tick: (() => {
      const pass = gate(26)
      return (speed = 0) => {
        if (!pass()) return
        const s = Math.max(0, Math.min(1, speed))
        const f = 620 + 980 * s ** 0.7
        tone(f, 0.035, 'triangle', 0.046 - s * 0.022)
        noise(0.012, 0.036 - s * 0.016, f * 2.2, 'bandpass')
      }
    })(),
    // the reel rests on an item: a chime that grows with its rarity (0 common to 4 legendary)
    land: (rarity = 0) => {
      if (rarity <= 0) {
        noise(0.06, 0.06, 500, 'lowpass')
        tone(392, 0.16, 'triangle', 0.05)
        tone(330, 0.24, 'sine', 0.04, 0.07)
      } else if (rarity === 1) {
        ;[659, 880].forEach((f, i) => tone(f, 0.2, 'triangle', 0.055, i * 0.08))
        tone(1760, 0.34, 'sine', 0.014, 0.16)
      } else if (rarity === 2) {
        ;[659, 831, 988].forEach((f, i) => tone(f, 0.22, 'triangle', 0.055, i * 0.07))
        ;[1319, 1661].forEach((f) => tone(f, 0.55, 'sine', 0.02, 0.22, undefined, [6, 8]))
      } else if (rarity === 3) {
        sweep(0.42, 0.045, 800, 5000, 'bandpass', 2)
        ;[587, 740, 880, 1175].forEach((f, i) => tone(f, 0.24, 'triangle', 0.052, i * 0.07))
        ;[1175, 1480, 1760].forEach((f) => tone(f, 0.85, 'sine', 0.02, 0.3, undefined, [5, 9]))
      } else {
        // legendary: a low swell under a bright fanfare and a run of bells
        tone(65, 0.7, 'sine', 0.13, 0, 41)
        noise(0.7, 0.06, 6000, 'highpass')
        ;[523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.048, i * 0.06))
        ;[1046, 1319, 1568, 2093].forEach((f) => hold(f, 1, 'sawtooth', 0.007, 0.32, undefined, [5, 6]))
        ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.6, 'sine', 0.018, 0.42 + i * 0.08, undefined, [7, 10]))
      }
    },
    // one reel of a stack comes to rest (rarity 0-4, i its place in the stack): a soft clack, pitched up the stack, with
    // a little bell for anything from rare up; gated so a stack landing together never piles up
    stop: (() => {
      const pass = gate(40)
      return (rarity = 0, i = 0) => {
        if (!pass()) return
        const k = 2 ** ((i * 2) / 12)
        noise(0.03, 0.08, 1800 * k, 'bandpass')
        tone(260 * k, 0.09, 'triangle', 0.05, 0, 190 * k)
        if (rarity >= 2) tone([0, 0, 1319, 1568, 2093][rarity] * k, 0.3, 'sine', 0.02, 0.02, undefined, [6, 8])
      }
    })(),
  },
  /* case battles */
  battles: {
    // the countdown before the first round: 3, 2, 1 as short beeps, then a bright go (n = 0)
    count: (n = 0) => {
      if (n > 0) {
        tone(660, 0.12, 'triangle', 0.06)
        tone(1320, 0.08, 'sine', 0.015)
      } else {
        tone(988, 0.22, 'triangle', 0.07)
        tone(1319, 0.3, 'sine', 0.035, 0.02)
        sweep(0.3, 0.04, 600, 3200, 'bandpass', 1.2)
      }
    },
    // every reel pushes off at once: a low whoosh under a rising rush of air
    push: () => {
      sweep(0.5, 0.05, 300, 2400, 'bandpass', 0.9)
      tone(110, 0.22, 'sine', 0.06, 0, 165)
    },
    // a seat fills: a two-note pop up
    join: () => {
      tone(523, 0.1, 'triangle', 0.06)
      tone(784, 0.16, 'triangle', 0.06, 0.08)
      noise(0.02, 0.05, 3600, 'highpass')
    },
    // a seat empties, or the battle is called off: the same two notes down, softer
    leave: () => {
      tone(659, 0.1, 'triangle', 0.045)
      tone(440, 0.18, 'triangle', 0.045, 0.08)
    },
    // the house bots roll in: three quick robot blips
    bots: () => {
      ;[880, 1175, 1568].forEach((f, i) => tone(f, 0.06, 'square', 0.022, i * 0.07))
      tone(196, 0.24, 'sine', 0.05, 0, 392)
    },
    // the last round is in and the winner is about to show: a snare roll that swells for `dur` seconds
    roll: (dur = 1.2) => {
      const n = Math.round(dur / 0.045)
      for (let i = 0; i < n; i++) noise(0.03, 0.025 + (i / n) * 0.06, 1800 + (i % 2) * 300, 'bandpass', i * 0.045)
      tone(98, dur, 'sine', 0.03, 0, 147)
    },
    // the winner: a fanfare for a win (or a share of a split pot), a soft low fall for a loss
    reveal: (won = false) => {
      if (won) {
        noise(0.12, 0.1, 900, 'lowpass')
        tone(65, 0.6, 'sine', 0.12, 0, 49)
        ;[523, 659, 784, 1046].forEach((f, i) => tone(f, 0.26, 'triangle', 0.06, i * 0.08))
        ;[1046, 1319, 1568].forEach((f) => hold(f, 0.8, 'sawtooth', 0.006, 0.32, undefined, [5, 6]))
        ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.5, 'sine', 0.016, 0.4 + i * 0.09, undefined, [7, 10]))
      } else {
        noise(0.1, 0.06, 600, 'lowpass')
        tone(392, 0.2, 'triangle', 0.045)
        tone(330, 0.24, 'triangle', 0.04, 0.12)
        tone(262, 0.4, 'sine', 0.04, 0.24, 196)
      }
    },
  },
  /* baccarat */
  baccarat: {
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
  },
  /* duck derby */
  derby: {
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
  },
  /* double: colours are 0 red, 1 green, 2 black */
  double: {
    // a chip lands on a colour: a clack on the felt with a little note in the colour's key (green sparkles)
    chip: (c = 0) => {
      const f = [587, 784, 494][c] ?? 587
      noise(0.025, 0.09, 3200, 'bandpass')
      tone(f, 0.07, 'triangle', 0.05, 0, f * 1.25)
      tone(f * 2, 0.05, 'sine', 0.014, 0.012)
      if (c === 1) tone(1568, 0.2, 'sine', 0.014, 0.03, undefined, [7, 10])
    },
    // the last seconds of betting (3, 2, 1): a soft woodblock, brighter on the last one
    count: (n = 3) => {
      tone(n > 1 ? 880 : 1175, 0.07, 'triangle', 0.034)
      noise(0.014, 0.028, 4200, 'highpass')
    },
    // no more bets: two notes stepping down
    close: () => {
      tone(784, 0.1, 'triangle', 0.038)
      tone(587, 0.18, 'triangle', 0.038, 0.09)
    },
    // the strip pushes off: a low thump under a rush of air
    spin: () => {
      sweep(0.6, 0.05, 260, 2600, 'bandpass', 0.9)
      tone(98, 0.26, 'sine', 0.07, 0, 147)
    },
    // a tile passes the marker (speed 0-1): a soft tick, light while the strip races and rounder as it slows; gated so
    // a fast strip never stacks ticks
    tick: (() => {
      const pass = gate(24)
      return (speed = 0) => {
        if (!pass()) return
        const s = Math.max(0, Math.min(1, speed))
        const f = 700 + 900 * s ** 0.7
        tone(f, 0.03, 'triangle', 0.032 - s * 0.016)
        noise(0.01, 0.026 - s * 0.012, f * 2.3, 'bandpass')
      }
    })(),
    // the strip comes to rest: a soft thunk, then a chime in the winning colour; green gets a run of bells
    land: (c = 0) => {
      noise(0.05, 0.08, 700, 'lowpass')
      tone(150, 0.14, 'sine', 0.08, 0, 90)
      if (c === 1) {
        sweep(0.5, 0.04, 900, 5200, 'bandpass', 2, 0.05)
        ;[784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.26, 'triangle', 0.045, 0.06 + i * 0.06))
        ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.7, 'sine', 0.018, 0.4 + i * 0.07, undefined, [6, 9]))
      } else {
        const f = c === 0 ? 659 : 523
        tone(f, 0.2, 'triangle', 0.05, 0.05)
        tone(f * 1.5, 0.32, 'sine', 0.024, 0.12)
      }
    },
    // your bets paid: coins, with a fanfare when it is big (a green win)
    win: (big = false) => {
      ;[1047, 1319, 1568].forEach((f, i) => tone(f, 0.14, 'triangle', 0.045, i * 0.07))
      noise(0.06, 0.04, 6000, 'highpass', 0.05)
      if (big) {
        ;[523, 659, 784, 1047].forEach((f, i) => hold(f, 0.16, 'sawtooth', 0.012, 0.22 + i * 0.09))
        ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.6, 'sine', 0.018, 0.6 + i * 0.08, undefined, [6, 9]))
      }
    },
    // nothing came in
    lose: () => {
      tone(330, 0.16, 'triangle', 0.03)
      tone(262, 0.3, 'sine', 0.03, 0.12, 220)
    },
    // the table refused a chip (it comes straight back)
    refused: () => {
      tone(220, 0.12, 'square', 0.018)
      tone(185, 0.18, 'square', 0.016, 0.1)
    },
  },
  /* lucky claw: the cabinet's motors and clunks, plush squeaks and the prize fanfares */
  claw: (() => {
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
  })(),
  /* scratch & win: the coin on the foil, cells coming out, the suspense, the stamp and each card's own fanfares */
  scratch: (() => {
    type Card = 'clover' | 'gold' | 'fruit' | 'diamond'
    const g = { reveal: gate(35), pair: gate(90), coin: gate(45), tick: gate(26), tease: gate(600), ring: gate(60) }

    /* the coin: a click train (grains of foil tearing) whose rate follows the coin's speed, over a low rub of metal on
       card; each foil has its own colour */
    const FOILS: Record<Card, { bp: number; q: number; rub: number; bright: number }> = {
      clover: { bp: 2500, q: 0.85, rub: 340, bright: 1 },
      gold: { bp: 1850, q: 0.9, rub: 280, bright: 0.85 },
      fruit: { bp: 3100, q: 1.1, rub: 420, bright: 1.15 },
      diamond: { bp: 3900, q: 1.5, rub: 470, bright: 1.3 },
    }
    let grains: { a: AudioContext; buf: AudioBuffer } | null = null
    const grainBuffer = (a: AudioContext) => {
      if (grains?.a === a) return grains.buf
      const len = Math.floor(a.sampleRate * 2)
      const buf = a.createBuffer(1, len, a.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.04
      // tiny decaying bursts every 2 to 9 ms, of random strength
      let i = 0
      while (i < len) {
        i += Math.floor(a.sampleRate * (0.002 + Math.random() * 0.007))
        const amp = 0.35 + Math.random() * 0.65
        const n = 18 + Math.floor(Math.random() * 50)
        for (let k = 0; k < n && i + k < len; k++) d[i + k] += (Math.random() * 2 - 1) * amp * (1 - k / n) ** 2
      }
      grains = { a, buf }
      return buf
    }
    let hiss: { a: AudioContext; buf: AudioBuffer } | null = null
    const hissBuffer = (a: AudioContext) => {
      if (hiss?.a === a) return hiss.buf
      const len = Math.floor(a.sampleRate * 1.3)
      const buf = a.createBuffer(1, len, a.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      hiss = { a, buf }
      return buf
    }

    /** a pentatonic step above A5 for the n-th cell to come out */
    const step = (n: number) => 880 * 2 ** ([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24][Math.max(0, Math.min(10, n))] / 12)

    /* each card's instrument: a penny whistle, a banjo, a marimba and glass bells */
    const pluck = (f: number, dur: number, gain: number, delay: number) => {
      const a = ac()
      if (!a) return
      const t = a.currentTime + delay
      const o = osc(a, t, f, dur, 'sawtooth', f * 0.995)
      const lp = a.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(4200, t)
      lp.frequency.exponentialRampToValueAtTime(700, t + dur * 0.6)
      lp.Q.value = 2
      const v = a.createGain()
      v.gain.setValueAtTime(0.0001, t)
      v.gain.exponentialRampToValueAtTime(gain, t + 0.004)
      v.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(lp).connect(v).connect(out(a))
      noise(0.012, gain * 0.9, 3500, 'bandpass', delay)
    }
    const whistle = (f: number, dur: number, gain: number, delay: number) => {
      hold(f, dur, 'sine', gain, delay, undefined, [5.6, f * 0.007])
      hold(f * 2, dur * 0.9, 'sine', gain * 0.1, delay)
      noise(Math.min(0.12, dur), gain * 0.5, f * 1.6, 'bandpass', delay)
    }
    const mallet = (f: number, dur: number, gain: number, delay: number) => {
      tone(f, Math.max(0.3, dur), 'sine', gain, delay)
      tone(f * 3.93, 0.12, 'sine', gain * 0.22, delay)
      tone(f * 2, 0.18, 'triangle', gain * 0.12, delay)
      noise(0.01, gain * 0.6, 2400, 'bandpass', delay)
    }
    const bell = (f: number, dur: number, gain: number, delay: number) => {
      tone(f, Math.max(0.9, dur * 2), 'sine', gain, delay, undefined, [4, 1.5])
      tone(f * 2.76, Math.max(0.5, dur), 'sine', gain * 0.3, delay)
      tone(f * 5.4, 0.3, 'sine', gain * 0.12, delay)
    }
    const INSTR: Record<Card, (f: number, dur: number, gain: number, delay: number) => void> = { clover: whistle, gold: pluck, fruit: mallet, diamond: bell }
    const LOUD: Record<Card, number> = { clover: 0.034, gold: 0.05, fruit: 0.06, diamond: 0.045 }
    /** each card's motif (Hz) and the chord it lands on */
    const MOTIF: Record<Card, { notes: number[]; chord: number[]; gap: number }> = {
      clover: { notes: [587, 740, 880, 988, 880, 740, 1175], chord: [587, 740, 880, 1175], gap: 0.085 },
      gold: { notes: [392, 494, 587, 784, 587, 988, 784], chord: [392, 494, 587, 784], gap: 0.075 },
      fruit: { notes: [523, 659, 784, 1047, 880, 1047, 1319], chord: [523, 659, 784, 1047], gap: 0.08 },
      diamond: { notes: [659, 831, 988, 1319, 1245, 988, 1319], chord: [659, 831, 988, 1319], gap: 0.11 },
    }
    const play = (card: Card, f: number, dur: number, k: number, delay: number) => INSTR[card](f, dur, LOUD[card] * k, delay)
    /** the first n notes of the card's motif from `delay`, then (optionally) its chord; returns when it ends */
    const phrase = (card: Card, n: number, delay = 0, k = 1, chord = true, octave = 1) => {
      const m = MOTIF[card]
      const notes = m.notes.slice(0, n)
      notes.forEach((f, i) => play(card, f * octave, m.gap * 1.6, k, delay + i * m.gap))
      const end = delay + notes.length * m.gap
      if (chord) m.chord.forEach((f) => play(card, f * octave, 0.7, k * 0.7, end))
      return end
    }

    return {
      // the coin on the foil, held while the pointer is down. set(speed, removing): both 0-1. Returns the voice.
      scrape: (card: Card = 'clover') => {
        const a = ac()
        if (!a) return { set: (_s: number, _r: number) => {}, stop: () => {} }
        const fo = FOILS[card]
        const t = a.currentTime
        const src = a.createBufferSource()
        src.buffer = grainBuffer(a)
        src.loop = true
        const start = Math.random() * 1.5
        const hp = a.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 700
        const bp = a.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = fo.bp
        bp.Q.value = fo.q
        const v = a.createGain()
        v.gain.setValueAtTime(0, t)
        src.connect(hp).connect(bp).connect(v).connect(out(a))
        // the rub: the coin pressing on the card, under the grains
        const rub = a.createBufferSource()
        rub.buffer = hissBuffer(a)
        rub.loop = true
        const lp = a.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = fo.rub
        lp.Q.value = 0.7
        const rv = a.createGain()
        rv.gain.setValueAtTime(0, t)
        rub.connect(lp).connect(rv).connect(out(a))
        src.start(t, start)
        rub.start(t, Math.random())
        let stopped = false
        return {
          set: (speed: number, removing: number) => {
            if (stopped) return
            const n = a.currentTime
            const s = Math.max(0, Math.min(1, speed))
            const r = Math.max(0, Math.min(1, removing))
            const move = Math.min(1, s * 1.6)
            v.gain.setTargetAtTime((0.008 + 0.15 * r) * move, n, 0.02)
            src.playbackRate.setTargetAtTime(0.5 + 1.3 * s, n, 0.04)
            bp.frequency.setTargetAtTime(fo.bp * (0.8 + 0.45 * s) * (0.9 + 0.2 * r) * fo.bright, n, 0.05)
            rv.gain.setTargetAtTime(0.07 * move * (0.45 + 0.55 * r), n, 0.03)
            lp.frequency.setTargetAtTime(fo.rub * (0.8 + 0.6 * s), n, 0.05)
          },
          stop: () => {
            if (stopped) return
            stopped = true
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setTargetAtTime(0, n, 0.025)
            rv.gain.cancelScheduledValues(n)
            rv.gain.setTargetAtTime(0, n, 0.04)
            src.stop(n + 0.3)
            rub.stop(n + 0.3)
          },
        }
      },
      // a cell's last foil falls away (n: how many are out now, 1-9). A blank only rustles; a prize rings up the scale;
      // a top-three prize rings heavier, and the card's top prize heaviest of all.
      reveal: (n = 1, kind: 'blank' | 'prize' | 'hot' | 'top' = 'prize') => {
        if (!g.reveal()) return
        noise(0.035, 0.07, 2600, 'highpass')
        if (kind === 'blank') {
          tone(420, 0.05, 'triangle', 0.025, 0, 300)
          return
        }
        tone(step(n) * 0.5, 0.06, 'triangle', 0.035, 0, step(n) * 0.75)
        tone(step(n), 0.22, 'sine', 0.028, 0.02, undefined, [7, 6])
        if (kind === 'hot' || kind === 'top') {
          tone(step(n) * 0.25, 0.5, 'sine', 0.05, 0.01)
          tone(step(n) * 1.5, 0.35, 'sine', 0.014, 0.05, undefined, [6, 10])
        }
        if (kind === 'top') {
          tone(110, 0.7, 'sine', 0.07, 0, 98)
          ;[2093, 2637, 3136].forEach((f, i) => tone(f, 0.2, 'sine', 0.012, 0.08 + i * 0.05))
        }
      },
      // a symbol shows for the second time (not one of the top three): a quiet nudge
      pair: (n = 1) => {
        if (!g.pair()) return
        tone(step(n + 2), 0.12, 'triangle', 0.018)
      },
      // two of a top-three prize are out and the third is still covered: a rising shimmer
      tease: () => {
        if (!g.tease()) return
        tone(523, 0.5, 'triangle', 0.03, 0, 784, [9, 14])
        tone(659, 0.5, 'sine', 0.018, 0.05, 988, [9, 14])
        reverseCymbal(0.45, 0.025)
      },
      // the coin goes to work on the deciding cell: a snare roll that swells; returns its off switch
      drumroll: (dur = 1.4) => {
        const a = ac()
        if (!a) return () => {}
        const t = a.currentTime
        const m = a.createGain()
        m.gain.value = 1
        m.connect(out(a))
        const n = Math.round(dur / 0.038)
        for (let i = 0; i < n; i++) {
          const at = t + i * 0.038 + Math.random() * 0.006
          const len = Math.floor(a.sampleRate * 0.05)
          const buf = a.createBuffer(1, len, a.sampleRate)
          const d = buf.getChannelData(0)
          for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len) ** 3
          const s = a.createBufferSource()
          s.buffer = buf
          const f = a.createBiquadFilter()
          f.type = 'bandpass'
          f.frequency.value = 1900
          f.Q.value = 0.8
          const gg = a.createGain()
          gg.gain.value = 0.02 + 0.07 * (i / n) ** 1.5
          s.connect(f).connect(gg).connect(m)
          s.start(at)
        }
        const o = osc(a, t, 98, dur, 'sine', 196)
        const og = a.createGain()
        og.gain.setValueAtTime(0.0001, t)
        og.gain.exponentialRampToValueAtTime(0.05, t + dur)
        o.connect(og).connect(m)
        return () => {
          const now = a.currentTime
          m.gain.cancelScheduledValues(now)
          m.gain.setValueAtTime(m.gain.value, now)
          m.gain.linearRampToValueAtTime(0, now + 0.08)
        }
      },
      // the third of a kind comes out: a bright run in the card's own voice
      match: (card: Card = 'clover') => {
        phrase(card, 4, 0, 1.1, false, 2)
        tone(2637, 0.45, 'sine', 0.016, 0.3, undefined, [6, 9])
      },
      // a marker ring closes round winner k (0-2): a note up the card's chord
      ring: (k = 0) => {
        if (!g.ring()) return
        tone(1047 * 2 ** ([0, 4, 7][k] / 12), 0.16, 'triangle', 0.03)
        noise(0.03, 0.03, 4000, 'highpass')
      },
      // the Frenzy spot comes out: a dull tock for ×1, a chime for ×2 and ×3, a rising sparkle for ×5 and ×10
      bonus: (mult = 1) => {
        if (mult <= 1) {
          tone(330, 0.12, 'triangle', 0.05, 0, 260)
          noise(0.05, 0.05, 900, 'lowpass')
          return
        }
        sweep(0.28, 0.04, 900, 4200, 'bandpass', 1.4)
        const k = mult >= 10 ? 1.5 : mult >= 5 ? 1.335 : mult >= 3 ? 1.12 : 1
        ;[784, 988, 1175].forEach((f, i) => tone(f * k, 0.18, 'triangle', 0.045, 0.06 + i * 0.06))
        if (mult >= 5) [2093, 2637, 3136].forEach((f, i) => tone(f * k * 0.75, 0.3, 'sine', 0.018, 0.3 + i * 0.05, undefined, [7, 10]))
      },
      // a card is picked in the rack: two notes in its own voice
      pick: (card: Card = 'clover') => {
        const m = MOTIF[card]
        play(card, m.notes[0], 0.16, 0.6, 0)
        play(card, m.notes[2], 0.22, 0.6, m.gap)
      },
      // a fresh card slides out of the dispenser: a papery slide and a snap
      buy: () => {
        sweep(0.24, 0.07, 2600, 900, 'bandpass', 0.9)
        noise(0.02, 0.09, 3800, 'highpass', 0.2)
        tone(520, 0.05, 'triangle', 0.035, 0.2, 640)
      },
      // the old card is flicked away
      toss: () => {
        sweep(0.22, 0.05, 1800, 500, 'bandpass', 1.1)
      },
      // not enough coins for the card: a soft double buzz
      denied: () => {
        tone(196, 0.09, 'square', 0.018)
        tone(185, 0.12, 'square', 0.016, 0.1)
      },
      // the prize stamp lands: a rubbery thump (brighter on a win, softest on the stake back)
      stamp: (kind: 'win' | 'lose' | 'back' = 'win') => {
        const k = kind === 'back' ? 0.5 : 1
        tone(kind === 'win' ? 130 : 110, 0.14, 'sine', 0.15 * k, 0, kind === 'win' ? 62 : 55)
        noise(0.07, 0.12 * k, kind === 'win' ? 900 : 600, 'lowpass')
        tone(kind === 'win' ? 420 : 300, 0.06, 'triangle', 0.04 * k, 0.005, kind === 'win' ? 300 : 220)
      },
      // what a card paid (winTier: 1 the stake back, 2 small, 3 good, 4 big), in the card's own voice; the
      // celebrations play jackpot()
      win: (tier = 2, card: Card = 'clover') => {
        if (tier <= 1) {
          play(card, MOTIF[card].notes[0], 0.2, 0.55, 0)
          return
        }
        if (tier === 2) {
          phrase(card, 3, 0, 1, false)
          return
        }
        const end = phrase(card, tier === 3 ? 5 : 7, 0, 1, true)
        if (tier >= 4) [2093, 2637, 3136, 4186].forEach((f, i) => tone(f, 0.14, 'sine', 0.014, end + 0.05 + i * 0.06))
      },
      // nothing matched: a soft two-note shrug
      lose: () => {
        tone(392, 0.16, 'triangle', 0.035)
        tone(330, 0.3, 'triangle', 0.03, 0.12, 311)
      },
      // a coin bursting out of a win: a bright clink (gated, so a shower never stacks up)
      coin: () => {
        if (!g.coin()) return
        const f = 2400 + Math.random() * 900
        tone(f, 0.06, 'square', 0.012)
        tone(f * 1.34, 0.12, 'sine', 0.014, 0.03)
      },
      // the three winners lift off and gather: a rising rush
      gather: () => {
        sweep(0.7, 0.05, 300, 5200, 'bandpass', 0.9)
        tone(220, 0.7, 'triangle', 0.03, 0, 880, [7, 10])
      },
      // and fuse: a deep boom with a bright crack on top
      boom: () => {
        tone(72, 0.8, 'sine', 0.2, 0, 38)
        noise(0.5, 0.16, 500, 'lowpass')
        noise(0.12, 0.08, 5000, 'highpass')
        tone(1568, 0.6, 'sine', 0.018, 0.02, undefined, [6, 10])
      },
      // Gold Rush's dynamite goes off: a fizz, a boom and the crackle of falling grit
      blast: () => {
        sweep(0.16, 0.05, 2500, 6000, 'highpass', 0.7)
        tone(90, 0.5, 'sine', 0.16, 0.12, 42)
        noise(0.35, 0.16, 700, 'lowpass', 0.12)
        noise(0.08, 0.08, 3800, 'highpass', 0.12)
        for (let i = 0; i < 6; i++) noise(0.02, 0.035 - i * 0.004, 2600 + Math.random() * 2000, 'bandpass', 0.3 + i * 0.05 + Math.random() * 0.03)
      },
      // the counter rolling up: an odometer tick, brighter as it goes (p: 0-1)
      tick: (p = 0) => {
        if (!g.tick()) return
        tone(1500 + p * 1300, 0.018, 'square', 0.01)
        noise(0.008, 0.03, 5000, 'highpass')
      },
      // the counter lands: a cash register's ka-ching
      kaching: () => {
        noise(0.06, 0.09, 3000, 'highpass')
        tone(2093, 0.5, 'sine', 0.05, 0.05, undefined, [5, 6])
        tone(2637, 0.6, 'sine', 0.045, 0.1, undefined, [5, 6])
        for (let i = 0; i < 5; i++) noise(0.025, 0.05 - i * 0.008, 3400, 'bandpass', 0.14 + i * 0.05)
      },
      // the big one: the card's motif played out and then again an octave up, over its chord and a cymbal swell
      jackpot: (card: Card = 'clover', tier = 5) => {
        const k = tier >= 7 ? 1.25 : 1
        const end = phrase(card, 7, 0, k, true)
        if (tier >= 6) {
          reverseCymbal(end + 0.1, 0.035)
          const end2 = phrase(card, 7, end + 0.12, k, true, 2)
          MOTIF[card].chord.forEach((f, i) => hold(f / 2, 1.4, 'sawtooth', 0.008, end2 + i * 0.01, f / 2, [5, 3]))
          tone(65, 1.4, 'sine', 0.1, end2, 49)
          noise(1.2, 0.04, 6000, 'highpass', end2)
        }
      },
    }
  })(),
  /* penalty shootout: the stadium crowd, the referee, boot on ball, the net, the posts and the keeper */
  penalty: (() => {
    const g = { step: gate(70), bounce: gate(60), aim: gate(40), taunt: gate(400), heart: gate(700), count: gate(45) }
    /** a crowd of voices: sawtooth "aah"s through a vowel formant, scattered over `dur` */
    const voices = (n: number, dur: number, f0: number, f1: number, gain: number, delay = 0, slide = 1.2) => {
      for (let i = 0; i < n; i++) {
        const f = f0 + Math.random() * (f1 - f0)
        nasal(f, dur * (0.6 + Math.random() * 0.5), gain * (0.6 + Math.random() * 0.5), delay + Math.random() * dur * 0.35, f * slide, 700 + Math.random() * 500)
      }
    }
    /**
     * The stand's babble, made once: hundreds of short vowel sounds (a buzzing glottal sawtooth through two formant
     * resonators) at every pitch from a bass to a child's, summed into a six-second loop that wraps round seamlessly
     * (about 20 ms of work on a desktop, done once).
     */
    let babble: AudioBuffer | null = null
    const babbleBuffer = (a: AudioContext) => {
      if (babble) return babble
      const rate = 16000
      const n = rate * 6
      const buf = a.createBuffer(1, n, rate)
      const d = buf.getChannelData(0)
      const vowels = [[730, 1090], [570, 840], [300, 870], [530, 1840], [660, 1720], [440, 1020], [400, 1920], [610, 1190]]
      const reson = (f: number, bw: number) => {
        const r = Math.exp((-Math.PI * bw) / rate)
        return [2 * r * Math.cos((2 * Math.PI * f) / rate), -r * r, 1 - r] as const
      }
      for (let k = 0; k < 560; k++) {
        const start = Math.floor(Math.random() * n)
        const len = Math.floor(rate * (0.1 + Math.random() * 0.42))
        const f0 = Math.random() < 0.6 ? 95 + Math.random() * 90 : 180 + Math.random() * 140
        const glide = 1 + (Math.random() - 0.5) * 0.35
        const [F1, F2] = vowels[Math.floor(Math.random() * vowels.length)]
        const [a1, b1, g1] = reson(F1 * (0.9 + Math.random() * 0.2), 90)
        const [a2, b2, g2] = reson(F2 * (0.9 + Math.random() * 0.2), 130)
        const amp = 0.4 + Math.random() * 0.6
        let ph = 0
        let y1 = 0
        let y2 = 0
        let z1 = 0
        let z2 = 0
        for (let i = 0; i < len; i++) {
          const t = i / len
          const e = 4 * t * (1 - t)
          const env = e * e
          ph += (f0 * (1 + (glide - 1) * t)) / rate
          if (ph >= 1) ph -= 1
          const x = ph * 2 - 1
          const o1 = g1 * x + a1 * y1 + b1 * y2
          y2 = y1
          y1 = o1
          const o2 = g2 * x + a2 * z1 + b2 * z2
          z2 = z1
          z1 = o2
          d[(start + i) % n] += (o1 + o2 * 0.55) * env * amp
        }
      }
      let peak = 0
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]))
      const k = 0.9 / (peak || 1)
      for (let i = 0; i < n; i++) d[i] *= k
      babble = buf
      return buf
    }
    return {
      // the stand murmuring under everything (a babble of voices over the hum of the place); returns its off switch
      // and a level control (0-1)
      ambience: () => {
        const a = ac()
        if (!a) return null
        const t = a.currentTime
        const src = a.createBufferSource()
        src.buffer = babbleBuffer(a)
        src.loop = true
        src.playbackRate.value = 0.97 + Math.random() * 0.06
        // the voices, softened as if from across the pitch
        const lp = a.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 2300
        const hp = a.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 140
        // under them a low hum of the stadium (soft filtered noise, not a hiss)
        const hb = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
        const hd = hb.getChannelData(0)
        for (let i = 0; i < hd.length; i++) hd[i] = Math.random() * 2 - 1
        const humSrc = a.createBufferSource()
        humSrc.buffer = hb
        humSrc.loop = true
        const hum = a.createBiquadFilter()
        hum.type = 'lowpass'
        hum.frequency.value = 380
        hum.Q.value = 0.5
        humSrc.connect(hum)
        const humG = a.createGain()
        humG.gain.value = 0.18
        const v = a.createGain()
        v.gain.setValueAtTime(0, t)
        v.gain.linearRampToValueAtTime(0.05, t + 1.4)
        // a slow swell in the murmur
        const lfo = a.createOscillator()
        const depth = a.createGain()
        lfo.frequency.value = 0.11
        depth.gain.value = 0.012
        lfo.connect(depth).connect(v.gain)
        src.connect(hp).connect(lp).connect(v)
        hum.connect(humG).connect(v)
        v.connect(out(a))
        src.start(t, Math.random() * 5)
        humSrc.start(t)
        lfo.start(t)
        // a shout, a whistle or a clap somewhere in the stand now and then
        const timer = setInterval(() => {
          if (Math.random() < 0.3) nasal(200 + Math.random() * 240, 0.28 + Math.random() * 0.2, 0.0035, Math.random() * 0.3, 260 + Math.random() * 220, 850 + Math.random() * 300)
          if (Math.random() < 0.18) for (let i = 0; i < 4; i++) noise(0.02, 0.01, 2200, 'bandpass', i * 0.12 + Math.random() * 0.03)
          if (Math.random() < 0.05) tone(2200 + Math.random() * 600, 0.18, 'sine', 0.004, Math.random() * 0.3, 2600 + Math.random() * 400)
        }, 700)
        let stopped = false
        let level = 0.5
        return {
          level: (l: number) => {
            if (stopped || Math.abs(l - level) < 0.02) return
            level = l
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setValueAtTime(v.gain.value, n)
            v.gain.linearRampToValueAtTime(0.012 + 0.07 * Math.min(1, l), n + 0.35)
          },
          stop: () => {
            if (stopped) return
            stopped = true
            clearInterval(timer)
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setValueAtTime(v.gain.value, n)
            v.gain.linearRampToValueAtTime(0, n + 0.4)
            src.stop(n + 0.45)
            lfo.stop(n + 0.45)
            humSrc.stop(n + 0.45)
          },
        }
      },
      // the stand's drum and chant during a run: BOOM . BOOM . BOOM-BOOM-BOOM ., the whole end singing "oh-oh-oh"
      // on the triplet; quicker with every goal. set(goals, level) steers it; level 0 lets it fall silent.
      chant: () => {
        const a = ac()
        if (!a) return null
        let goals = 0
        let level = 0
        let stopped = false
        let next = a.currentTime + 0.1
        let beat = 0
        const HITS = [1, 0, 1, 0, 1, 1, 1, 0]
        const SUNG: Record<number, number> = { 4: 196, 5: 220, 6: 247 }
        const timer = setInterval(() => {
          if (stopped) return
          if (level < 0.02) {
            next = a.currentTime + 0.15
            beat = 0
            return
          }
          const spb = 60 / (100 + Math.min(10, goals) * 5)
          while (next < a.currentTime + 0.3) {
            const delay = Math.max(0, next - a.currentTime)
            const step = beat % 8
            if (HITS[step]) {
              tone(72, 0.24, 'sine', 0.05 * level, delay, 46)
              noise(0.08, 0.025 * level, 260, 'lowpass', delay)
            }
            if (step === 2 || step === 6) noise(0.03, 0.012 * level, 1800, 'bandpass', delay + spb * 0.5)
            const f = SUNG[step]
            if (f) for (let i = 0; i < 4; i++) nasal(f * (0.995 + Math.random() * 0.01) * (i === 3 ? 2 : 1), spb * 0.85, 0.0045 * level, delay + Math.random() * 0.02, f * (i === 3 ? 2 : 1) * 0.99, 700 + i * 60)
            next += spb
            beat++
          }
        }, 90)
        return {
          set: (gs: number, l: number) => {
            goals = gs
            level = Math.max(0, Math.min(1, l))
          },
          stop: () => {
            stopped = true
            clearInterval(timer)
          },
        }
      },
      // the referee's whistle: a short peep before each shot (never quite the same), a proper blast for the first
      whistle: (n = 1) => {
        const f = 2450 + Math.random() * 380
        const dur = n === 1 ? 0.3 : 0.14 + Math.random() * 0.07
        tone(f, dur, 'sine', 0.024, 0, f * 0.985, [30 + Math.random() * 10, 80])
        tone(f * 1.012, dur, 'triangle', 0.006, 0, f * 0.99, [33, 80])
        noise(dur, 0.005, 3000, 'bandpass')
      },
      // a big shot coming: the heart thumping, and a low string under it that climbs with the stakes (k 0-1)
      heartbeat: (k = 0.5) => {
        if (!g.heart()) return
        const gap = 0.78 - 0.26 * k
        const n = 2 + Math.round(k * 2)
        for (let i = 0; i < n; i++) {
          tone(60, 0.13, 'sine', 0.11 * (0.6 + 0.4 * k), i * gap, 40)
          tone(54, 0.15, 'sine', 0.085 * (0.6 + 0.4 * k), i * gap + 0.17, 38)
        }
        const f = 55 * 2 ** ((k * 7) / 12)
        hold(f, gap * n + 0.3, 'triangle', 0.02 + 0.02 * k, 0, f * 1.05, [5, 1.2])
        hold(f * 1.5, gap * n + 0.2, 'triangle', 0.012 * k, 0.15, f * 1.5 * 1.05, [5.5, 1.5])
      },
      // the replay rolls: a whoosh and a blip
      replay: () => {
        sweep(0.35, 0.05, 700, 3200, 'bandpass', 1.2)
        tone(880, 0.07, 'triangle', 0.025, 0.12, 1320)
        tone(1320, 0.12, 'triangle', 0.02, 0.2)
      },
      // a goal's own note, a step higher up the scale with every goal of the run
      goal: (n = 1) => {
        const STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16]
        const f = 392 * 2 ** (STEPS[Math.min(9, Math.max(0, n - 1))] / 12)
        ;[f / 2 ** (7 / 12), f / 2 ** (4 / 12), f].forEach((x, i) => tone(x, 0.2, 'triangle', 0.035, 0.06 + i * 0.07))
        tone(f * 2, 0.55, 'sine', 0.02, 0.27, undefined, [6, 6])
      },
      // a big win (tier 1 at 10×, 2 at 100×, 3 at 1,000×): a cymbal swell, a brass fanfare that climbs a step per tier
      bigWin: (tier = 1) => {
        const t = Math.max(1, Math.min(3, tier))
        reverseCymbal(0.5, 0.03 + 0.012 * t)
        const CHORDS = [
          [523, 659, 784],
          [587, 740, 880],
          [659, 831, 988],
          [784, 988, 1175],
        ]
        for (let i = 0; i <= t; i++) CHORDS[i].forEach((f) => hold(f, 0.17, 'sawtooth', 0.011, 0.5 + i * 0.19))
        const end = 0.5 + (t + 1) * 0.19
        CHORDS[t].forEach((f) => hold(f * 2, 1.1 + t * 0.2, 'sawtooth', 0.009, end, f * 2, [5, 4]))
        tone(65, 1.2, 'sine', 0.1, end, 49)
        for (let i = 0; i < 6 + t * 5; i++) {
          const f = 2300 + Math.random() * 1000
          tone(f, 0.06, 'square', 0.008, end + i * 0.05)
          tone(f * 1.34, 0.1, 'sine', 0.01, end + 0.02 + i * 0.05)
        }
      },
      // the payout counting up: a coin tick, brighter as it climbs (k 0-1)
      count: (k = 0) => {
        if (!g.count()) return
        tone(1900 + k * 1400, 0.04, 'triangle', 0.016)
      },
      // a stud on the grass
      step: () => {
        if (!g.step()) return
        noise(0.05, 0.05, 420, 'lowpass')
        tone(95, 0.05, 'sine', 0.03, 0, 60)
      },
      // boot on ball: a deep thump, the slap of leather and the air rushing after it
      kick: (power = 1) => {
        tone(96, 0.2, 'sine', 0.2 * power, 0, 44)
        tone(190, 0.07, 'triangle', 0.08 * power, 0, 95)
        noise(0.05, 0.24 * power, 1500, 'bandpass')
        noise(0.025, 0.1, 4200, 'highpass')
        sweep(0.45, 0.03 * power, 2200, 700, 'bandpass', 1.1, 0.04)
      },
      // the keeper launches himself
      dive: () => {
        sweep(0.32, 0.045, 500, 1900, 'bandpass', 0.8)
        nasal(220, 0.22, 0.012, 0, 170, 800)
      },
      // and hits the grass
      land: () => {
        noise(0.2, 0.13, 320, 'lowpass')
        tone(72, 0.22, 'sine', 0.11, 0, 44)
      },
      // the ball into his gloves (held) or punched away
      glove: (held = true) => {
        if (held) {
          noise(0.07, 0.22, 1050, 'bandpass')
          tone(165, 0.11, 'sine', 0.13, 0, 92)
          tone(120, 0.18, 'sine', 0.06, 0.03, 70)
        } else {
          noise(0.05, 0.24, 1900, 'bandpass')
          tone(240, 0.08, 'triangle', 0.09, 0, 140)
        }
      },
      // the ball in the back of the net: a swish of mesh and a soft thud
      net: () => {
        sweep(0.5, 0.1, 4200, 900, 'bandpass', 0.8)
        noise(0.32, 0.06, 2600, 'highpass', 0.02)
        tone(130, 0.22, 'sine', 0.06, 0, 78)
        for (let i = 0; i < 3; i++) noise(0.04, 0.02, 3000 + i * 600, 'bandpass', 0.08 + i * 0.07)
      },
      // off the woodwork: a metal ring (the bar a touch lower than the post)
      post: (bar = false) => {
        const k = bar ? 0.86 : 1
        ;[[520, 1.1, 0.07], [1340, 0.8, 0.045], [2210, 0.55, 0.028], [3150, 0.4, 0.018]].forEach(([f, d, gn]) => tone(f * k, d, 'sine', gn, 0, f * k * 0.995))
        noise(0.03, 0.16, 3000, 'bandpass')
        tone(110 * k, 0.15, 'sine', 0.08, 0, 70)
      },
      // the ball bouncing on the grass (k: how hard)
      bounce: (k = 1) => {
        if (!g.bounce()) return
        tone(150, 0.09, 'sine', 0.09 * k, 0, 92)
        noise(0.04, 0.05 * k, 900, 'lowpass')
      },
      // time slows down: a deep whoom and a heartbeat
      slowmo: () => {
        tone(62, 0.6, 'sine', 0.13, 0, 38)
        sweep(0.7, 0.04, 1600, 260, 'bandpass', 1.5)
        tone(55, 0.12, 'sine', 0.1, 0.42, 40)
        tone(55, 0.14, 'sine', 0.12, 0.62, 40)
      },
      // the crowd erupts (k: how loud), with whistles and an air horn
      roar: (k = 1) => {
        swell(3.4, 0.085 * k, 'bandpass', 680, 0.7, 0.1)
        swell(3.0, 0.055 * k, 'bandpass', 1450, 0.8, 0.08)
        swell(2.4, 0.028 * k, 'bandpass', 3000, 1.0, 0.06)
        voices(Math.round(6 + 6 * k), 1.6, 260, 520, 0.009 * k, 0.05, 1.3)
        tone(2600, 0.25, 'sine', 0.022, 0.35, 3300)
        tone(3100, 0.42, 'sine', 0.02, 0.7, 2300)
        hold(233, 0.7, 'sawtooth', 0.012 * k, 0.55, 233, [4, 3])
        hold(294, 0.7, 'sawtooth', 0.009 * k, 0.55, 294, [4, 3])
      },
      // a gasp at a near thing
      ooh: () => {
        swell(1.2, 0.06, 'bandpass', 600, 1.2, 0.15)
        voices(8, 0.9, 300, 420, 0.01, 0, 1.25)
      },
      // the crowd groans at a save
      groan: () => {
        sweep(1.8, 0.08, 900, 280, 'bandpass', 1.1)
        swell(1.6, 0.05, 'bandpass', 520, 0.9, 0.05)
        voices(10, 1.4, 330, 470, 0.011, 0, 0.62)
      },
      // the striker's whoop
      cheer: (k = 1) => {
        nasal(330, 0.18, 0.03 * k, 0, 420, 1100)
        nasal(420, 0.42, 0.034 * k, 0.16, 520, 1300)
      },
      // the keeper roars after a save
      keeperCheer: () => {
        nasal(200, 0.2, 0.03, 0, 260, 850)
        nasal(260, 0.5, 0.035, 0.18, 220, 950)
      },
      // the keeper pounds the grass
      thump: () => {
        for (let i = 0; i < 3; i++) {
          tone(84, 0.12, 'sine', 0.08, i * 0.11, 52)
          noise(0.06, 0.05, 380, 'lowpass', i * 0.11)
        }
      },
      // the keeper's cheeky taunt: a slide whistle up and down (twice, and the stand whistling back, for a big one)
      taunt: (big = false) => {
        if (!g.taunt()) return
        tone(620, 0.22, 'sine', 0.022, 0, 1250, [8, 20])
        tone(1250, 0.26, 'sine', 0.022, 0.24, 560, [8, 20])
        if (!big) return
        tone(560, 0.2, 'sine', 0.02, 0.52, 1400, [8, 24])
        tone(1400, 0.3, 'sine', 0.02, 0.73, 520, [8, 24])
        for (let i = 0; i < 5; i++) tone(2300 + Math.random() * 700, 0.3, 'sine', 0.004, 0.3 + Math.random() * 0.5, 2000 + Math.random() * 600)
      },
      // a knee slide across the grass
      slide: () => {
        sweep(0.55, 0.05, 1400, 500, 'bandpass', 0.7)
        noise(0.4, 0.03, 600, 'lowpass', 0.05)
      },
      // a firework over the stand: the whistle up, the bang and the crackle
      firework: () => {
        tone(900, 0.32, 'sine', 0.008, 0, 2400)
        noise(0.5, 0.11, 700, 'lowpass', 0.3)
        tone(58, 0.4, 'sine', 0.08, 0.3, 36)
        crackle(0.6, 0.03, 0.45)
      },
      // a different keeper takes his place: a puff
      pop: () => {
        noise(0.08, 0.1, 2800, 'highpass')
        tone(420, 0.14, 'sine', 0.05, 0, 900)
        tone(900, 0.1, 'triangle', 0.02, 0.06, 1400)
      },
      // the target moves to another zone
      aim: () => {
        if (!g.aim()) return
        tone(880, 0.05, 'triangle', 0.03, 0, 1180)
      },
      // the ball set down on the spot
      place: () => {
        tone(210, 0.07, 'sine', 0.06, 0, 140)
        noise(0.03, 0.04, 800, 'lowpass')
      },
      // cashing out: coins and a bright chord (bigger for a bigger multiplier)
      cashout: (mult = 2) => {
        ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.16, 'triangle', 0.045, i * 0.06))
        for (let i = 0; i < Math.min(10, 3 + Math.round(Math.log2(mult) * 1.5)); i++) {
          const f = 2300 + Math.random() * 1000
          tone(f, 0.06, 'square', 0.01, 0.18 + i * 0.05)
          tone(f * 1.34, 0.1, 'sine', 0.012, 0.2 + i * 0.05)
        }
        if (mult >= 10) {
          ;[523, 659, 784].forEach((f, i) => hold(f, 0.12, 'sawtooth', 0.014, 0.3 + i * 0.1))
          hold(1047, 0.6, 'sawtooth', 0.016, 0.6, 1047, [5, 5])
        }
      },
      // the Perfect 10: a brass fanfare over a cymbal swell
      perfect: () => {
        reverseCymbal(0.7, 0.05)
        ;[392, 523, 659, 784].forEach((f, i) => hold(f, 0.16, 'sawtooth', 0.016, 0.7 + i * 0.12))
        ;[523, 659, 784, 1047].forEach((f) => hold(f, 1.2, 'sawtooth', 0.012, 1.2, f, [5, 4]))
        ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 1.2, 'sine', 0.014, 1.25 + i * 0.06, undefined, [6, 9]))
        tone(65, 1.4, 'sine', 0.12, 1.2, 49)
      },
    }
  })(),
}
