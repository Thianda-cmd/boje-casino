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
  if (plunderDepth) return plunderOut(a)
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

/* Plunder Bay's recipes (sfx.plunder) play through a compressor of their own, like Pop Party's: one cascade can blast
   twenty symbols at once on top of a coin shower and a cannon. `plunderDepth` is only non-zero while a plunder recipe
   runs, so nothing else is routed through it. */
let plunderDepth = 0
let plunderBus: AudioNode | null = null

function plunderOut(a: AudioContext): AudioNode {
  if (!plunderBus) {
    const c = a.createDynamicsCompressor()
    c.threshold.value = -15
    c.knee.value = 10
    c.ratio.value = 4.5
    c.attack.value = 0.003
    // opens instantly for its first moments (see the party bus), then settles to the real release
    c.release.value = 0
    c.release.setValueAtTime(0.16, a.currentTime + 0.06)
    const trim = a.createGain()
    trim.gain.value = 0.68
    c.connect(trim).connect(a.destination)
    plunderBus = c
  }
  return plunderBus
}

function viaPlunderBus<T extends Record<string, (...args: never) => unknown>>(group: T): T {
  const routed: Record<string, (...args: never) => unknown> = {}
  for (const [name, play] of Object.entries(group))
    routed[name] = (...args) => {
      plunderDepth++
      try {
        return play(...args)
      } finally {
        plunderDepth--
      }
    }
  return routed as T
}
const plunderGate = { land: gate(30), crew: gate(80), ways: gate(55), map: gate(45), blast: gate(38) }

/** Plunder Bay's ambience and shanty (sfx.plunder.bed()): see plunderBed */
export interface PlunderBed {
  /** the sunset deck (sea, creaks, gulls) or the Treasure Hunt night (a calmer sea under the squeezebox shanty) */
  mode(m: 'day' | 'night'): void
  /** the shanty picks up the pace (the multiplier reached ×10) */
  fast(on: boolean): void
  /** dips the bed under a big moment for `sec` seconds */
  duck(sec: number, db?: number): void
  /** fades it out for good */
  stop(): void
}

/**
 * The bed under Plunder Bay: a looping sea wash that swells like waves, spray, the ship's timbers creaking now and then
 * and a gull or two by day; at night the sea calms and a squeezebox shanty plays over an oom-pah bass (an original tune
 * in D Dorian, 4 bars round and round), faster from ×10. Quiet by design, through the plunder compressor, it follows
 * the mute switch and goes silent while the tab is hidden. Notes are scheduled a quarter second ahead on a timer.
 */
function plunderBed(): PlunderBed | null {
  const a = ac()
  if (!a) return null
  const bus = a.createGain()
  bus.gain.value = 0
  const soft = a.createBiquadFilter()
  soft.type = 'lowpass'
  soft.frequency.value = 9000
  bus.connect(soft).connect(plunderOut(a))
  const level = a.createGain()
  level.gain.value = 1
  level.connect(bus)
  // the sea: looping noise through a lowpass, its level swelling with the waves; spray above it
  const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const sea = a.createBufferSource()
  sea.buffer = buf
  sea.loop = true
  const seaLp = a.createBiquadFilter()
  seaLp.type = 'lowpass'
  seaLp.frequency.value = 520
  const seaG = a.createGain()
  seaG.gain.value = 0.034
  const spray = a.createBufferSource()
  spray.buffer = buf
  spray.loop = true
  spray.loopStart = 0.7
  const sprayBp = a.createBiquadFilter()
  sprayBp.type = 'bandpass'
  sprayBp.frequency.value = 2600
  sprayBp.Q.value = 0.6
  const sprayG = a.createGain()
  sprayG.gain.value = 0.0045
  sea.connect(seaLp).connect(seaG).connect(level)
  spray.connect(sprayBp).connect(sprayG).connect(level)
  // the waves: a slow swell on the sea and the spray (two LFOs a little out of step)
  const swell = a.createOscillator()
  swell.frequency.value = 0.16
  const swellD = a.createGain()
  swellD.gain.value = 0.02
  swell.connect(swellD).connect(seaG.gain)
  const swell2 = a.createOscillator()
  swell2.frequency.value = 0.11
  const swell2D = a.createGain()
  swell2D.gain.value = 0.004
  swell2.connect(swell2D).connect(sprayG.gain)
  const t0 = a.currentTime + 0.02
  for (const s of [sea, spray, swell, swell2]) s.start(t0)
  bus.gain.setTargetAtTime(1, t0, 0.8)

  // the shanty's own bus (it fades in and out with the night)
  const music = a.createGain()
  music.gain.value = 0
  const musicLp = a.createBiquadFilter()
  musicLp.type = 'lowpass'
  musicLp.frequency.value = 2800
  music.connect(musicLp).connect(level)

  const voice = (f: number, dur: number, type: OscillatorType, gain: number, at: number, to: AudioNode, vib?: [number, number]) => {
    const o = osc(a, at, f, dur, type, undefined, vib)
    const g = a.createGain()
    const rel = Math.min(0.08, dur * 0.4)
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.015)
    g.gain.setValueAtTime(gain, at + Math.max(0.02, dur - rel))
    g.gain.linearRampToValueAtTime(0, at + dur)
    o.connect(g).connect(to)
  }
  /** a squeezebox reed pair a hair apart */
  const reed = (f: number, dur: number, gain: number, at: number) => {
    voice(f, dur, 'square', gain, at, music, [5.5, 2])
    voice(f * 1.004, dur, 'sawtooth', gain * 0.5, at, music)
  }
  const creak = (at: number, gain: number) => {
    const o = osc(a, at, 112 + Math.random() * 20, 0.5, 'sawtooth', 150 + Math.random() * 30, [24 + Math.random() * 8, 18])
    const g = a.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.12)
    g.gain.linearRampToValueAtTime(0, at + 0.5)
    const f = a.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 600
    f.Q.value = 1.4
    o.connect(f).connect(g).connect(level)
  }
  const gull = (at: number) => {
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const t = at + i * 0.24
      const f0 = 1700 + Math.random() * 300
      const o = osc(a, t, f0, 0.2, 'sawtooth', f0 * 1.35)
      const bp = a.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 2300
      bp.Q.value = 3
      const g = a.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.006, t + 0.03)
      g.gain.linearRampToValueAtTime(0, t + 0.2)
      o.connect(bp).connect(g).connect(level)
    }
  }

  // D Dorian: the tune in eighths (scale steps from D, R a rest), eight bars over i, VII, IV and v
  const D = 293.66
  const SCALE = [0, 2, 3, 5, 7, 9, 10]
  const hz = (step: number) => D * 2 ** ((SCALE[((step % 7) + 7) % 7] + 12 * Math.floor(step / 7)) / 12)
  const R = -99
  const TUNE = [0, 2, 4, 4, 3, 2, 1, 0, -1, 1, 3, 3, 2, 1, 0, R, 0, 2, 4, 4, 5, 4, 3, 2, 4, 3, 2, 1, 0, R, 0, R, 4, 4, 7, 7, 6, 5, 4, R, 3, 3, 6, 6, 5, 4, 3, R, 4, 5, 4, 3, 2, 3, 4, 2, 1, -1, 0, R, 0, 0, 0, R]
  // chord roots per half bar (scale steps; -1 is the C below), the third and fifth stacked on each
  const ROOTS = [0, 0, -1, -1, 0, 3, 4, 0, 0, -1, 3, 3, 0, 3, 4, 0]
  let mode: 'day' | 'night' = 'day'
  let quick = false
  let stopped = false
  let next = a.currentTime + 0.1
  let step = 0
  let creakAt = a.currentTime + 4 + Math.random() * 6
  let gullAt = a.currentTime + 6 + Math.random() * 8
  let on = true
  const timer = setInterval(() => {
    if (stopped) return
    const want = !isMuted() && document.visibilityState !== 'hidden'
    if (want !== on) {
      on = want
      bus.gain.cancelScheduledValues(a.currentTime)
      bus.gain.setTargetAtTime(want ? 1 : 0, a.currentTime, want ? 0.5 : 0.08)
      next = a.currentTime + 0.1
    }
    if (!on) return
    const now = a.currentTime
    if (now > creakAt) {
      creak(now + 0.05, mode === 'day' ? 0.005 : 0.0035)
      creakAt = now + (mode === 'day' ? 7 : 11) + Math.random() * 8
    }
    if (mode === 'day' && now > gullAt) {
      gull(now + 0.05)
      gullAt = now + 9 + Math.random() * 12
    }
    if (mode !== 'night') {
      next = now + 0.1
      step = 0
      return
    }
    const s8 = 60 / (quick ? 138 : 116) / 2
    while (next < now + 0.25) {
      const at = Math.max(next, now + 0.005)
      const i = step % TUNE.length
      const n = TUNE[i]
      if (n !== R) reed(hz(n + 7), s8 * (TUNE[(i + 1) % TUNE.length] === R ? 1.9 : 0.92), 0.0075, at)
      const root = ROOTS[Math.floor(i / 4) % ROOTS.length]
      // oom on the beat, pah (the chord) on the off-beat
      if (i % 2 === 0) voice(hz(root) / 2, s8 * 0.9, 'triangle', 0.026, at, music)
      else for (const k of [0, 2, 4]) voice(hz(root + k), s8 * 0.7, 'square', 0.0032, at, music)
      next += s8
      step++
    }
  }, 60)

  return {
    mode: (m) => {
      if (m === mode || stopped) return
      mode = m
      const n = a.currentTime
      seaLp.frequency.setTargetAtTime(m === 'night' ? 380 : 520, n, 0.6)
      seaG.gain.setTargetAtTime(m === 'night' ? 0.024 : 0.034, n, 0.6)
      music.gain.cancelScheduledValues(n)
      music.gain.setTargetAtTime(m === 'night' ? 1 : 0, n, m === 'night' ? 0.5 : 0.25)
      next = n + 0.4
      step = 0
    },
    fast: (v) => {
      quick = v
    },
    duck: (sec, db = -10) => {
      if (stopped) return
      const n = a.currentTime
      const low = 10 ** (db / 20)
      level.gain.cancelScheduledValues(n)
      level.gain.setValueAtTime(level.gain.value, n)
      level.gain.linearRampToValueAtTime(low, n + 0.05)
      level.gain.setValueAtTime(low, n + 0.05 + sec)
      level.gain.linearRampToValueAtTime(1, n + 0.05 + sec + 0.8)
    },
    stop: () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      const n = a.currentTime
      bus.gain.cancelScheduledValues(n)
      bus.gain.setValueAtTime(bus.gain.value, n)
      bus.gain.linearRampToValueAtTime(0, n + 0.5)
      for (const s of [sea, spray, swell, swell2]) s.stop(n + 0.6)
      setTimeout(() => bus.disconnect(), 900)
    },
  }
}

/** a ship's bell: the struck note and the inharmonic partials that make it ring on */
function shipBell(f: number, gain: number, delay = 0, len = 1.4) {
  tone(f, len, 'sine', gain, delay)
  tone(f * 2.76, len * 0.55, 'sine', gain * 0.45, delay)
  tone(f * 5.4, len * 0.3, 'sine', gain * 0.22, delay)
  tone(f * 8.93, len * 0.16, 'sine', gain * 0.1, delay)
  noise(0.02, gain * 0.8, 5000, 'highpass', delay)
}

/** a gold coin or brass plate struck: a short metallic clang */
function coinClang(f: number, gain: number, delay = 0) {
  tone(f, 0.28, 'triangle', gain, delay)
  tone(f * 2.41, 0.18, 'sine', gain * 0.6, delay)
  tone(f * 3.87, 0.12, 'sine', gain * 0.4, delay)
  noise(0.03, gain * 1.4, 3500, 'highpass', delay)
}

/** sea spray thrown up and falling away */
function waterSplash(gain: number, delay = 0) {
  sweep(0.26, gain, 3200, 600, 'bandpass', 0.8, delay)
  noise(0.05, gain * 0.9, 4200, 'highpass', delay)
  noise(0.12, gain * 0.6, 500, 'lowpass', delay)
}

/** a squeezebox chord: two reeds a hair apart over a soft bass reed */
function squeezebox(f: number, dur: number, gain: number, delay = 0) {
  hold(f, dur, 'square', gain, delay, undefined, [5.5, 2])
  hold(f * 1.004, dur, 'square', gain * 0.8, delay)
  hold(f / 2, dur, 'triangle', gain * 1.2, delay)
}

/** a brass note with a little growl in it */
function brassNote(f: number, dur: number, gain: number, delay = 0) {
  hold(f, dur, 'sawtooth', gain, delay, undefined, [5, 4])
  hold(f * 1.003, dur, 'sawtooth', gain * 0.6, delay)
  tone(f * 2, Math.min(dur, 0.3), 'triangle', gain * 0.8, delay)
}

/** a ship's cannon: the deep boom, the blast of air and the crack */
function cannonBoom(gain: number, delay = 0) {
  tone(62, 0.6, 'sine', gain, delay, 30)
  noise(0.5, gain * 1.1, 420, 'lowpass', delay)
  noise(0.06, gain, 2600, 'highpass', delay)
}

/** a parrot's squawk: a raspy nasal call that jumps up, then falls; k scales the pitch */
function parrotCall(k: number, delay = 0) {
  nasal(1050 * k, 0.11, 0.05, delay, 1650 * k, 2300)
  nasal(1500 * k, 0.17, 0.045, delay + 0.1, 850 * k, 2100)
  tone(1300 * k, 0.26, 'sawtooth', 0.006, delay, 900 * k, [42, 140])
  noise(0.08, 0.03, 3200, 'bandpass', delay + 0.02)
}

/** rope and timber creaking */
function timberCreak(dur: number, gain: number, delay = 0) {
  tone(118, dur, 'sawtooth', gain, delay, 152, [26, 20])
  tone(236, dur * 0.8, 'square', gain * 0.35, delay + dur * 0.1, 300, [31, 30])
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
  /* plunder bay: timber and rope, sea spray, gold coins, the ship's bell and cannon, brass and squeezebox shanty
     flourishes, and Captain Polly's squawk */
  plunder: viaPlunderBus({
    // the spin: the frame creaks and the old symbols rush out of the bottom
    spin: () => {
      timberCreak(0.22, 0.012)
      sweep(0.32, 0.05, 2400, 500, 'bandpass', 1.1, 0.04)
    },
    // a reel lands: a wooden thock, a step higher along the frame
    land: (reel = 0) => {
      if (!plunderGate.land()) return
      const k = 2 ** ((reel * 2) / 12)
      tone(170 * k, 0.1, 'sine', 0.1, 0, 86 * k)
      noise(0.045, 0.08, 900 + reel * 140, 'bandpass')
      tone(560 * k, 0.05, 'triangle', 0.018, 0.01)
    },
    // one of the crew lands with it: a cheeky little chirp
    crew: (reel = 0) => {
      if (!plunderGate.crew()) return
      const f = [1175, 1319, 1480, 1568, 1760, 1976][reel % 6]
      tone(f, 0.07, 'triangle', 0.018, 0.02, f * 1.25)
    },
    // the ways counter rolls on: a ratchet tick, higher the more ways (64 to 117,649)
    ways: (n = 64) => {
      if (!plunderGate.ways()) return
      const k = Math.log2(Math.max(64, n) / 64) / Math.log2(117649 / 64)
      tone(900 + 1300 * k, 0.03, 'square', 0.009)
      noise(0.012, 0.03, 3500, 'bandpass')
    },
    // a treasure map comes to rest: parchment unrolling and a chime a step higher for each map in the spin
    map: (n = 0) => {
      if (!plunderGate.map()) return
      const f = 659 * 2 ** ((Math.min(n, 6) * 3) / 12)
      noise(0.14, 0.05, 2400, 'bandpass')
      tone(f, 0.22, 'triangle', 0.05, 0.03)
      tone(f * 1.5, 0.32, 'sine', 0.03, 0.08, undefined, [6, 8])
    },
    // enough maps to count: a bright sting and the bell
    mapsReady: () => {
      ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.16, 'triangle', 0.04, i * 0.05))
      shipBell(1568, 0.025, 0.2, 0.9)
    },
    // reels held back for the last map: a drone rising over a drum roll, for `secs`
    tease: (secs = 1.1) => {
      const d = Math.max(0.5, secs)
      hold(98, d, 'sawtooth', 0.016, 0, 196, [7, 5])
      hold(147, d, 'triangle', 0.02, 0, 294)
      const n = Math.round(d / 0.07)
      for (let i = 0; i < n; i++) noise(0.04, 0.03 + (0.04 * i) / n, 300, 'lowpass', i * 0.07)
    },
    // winners light up: a sparkling swish, brighter the longer the cascade
    glow: (i = 0) => {
      const k = 2 ** (Math.min(i, 8) / 12)
      sweep(0.2, 0.035, 900 * k, 4200 * k, 'bandpass', 2)
      tone(1568 * k, 0.12, 'sine', 0.02, 0.06)
    },
    // a step wins: a jaunty run on the squeezebox, longer for bigger wins (size 0-2)
    win: (size = 0) => {
      const notes = size >= 2 ? [587, 740, 880, 1175, 1480] : size === 1 ? [740, 880, 1175] : [880, 1175]
      notes.forEach((f, i) => {
        tone(f, 0.14, 'square', 0.016, i * 0.065)
        tone(f, 0.18, 'triangle', 0.03, i * 0.065)
      })
      if (size >= 1) squeezebox(notes[notes.length - 1], 0.3, 0.01, notes.length * 0.065)
    },
    // the ×multiplier joins an amount: a coin flipped onto the table
    chip: (mult = 2) => coinClang(1319 * 2 ** (Math.min(mult, 24) / 36), 0.03),
    // the multiplied amount lands: a thump and a chord, higher for a bigger multiplier
    slam: (mult = 2) => {
      const k = 2 ** (Math.min(mult, 24) / 24)
      tone(98 * k, 0.18, 'sine', 0.11, 0, 49 * k)
      noise(0.08, 0.1, 700, 'lowpass')
      ;[587, 740, 880].forEach((f) => tone(f * k, 0.26, 'triangle', 0.03, 0.02))
    },
    // a gold coin flies off to the medallion
    coinFly: () => {
      sweep(0.28, 0.04, 700, 3800, 'bandpass', 1.6)
      tone(2093, 0.05, 'square', 0.01, 0.02)
    },
    // the medallion stamps up to ×n: a heavy clang, a little higher each time; every fifth rings the bell too
    stamp: (n = 2) => {
      const k = 2 ** ((Math.min(n, 30) - 2) / 30)
      tone(110 * k, 0.2, 'sine', 0.13, 0, 55 * k)
      noise(0.06, 0.12, 900, 'lowpass')
      coinClang(880 * k, 0.045, 0.01)
      if (n % 5 === 0) shipBell(1047 * k, 0.04, 0.08)
    },
    // the multiplier reaches ×10, ×20...: a cannon and a brass call
    milestone: (n = 10) => {
      const s = 2 ** (((Math.min(n / 10, 4) - 1) * 2) / 12)
      cannonBoom(0.15)
      ;[523, 659, 784].forEach((f, i) => brassNote(f * s, 0.12, 0.016, 0.08 + i * 0.1))
      brassNote(1047 * s, 0.6, 0.016, 0.38)
      shipBell(1568 * s, 0.03, 0.38)
    },
    // a winner bursts: a splash and a crack of wood, a little higher along the step
    blast: (i = 0) => {
      if (!plunderGate.blast()) return
      const k = 2 ** (Math.min(i, 16) / 16)
      waterSplash(0.07)
      tone(240 * k, 0.09, 'square', 0.02, 0, 90 * k)
      noise(0.03, 0.09, 1800 * k, 'bandpass', 0.01)
    },
    // the rest fall and new symbols drop in: a woody patter
    cascade: () => {
      for (let i = 0; i < 4; i++) noise(0.03, 0.05, 700 + i * 160, 'bandpass', 0.14 + i * 0.06)
      tone(260, 0.12, 'sine', 0.035, 0.32, 150)
    },
    // a huge step: the cannon
    cannon: () => cannonBoom(0.17),
    // the maps flare for the treasure: the chest's lid creaks open on a spill of coins and a brass flourish
    treasure: () => {
      timberCreak(0.3, 0.012)
      for (let i = 0; i < 10; i++) tone(1800 + Math.random() * 1600, 0.06, 'square', 0.008, 0.25 + i * 0.045 + Math.random() * 0.02)
      ;[523, 659, 784, 1047].forEach((f, i) => brassNote(f, i === 3 ? 0.5 : 0.11, 0.015, 0.3 + i * 0.09))
      shipBell(1047, 0.035, 0.57)
    },
    // Polly digs: three spade bites into the sand, then the clunk of the chest
    dig: () => {
      for (let i = 0; i < 3; i++) {
        noise(0.11, 0.08, 1400 - i * 150, 'bandpass', i * 0.17)
        tone(180, 0.06, 'sine', 0.04, i * 0.17 + 0.02, 120)
      }
      tone(120, 0.18, 'sine', 0.1, 0.55, 70)
      noise(0.06, 0.1, 600, 'lowpass', 0.55)
    },
    // one map short: a sagging squeezebox "aww"
    nearMiss: () => {
      squeezebox(392, 0.26, 0.01)
      hold(370, 0.5, 'square', 0.01, 0.28, 294, [5, 6])
      hold(185, 0.5, 'triangle', 0.016, 0.28, 147)
    },
    // Captain Polly talks (startled 1: a little higher)
    squawk: (startled = 0) => parrotCall(startled ? 1.18 : 1),
    // the Treasure Hunt banner: a shanty brass fanfare over the timpani
    intro: () => {
      ;[0, 0.18].forEach((t) => tone(73, 0.3, 'sine', 0.13, t, 55))
      ;([[587, 0, 0.12], [740, 0.13, 0.12], [880, 0.26, 0.12], [1175, 0.39, 0.5]] as const).forEach(([f, t, d]) => brassNote(f, d, 0.017, t))
      ;[587, 740, 880].forEach((f) => tone(f, 0.9, 'triangle', 0.025, 0.4))
      noise(0.6, 0.06, 6000, 'highpass', 0.39)
      shipBell(1175, 0.03, 0.4)
    },
    // sailing into the night: a long falling whoosh, then a soft chord as the moon comes up
    night: () => {
      sweep(1.2, 0.05, 2400, 260, 'bandpass', 0.9)
      ;[294, 370, 440, 587].forEach((f, i) => tone(f, 1.6, 'sine', 0.018, 0.4 + i * 0.12, undefined, [4, 3]))
      shipBell(880, 0.025, 1.1, 1.6)
    },
    // the lanterns catch: two soft whoomps of flame
    lanterns: () =>
      [0, 0.14].forEach((t, i) => {
        swell(0.35, 0.08, 'lowpass', 520 + i * 120, 1, 0.06, t)
        tone(196 + i * 49, 0.3, 'sine', 0.03, t + 0.02, 247 + i * 49)
      }),
    // more spins: three strokes of the ship's bell
    retrigger: () => {
      ;[0, 0.22, 0.44].forEach((t) => shipBell(988, 0.04, t, 1.1))
      ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.14, 'triangle', 0.03, 0.66 + i * 0.05))
    },
    // the last free spin: a slow double drumbeat
    heartbeat: () => {
      tone(66, 0.14, 'sine', 0.11, 0, 44)
      tone(66, 0.14, 'sine', 0.1, 0.2, 44)
    },
    // a win banner passes a tier: a brass stab three semitones higher each time, a cymbal, and a cannon from Mega up
    tierUp: (k = 0) => {
      const s = 2 ** ((k * 3) / 12)
      ;[392, 494, 587, 784].forEach((f, i) => brassNote(f * s, i === 3 ? 0.42 : 0.1, 0.015, i * 0.07))
      ;[784, 988, 1175].forEach((f) => tone(f * s, 0.5, 'triangle', 0.024, 0.28))
      noise(0.5, 0.07, 6000, 'highpass', 0.28)
      if (k >= 1) cannonBoom(0.12 + k * 0.02, 0.28)
    },
    // the max win: the full brass fanfare, two cannons and the bell
    fanfare: () => {
      reverseCymbal(0.3, 0.1)
      cannonBoom(0.18, 0.3)
      ;[587, 740, 880, 1175].forEach((f, i) => brassNote(f, 0.11, 0.017, 0.3 + i * 0.09))
      ;[1175, 1480, 1760].forEach((f) => brassNote(f, 0.8, 0.011, 0.66))
      ;[587, 880].forEach((f) => tone(f, 1, 'triangle', 0.035, 0.66))
      shipBell(1175, 0.04, 0.66, 1.8)
      cannonBoom(0.14, 0.9)
    },
    // back to the sunset deck: a rising chime and a gull or two
    dawn: () => {
      ;[587, 740, 880, 1175].forEach((f, i) => tone(f, 0.3, 'sine', 0.025, i * 0.09))
      nasal(1900, 0.18, 0.02, 0.45, 1400, 2600)
      nasal(2000, 0.22, 0.018, 0.66, 1300, 2600)
    },
    // a lot of ways: the bell
    bell: () => shipBell(1319, 0.035, 0, 1.2),
    // Polly's big map flies out and unrolls over the reels: a parchment whoosh, a flap and a rising shimmer
    unfurl: () => {
      sweep(0.38, 0.05, 500, 3400, 'bandpass', 1.2)
      for (let i = 0; i < 4; i++) noise(0.05, 0.045, 1500 + i * 400, 'bandpass', 0.12 + i * 0.06)
      ;[880, 1109, 1319, 1760].forEach((f, i) => tone(f, 0.3, 'sine', 0.018, 0.2 + i * 0.05, undefined, [6, 6]))
    },
    // the X stamps down on the big map: the cannon, a brass hit and the bell
    xMarks: () => {
      cannonBoom(0.17)
      tone(92, 0.22, 'sine', 0.12, 0, 52)
      ;[587, 740, 880, 1175].forEach((f) => brassNote(f, 0.34, 0.012, 0.02))
      shipBell(1175, 0.04, 0.06, 1.6)
      noise(0.5, 0.05, 6000, 'highpass', 0.04)
    },
    // the medallion glints through a dry run of free spins: a little shimmer
    glint: () => {
      ;[2093, 2637, 3136].forEach((f, i) => tone(f, 0.22, 'sine', 0.012, i * 0.05, undefined, [7, 10]))
    },
    // the ambience and the Treasure Hunt shanty (null while muted); see PlunderBed
    bed: () => plunderBed(),
    // silent: starts the audio engine (on the first press, so its start-up cost is out of the way of the first spin)
    wake: () => void ac(),
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
  /* the Rewards page: the Lucky Wheel's pegs flicking the pointer (slowing as the wheel does), its landing and a prize
     fanfare that grows with the prize, and the claims: missions, the wheel unlocking, rakeback, tier bonuses */
  rewards: (() => {
    const g = { tick: gate(24) }
    const bell = (f: number, gain: number, delay = 0, len = 0.6) => {
      tone(f, len, 'sine', gain, delay)
      tone(f * 2.76, len * 0.5, 'sine', gain * 0.35, delay)
      tone(f * 5.4, len * 0.25, 'sine', gain * 0.15, delay)
    }
    const coins = (n: number, delay = 0, gain = 0.012) => {
      for (let i = 0; i < n; i++) {
        const f = 2200 + Math.random() * 1200
        tone(f, 0.06, 'square', gain, delay + i * 0.055 + Math.random() * 0.02)
        tone(f * 1.34, 0.1, 'sine', gain * 1.2, delay + 0.02 + i * 0.055)
      }
    }
    return {
      // a peg flicks the pointer: a woody clack, a little brighter while the wheel is fast (speed 0..1)
      tick: (speed = 0.5) => {
        if (!g.tick()) return
        const k = 0.85 + Math.min(1, Math.max(0, speed)) * 0.3
        noise(0.016, 0.08, 2600 * k, 'bandpass')
        tone(1250 * k, 0.028, 'triangle', 0.026)
        tone(380 * k, 0.045, 'sine', 0.035, 0, 300 * k)
      },
      // the spin: a ratchet as the wheel is pulled back, then air rushing as it lets go
      spin: () => {
        for (let i = 0; i < 5; i++) noise(0.02, 0.06, 1900 + i * 320, 'bandpass', i * 0.04)
        sweep(0.8, 0.06, 350, 2400, 'bandpass', 1.1, 0.2)
        tone(200, 0.55, 'triangle', 0.025, 0.2, 640)
      },
      // the pointer drops into the winning slot: a soft clack and a bell
      land: () => {
        tone(170, 0.12, 'sine', 0.08, 0, 105)
        noise(0.03, 0.07, 1700, 'bandpass')
        bell(1319, 0.035, 0.06, 0.7)
      },
      // the prize, by size: a chime for a small one, an arpeggio and coins for a middling one, a sparkling run for 300,
      // and brass over a cymbal swell for 500 and the 1,000
      prize: (amount = 100) => {
        if (amount < 150) {
          ;[784, 988, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.045, i * 0.07))
          coins(3, 0.2)
          return
        }
        ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.05, i * 0.07))
        coins(amount >= 300 ? 8 : 5, 0.24)
        if (amount >= 300) [1568, 1976, 2349, 3136].forEach((f, i) => tone(f, 0.5, 'sine', 0.016, 0.34 + i * 0.06, undefined, [6, 8]))
        if (amount >= 500) {
          noise(0.7, 0.05, 6000, 'highpass', 0.3)
          ;[392, 523, 659].forEach((f, i) => hold(f, 0.14, 'sawtooth', 0.014, 0.42 + i * 0.12))
          ;[523, 659, 784, 1047].forEach((f) => hold(f, amount >= 1000 ? 1.3 : 0.8, 'sawtooth', 0.011, 0.8, f, [5, 4]))
          tone(65, 1, 'sine', 0.09, 0.8, 49)
        }
        if (amount >= 1000) {
          coins(10, 0.9, 0.011)
          ;[2093, 2637, 3136, 4186].forEach((f, i) => tone(f, 1, 'sine', 0.012, 1 + i * 0.07, undefined, [6, 9]))
        }
      },
      // a mission claimed: two bright bells and a coin
      mission: () => {
        bell(1047, 0.04)
        bell(1568, 0.04, 0.09)
        coins(2, 0.16)
      },
      // the third mission claimed: the wheel unlocks with a shimmer rising to a bright chord
      unlock: () => {
        sweep(0.55, 0.05, 600, 5200, 'bandpass', 1.6)
        ;[659, 784, 988, 1319, 1568, 1976].forEach((f, i) => tone(f, 0.18, 'triangle', 0.035, 0.08 + i * 0.05))
        ;[1319, 1661, 1976].forEach((f) => tone(f, 0.9, 'sine', 0.016, 0.42, undefined, [6, 9]))
      },
      // rakeback paid: coins trickling back, falling a little in pitch, then a soft bell
      rakeback: () => {
        for (let i = 0; i < 6; i++) {
          const f = 2900 - i * 160
          tone(f, 0.05, 'square', 0.012, i * 0.06)
          tone(f * 1.34, 0.09, 'sine', 0.014, 0.02 + i * 0.06)
        }
        bell(988, 0.03, 0.38, 0.5)
      },
      // a VIP tier's bonus: a regal brass flourish over a low drum
      tier: () => {
        tone(73, 0.5, 'sine', 0.1, 0, 55)
        ;[392, 523, 659].forEach((f, i) => hold(f, 0.13, 'sawtooth', 0.016, i * 0.11))
        ;[523, 659, 784, 1047].forEach((f) => hold(f, 0.9, 'sawtooth', 0.012, 0.36, f, [5, 4]))
        ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.8, 'sine', 0.014, 0.42 + i * 0.06, undefined, [6, 9]))
        coins(6, 0.4)
      },
      // the wheel's prize taken, or Claim all: coins poured into the purse, more for more rewards
      collect: (n = 1) => {
        tone(1568, 0.06, 'square', 0.03)
        tone(2093, 0.12, 'square', 0.03, 0.06)
        coins(Math.min(12, 3 + n * 2), 0.1)
      },
    }
  })(),
  /**
   * Craps' sounds: clay chips on felt, the dice rattled in the shooter's hand and let go, their knocks down the table
   * (a muffled thud on the felt, a padded knock on the rail, a hard clack off the rubber pyramids, a click die on
   * die), the stickman's stick, the puck, a little melodic sting for each call, the dealer's sweep and payout, the
   * wins by tier and the Fire Bet catching light.
   */
  craps: (() => {
    const g = { felt: gate(32), wall: gate(30), back: gate(26), die: gate(28), chip: gate(30), count: gate(45), knock: gate(40) }
    /** a marimba-ish note: a sine with a quick knock of its octave on top */
    const mallet = (f: number, gain: number, delay = 0, len = 0.32) => {
      tone(f, len, 'sine', gain, delay)
      tone(f * 4, 0.05, 'sine', gain * 0.35, delay)
      tone(f * 2, len * 0.6, 'triangle', gain * 0.25, delay)
    }
    return {
      // a chip set on a spot: a clay clack on felt
      chip: () => {
        if (!g.chip()) return
        noise(0.022, 0.1, 3300, 'bandpass')
        tone(2300, 0.03, 'triangle', 0.015)
        tone(1600, 0.05, 'sine', 0.018, 0.016)
      },
      // a chip taken back off: the same clack, softer, sliding away
      remove: () => {
        noise(0.03, 0.06, 2100, 'bandpass')
        tone(1450, 0.07, 'sine', 0.016, 0, 1000)
      },
      // a chip the table won't take
      nope: () => tone(233, 0.1, 'triangle', 0.045, 0, 165),
      // the stickman's stick pushes the dice back over the felt
      collect: () => {
        sweep(0.55, 0.022, 900, 320, 'lowpass', 0.7)
        noise(0.05, 0.035, 1500, 'bandpass', 0.46)
        tone(1250, 0.03, 'triangle', 0.008, 0.48)
      },
      // the dice rattled in the shooter's closed hand: a quick run of knocks, then the hand opens
      shake: (dur = 0.42) => {
        const n = Math.max(4, Math.round(dur / 0.05))
        for (let i = 0; i < n; i++) {
          const t = i * (dur / n) + Math.random() * 0.012
          noise(0.014, 0.045 + Math.random() * 0.035, 2400 + Math.random() * 1600, 'bandpass', t)
          if (i % 2) tone(1300 + Math.random() * 600, 0.022, 'triangle', 0.007, t)
        }
      },
      // the dice leave the hand: a soft whoosh
      release: () => sweep(0.3, 0.028, 450, 2300, 'bandpass', 1.1),
      // a knock (k 0-1, how hard): the felt, the padded rail, the rubber pyramids of the backboard, the other die
      hit: (on: 'felt' | 'wall' | 'back' | 'die', k: number) => {
        if (k < 0.06) return
        if (on === 'felt') {
          if (!g.felt()) return
          noise(0.05, 0.03 + 0.09 * k, 480, 'lowpass')
          tone(140, 0.06, 'sine', 0.012 + 0.03 * k, 0, 85)
        } else if (on === 'wall') {
          if (!g.wall()) return
          noise(0.03, 0.04 + 0.08 * k, 900, 'lowpass')
          tone(310 + Math.random() * 60, 0.07, 'triangle', 0.012 + 0.025 * k, 0, 200)
        } else if (on === 'back') {
          if (!g.back()) return
          noise(0.016, 0.06 + 0.12 * k, 3000 + Math.random() * 1200, 'bandpass')
          tone(720 + Math.random() * 160, 0.05, 'square', 0.006 + 0.014 * k, 0, 520)
          tone(190, 0.07, 'sine', 0.02 + 0.03 * k, 0.004, 120)
        } else {
          if (!g.die()) return
          noise(0.016, 0.04 + 0.1 * k, 2700 + Math.random() * 900, 'bandpass')
          tone(1300 + Math.random() * 450, 0.034, 'triangle', 0.01 + 0.022 * k)
        }
      },
      // the dice lie still and can be read
      settle: () => {
        tone(98, 0.16, 'sine', 0.045, 0, 70)
        tone(1175, 0.3, 'sine', 0.012, 0.04)
      },
      // the dealer sets the puck down, flipped ON or OFF
      puck: (on: boolean) => {
        if (!g.knock()) return
        noise(0.02, 0.08, 1700, 'bandpass')
        tone(on ? 920 : 620, 0.05, 'triangle', 0.02)
        tone(240, 0.09, 'sine', 0.035, 0.012, 170)
      },
      // the stickman's call, as a little sting: a natural rises, craps sags, the point is marked with two firm notes,
      // a point made gets a fanfare, a seven-out falls away; any other roll a single note by its total (a pair
      // sparkles)
      call: (event: 'natural' | 'craps' | 'point-set' | 'point-made' | 'seven-out' | 'roll', total: number, hard: boolean) => {
        switch (event) {
          case 'natural':
            ;[659, 831, 988, 1319].forEach((f, i) => mallet(f, 0.04, i * 0.065))
            break
          case 'craps':
            mallet(392, 0.045)
            mallet(370, 0.04, 0.13)
            tone(185, 0.4, 'triangle', 0.03, 0.26, 150)
            break
          case 'point-set':
            mallet(523, 0.045)
            mallet(784, 0.05, 0.12, 0.45)
            break
          case 'point-made':
            ;[523, 659, 784].forEach((f, i) => mallet(f, 0.045, i * 0.07))
            ;[523, 659, 784, 1047].forEach((f) => hold(f, 0.7, 'triangle', 0.012, 0.24, undefined, [5, 3]))
            break
          case 'seven-out':
            ;[659, 523, 440, 349].forEach((f, i) => mallet(f, 0.042, i * 0.11, 0.4))
            tone(87, 0.6, 'sine', 0.06, 0.4, 60)
            break
          default:
            mallet(330 * 2 ** ((total - 2) / 12), 0.035)
            if (hard) [1568, 2093, 2637].forEach((f, i) => tone(f, 0.22, 'sine', 0.012, 0.08 + i * 0.05))
        }
      },
      // the dealer sweeps the losing chips off to the house
      sweep: () => {
        sweep(0.34, 0.04, 2500, 800, 'bandpass', 1.2)
        ;[2800, 2400].forEach((f, i) => tone(f, 0.03, 'square', 0.009, 0.1 + i * 0.09))
      },
      // winnings slide in beside the winning stakes: a run of chip clicks
      pay: () => {
        noise(0.2, 0.035, 1600, 'bandpass')
        ;[2700, 3150, 2900, 3300].forEach((f, i) => tone(f, 0.03, 'square', 0.011, 0.06 + i * 0.055))
      },
      // the win, by tier: 0 a plain win (bigger for a win over the stakes), 1 Big, 2 Huge, 3 Massive
      win: (tier: number) => {
        if (tier <= 0) {
          ;[784, 988, 1175].forEach((f, i) => tone(f, 0.24, 'triangle', 0.045, i * 0.07))
          tone(2349, 0.45, 'sine', 0.011, 0.22)
          return
        }
        if (tier >= 3) reverseCymbal(0.6, 0.05)
        const lead = tier >= 3 ? 0.6 : 0
        ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, 'triangle', 0.06, lead + i * 0.07))
        ;[523, 659, 784, 1047].forEach((f) => hold(f, 0.9 + tier * 0.3, 'triangle', 0.016, lead + 0.36, undefined, [5, 3]))
        ;[2093, 2637, 3136].forEach((f, i) => tone(f, 0.9, 'sine', 0.01, lead + 0.42 + i * 0.08, undefined, [6, 8]))
        if (tier >= 2) tone(65, 1.2, 'sine', 0.1, lead + 0.34, 46)
      },
      // a big win counted up (p 0-1): ticks that climb
      count: (p: number) => {
        if (!g.count()) return
        tone(1150 + p * 900, 0.04, 'square', 0.011)
      },
      // a point made lights the Fire Bet's square (n: points made so far, 1-6): a flame's whoosh and a bell that
      // climbs with every point; the payouts get a roar
      fire: (n: number) => {
        sweep(0.45, 0.03 + 0.008 * n, 300, 2600, 'bandpass', 0.9)
        crackle(0.3 + 0.05 * n, 0.012 + 0.003 * n, 0.05)
        const f = 587 * 2 ** ([0, 2, 4, 7, 9, 12][Math.max(0, Math.min(5, n - 1))] / 12)
        tone(f, 0.6, 'sine', 0.025, 0.08, undefined, [6, 6])
        tone(f * 1.5, 0.5, 'sine', 0.012, 0.12)
        if (n >= 4) {
          noise(0.9, 0.05, 260, 'lowpass', 0.1)
          ;[1047, 1319, 1568, 2093].forEach((x, i) => tone(x, 0.7, 'sine', 0.012, 0.2 + i * 0.06, undefined, [6, 7]))
        }
      },
    }
  })(),
  /* lucky lines: the reels' whirr and wooden stops (a shimmer rising under a teased one), the dauber's stamp (higher
     the fuller its line), a chime run for a line and a brassy step up the ladder, the jester's bells for a Joker
     (golden ones for a Super Joker), a torn ticket for a free spin, a coin for a bought spin, coins for the collect
     and the big wins by tier. Its own compressor, like Pop Party's, so five stops, daubs and a chime at once never
     clip; the voices here are local so nothing else is routed through it. */
  lines: (() => {
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
  })(),
  /* sic bo: clay chips on the felt, the crack and thunder of the lucky strikes, the dome's rattle and every knock of
     the dice on the glass, the felt and each other, the dealer's sweep and payout, and the wins by tier */
  sicbo: (() => {
    const g = { glass: gate(28), clack: gate(24), felt: gate(30), kick: gate(60), count: gate(45), chip: gate(30) }
    return {
      // a chip set on a spot: a clay clack
      chip: () => {
        if (!g.chip()) return
        noise(0.022, 0.1, 3600, 'bandpass')
        tone(2450, 0.032, 'triangle', 0.016)
        tone(1700, 0.05, 'sine', 0.018, 0.016)
      },
      // a chip taken back off: the same clack, softer, sliding away
      remove: () => {
        noise(0.03, 0.06, 2200, 'bandpass')
        tone(1500, 0.07, 'sine', 0.016, 0, 1050)
      },
      // a chip the table won't take
      nope: () => tone(233, 0.1, 'triangle', 0.045, 0, 165),
      // the roll pressed: a firm thunk on the pedestal and the hum of the lightning gathering
      roll: () => {
        tone(110, 0.16, 'sine', 0.09, 0, 70)
        noise(0.05, 0.07, 700, 'lowpass')
        sweep(0.5, 0.018, 500, 2600, 'bandpass', 2.5, 0.04)
      },
      // a lucky strike (×2 to ×25): the crack, the crackle, a gold ting that climbs with the multiplier, the thunder
      strike: (mult: number) => {
        const k = Math.max(0, Math.min(1, Math.log(mult / 2) / Math.log(12.5)))
        noise(0.05, 0.15 + 0.1 * k, 5200, 'highpass')
        noise(0.08, 0.07 + 0.08 * k, 1800, 'bandpass', 0.01)
        crackle(0.16 + 0.26 * k, 0.035 + 0.03 * k, 0.02)
        const f = 880 * 2 ** (Math.round(k * 12) / 12)
        tone(f, 0.5, 'sine', 0.028 + 0.02 * k, 0.05)
        tone(f * 1.5, 0.42, 'sine', 0.013 + 0.012 * k, 0.08)
        // the thunder rolls in a beat later, longer and deeper for the big ones
        noise(0.55 + 0.9 * k, 0.06 + 0.09 * k, 170 + 130 * k, 'lowpass', 0.07)
        tone(55, 0.45 + 0.6 * k, 'sine', 0.05 + 0.07 * k, 0.07, 36)
        if (mult >= 20) {
          ;[1047, 1319, 1568, 2093].forEach((n, i) => tone(n, 0.7, 'sine', 0.014, 0.16 + i * 0.05, undefined, [6, 7]))
          tone(41, 1.1, 'sine', 0.1, 0.1, 30)
        }
      },
      // the dome's rattle while it is shaken: glass and dice chattering, swelled by each kick; kick(k), stop()
      rattle: () => {
        const a = ac()
        if (!a) return null
        const buf = a.createBuffer(1, a.sampleRate, a.sampleRate)
        const d = buf.getChannelData(0)
        // sparse ticks over a low hiss rather than plain noise: things knocking about, not wind
        for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.004 ? Math.random() * 2 - 1 : (Math.random() * 2 - 1) * 0.07
        const src = a.createBufferSource()
        src.buffer = buf
        src.loop = true
        const bp = a.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 3000
        bp.Q.value = 0.7
        const v = a.createGain()
        v.gain.value = 0
        src.connect(bp).connect(v).connect(out(a))
        src.start()
        v.gain.setTargetAtTime(0.03, a.currentTime, 0.05)
        let stopped = false
        return {
          kick: (k: number) => {
            if (stopped) return
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setValueAtTime(v.gain.value, n)
            v.gain.linearRampToValueAtTime(0.04 + 0.08 * k, n + 0.02)
            v.gain.setTargetAtTime(0.018, n + 0.05, 0.3)
          },
          stop: () => {
            if (stopped) return
            stopped = true
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setValueAtTime(v.gain.value, n)
            v.gain.linearRampToValueAtTime(0, n + 0.3)
            src.stop(n + 0.35)
          },
        }
      },
      // the pedestal kicks the dome: a dull jolt through the wood (k 0-1)
      kick: (k: number) => {
        if (!g.kick()) return
        tone(78, 0.13, 'sine', 0.05 + 0.06 * k, 0, 48)
        noise(0.06, 0.025 + 0.04 * k, 480, 'lowpass')
      },
      // a die knocks the glass (a bright tick that rings), another die (a hard clack) or the felt (a muffled thud)
      knock: (on: 'glass' | 'die' | 'floor', k: number) => {
        if (k < 0.07) return
        if (on === 'glass') {
          if (!g.glass()) return
          const f = 2500 + Math.random() * 900
          tone(f, 0.08 + 0.14 * k, 'sine', 0.01 + 0.028 * k)
          tone(f * 2.71, 0.05 + 0.06 * k, 'sine', 0.005 + 0.011 * k)
          noise(0.012, 0.02 + 0.05 * k, 6000, 'highpass')
        } else if (on === 'die') {
          if (!g.clack()) return
          noise(0.018, 0.04 + 0.1 * k, 2500 + Math.random() * 900, 'bandpass')
          tone(1250 + Math.random() * 450, 0.035, 'triangle', 0.01 + 0.024 * k)
        } else {
          if (!g.felt()) return
          noise(0.045, 0.03 + 0.08 * k, 520, 'lowpass')
          tone(150, 0.06, 'sine', 0.014 + 0.03 * k, 0, 90)
        }
      },
      // the dice lie still and can be read: a soft settling thunk and a small chime
      settle: () => {
        tone(98, 0.18, 'sine', 0.05, 0, 70)
        tone(1175, 0.36, 'sine', 0.018, 0.04)
        tone(1568, 0.42, 'sine', 0.011, 0.1)
      },
      // the dealer sweeps the losing chips off to the house
      sweep: () => {
        sweep(0.34, 0.045, 2600, 800, 'bandpass', 1.2)
        ;[2900, 2450].forEach((f, i) => tone(f, 0.03, 'square', 0.01, 0.1 + i * 0.09))
      },
      // winnings slide in beside the winning stakes: a run of chip clicks
      pay: () => {
        noise(0.2, 0.04, 1600, 'bandpass')
        ;[2700, 3150, 2900, 3300].forEach((f, i) => tone(f, 0.03, 'square', 0.012, 0.06 + i * 0.055))
      },
      // the win, by tier: 0 a plain win, 1 Big, 2 Huge, 3 Legendary
      win: (tier: number) => {
        if (tier <= 0) {
          ;[784, 988, 1175].forEach((f, i) => tone(f, 0.26, 'triangle', 0.05, i * 0.07))
          tone(2349, 0.5, 'sine', 0.012, 0.22)
          return
        }
        if (tier >= 3) reverseCymbal(0.6, 0.05)
        const lead = tier >= 3 ? 0.6 : 0
        ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, 'triangle', 0.06, lead + i * 0.07))
        ;[523, 659, 784, 1047].forEach((f) => hold(f, 0.9 + tier * 0.3, 'triangle', 0.016, lead + 0.36, undefined, [5, 3]))
        ;[2093, 2637, 3136].forEach((f, i) => tone(f, 0.9, 'sine', 0.01, lead + 0.42 + i * 0.08, undefined, [6, 8]))
        if (tier >= 2) tone(65, 1.2, 'sine', 0.1, lead + 0.34, 46)
      },
      // a big win counted up (p 0-1): ticks that climb
      count: (p: number) => {
        if (!g.count()) return
        tone(1150 + p * 900, 0.04, 'square', 0.011)
      },
      // lightning strikes a spot holding the player's chips: the chips jump with a jingle and a bright run climbs
      // over the strike's thunder (higher and longer for the bigger multipliers)
      mine: (mult: number) => {
        const k = Math.max(0, Math.min(1, Math.log(mult / 2) / Math.log(12.5)))
        ;[2950, 3400, 3150].forEach((f, i) => tone(f, 0.035, 'square', 0.011, 0.1 + i * 0.045))
        const run = k > 0.6 ? [784, 988, 1175, 1568, 1976] : [784, 988, 1175, 1568]
        run.forEach((f, i) => tone(f * (1 + k * 0.12), 0.22, 'triangle', 0.03, 0.14 + i * 0.06))
        tone(2349 * (1 + k * 0.12), 0.5 + 0.3 * k, 'sine', 0.012, 0.14 + run.length * 0.06, undefined, [6, 7])
      },
    }
  })(),
  /**
   * Reef Raid's sounds. Holding the trigger fires five torpedoes a second and a bomb blast can pop a dozen catches
   * into coin showers at once, so, like Plunder Bay's and Pop Party's, these play through a compressor of their own
   * (the voices below route to it themselves) and the dense ones are rate-limited. Everything sits a little muffled,
   * as if heard underwater. ambience() is the quiet bed under the reef.
   */
  reef: (() => {
    let busCtx: AudioContext | null = null
    let bus: AudioNode | null = null
    const reefOut = (a: AudioContext) => {
      if (!bus || busCtx !== a) {
        const c = a.createDynamicsCompressor()
        c.threshold.value = -16
        c.knee.value = 10
        c.ratio.value = 4.5
        c.attack.value = 0.003
        // opens instantly for its first moments (see the party bus), then settles to the real release
        c.release.value = 0
        c.release.setValueAtTime(0.16, a.currentTime + 0.06)
        const trim = a.createGain()
        trim.gain.value = 0.7
        c.connect(trim).connect(a.destination)
        bus = c
        busCtx = a
      }
      return bus
    }
    /** a note: an oscillator with a quick attack and a falling tail (sliding to `slideTo`, wobbling by `vib`) */
    const tn = (f: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number, vib?: [number, number]) => {
      const a = ac()
      if (!a) return
      const t = a.currentTime + delay
      const o = osc(a, t, f, dur, type, slideTo, vib)
      const g = a.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(g).connect(reefOut(a))
    }
    /** a brass note: two sawtooths a hair apart, rounded off by a lowpass, held until a short release */
    const brass = (f: number, dur: number, gain: number, delay = 0, bright = 2200) => {
      const a = ac()
      if (!a) return
      const t = a.currentTime + delay
      const lp = a.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(bright * 0.45, t)
      lp.frequency.linearRampToValueAtTime(bright, t + 0.06)
      const g = a.createGain()
      const rel = Math.min(0.14, dur * 0.35)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(gain, t + 0.03)
      g.gain.setValueAtTime(gain, t + dur - rel)
      g.gain.linearRampToValueAtTime(0, t + dur)
      osc(a, t, f, dur, 'sawtooth', undefined, [5, 3]).connect(lp)
      osc(a, t, f * 1.004, dur, 'sawtooth').connect(lp)
      lp.connect(g).connect(reefOut(a))
    }
    // two seconds of white noise, made once per audio context and shared by every noisy sound below (each plays it
    // from a random spot), so a held trigger doesn't fill a fresh buffer for every shot, net and crackle
    let noiseCtx: AudioContext | null = null
    let noiseBuf: AudioBuffer | null = null
    const noise = (a: AudioContext, t: number, dur: number) => {
      if (!noiseBuf || noiseCtx !== a) {
        noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
        const d = noiseBuf.getChannelData(0)
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
        noiseCtx = a
      }
      const s = a.createBufferSource()
      s.buffer = noiseBuf
      s.loop = true
      s.start(t, Math.random() * 1.9)
      s.stop(t + dur + 0.02)
      return s
    }
    /** a burst of noise through a filter, falling away */
    const nz = (dur: number, gain: number, freq: number, kind: BiquadFilterType = 'lowpass', delay = 0, q = 1) => {
      const a = ac()
      if (!a) return
      const t = a.currentTime + delay
      const f = a.createBiquadFilter()
      f.type = kind
      f.frequency.value = freq
      f.Q.value = q
      // a fall that bows like (1 - t)²: a quarter left halfway, silence at the end
      const g = a.createGain()
      g.gain.setValueAtTime(gain, t)
      g.gain.linearRampToValueAtTime(gain * 0.25, t + dur * 0.5)
      g.gain.linearRampToValueAtTime(0, t + dur)
      noise(a, t, dur).connect(f).connect(g).connect(reefOut(a))
    }
    /** noise whose filter glides from f0 to f1 Hz: a whoosh, a splash */
    const sw = (dur: number, gain: number, f0: number, f1: number, kind: BiquadFilterType = 'bandpass', q = 1, delay = 0) => {
      const a = ac()
      if (!a) return
      const t = a.currentTime + delay
      const f = a.createBiquadFilter()
      f.type = kind
      f.frequency.setValueAtTime(f0, t)
      f.Q.value = q
      noise(a, t, dur).connect(f)
      f.frequency.exponentialRampToValueAtTime(f1, t + dur)
      const g = a.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.25)
      g.gain.linearRampToValueAtTime(0, t + dur)
      f.connect(g).connect(reefOut(a))
    }
    /** a bubble: a sine ringing upwards as it leaves, the way a real one sounds */
    const bub = (f: number, gain: number, delay = 0) => tn(f, 0.05 + Math.random() * 0.04, 'sine', gain, delay, f * (1.7 + Math.random() * 0.5))
    /** electric crackle: a scatter of tiny bright ticks over `dur` seconds */
    const crack = (dur: number, gain: number, delay = 0) => {
      const n = Math.max(3, Math.round(dur / 0.016))
      for (let i = 0; i < n; i++) nz(0.006 + Math.random() * 0.01, gain * (0.4 + Math.random() * 0.6), 2400 + Math.random() * 4800, 'bandpass', delay + (i / n) * dur + Math.random() * 0.01, 1.4)
    }
    /** a twinkle of high notes */
    const sparkle = (n: number, gain: number, delay = 0) => {
      for (let i = 0; i < n; i++) tn(2600 + Math.random() * 2200, 0.09, 'sine', gain, delay + i * (0.03 + Math.random() * 0.03))
    }
    /** a G major pentatonic over three octaves: catches climb it by value */
    const STEP = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36]
    const note = (n: number) => 392 * 2 ** (STEP[Math.max(0, Math.min(STEP.length - 1, Math.round(n)))] / 12)
    /** how far up the value scale a catch is: 0 for 2×, 1 for the whale's 200× */
    const weight = (mult: number) => Math.max(0, Math.min(1, Math.log2(Math.max(2, mult) / 2) / Math.log2(100)))

    // the bed's level, which the big moments dip for a while (only while a bed is playing)
    let bedLevel: GainNode | null = null
    const duck = (sec: number, db = -9) => {
      const a = ac()
      if (!a || !bedLevel) return
      const n = a.currentTime
      const p = bedLevel.gain
      const low = 10 ** (db / 20)
      p.cancelScheduledValues(n)
      p.setValueAtTime(p.value, n)
      p.linearRampToValueAtTime(low, n + 0.06)
      p.setValueAtTime(low, n + 0.06 + sec)
      p.linearRampToValueAtTime(1, n + 0.06 + sec + 1.2)
    }

    const g = { shot: gate(40), net: gate(45), flinch: gate(70), catch: gate(60), coin: gate(36), zap: gate(40), bounce: gate(80), fizzle: gate(90), tick: gate(26), lock: gate(120), level: gate(35), broke: gate(450), win: gate(150) }
    let awake: AudioContext | null = null
    return {
      /**
       * Call from a press on the reef: creates and wakes the audio inside the gesture with a silent blip. iOS only lets
       * audio start in one, and the reef's own sounds all start from its animation frame, outside any gesture.
       */
      unlock: () => {
        const a = ac()
        if (!a || awake === a) return
        const s = a.createBufferSource()
        s.buffer = a.createBuffer(1, 1, a.sampleRate)
        s.connect(a.destination)
        s.start()
        if (a.state === 'running') awake = a
      },
      /** the cannon fires: a round bubble bloop over a soft thump, a touch deeper for each bigger cannon */
      shot: (level = 0) => {
        if (!g.shot()) return
        const k = 1 - Math.min(6, level) * 0.055
        tn(290 * k, 0.1, 'sine', 0.07, 0, 700 * k)
        tn(150 * k, 0.13, 'sine', 0.05 + level * 0.006, 0, 62 * k)
        nz(0.05, 0.035, 1100, 'lowpass')
        bub(950 + Math.random() * 300, 0.016, 0.05)
      },
      /** a torpedo bursts into a net: a soft splash, a swish of rope and a few bubbles */
      net: (value = 2) => {
        if (!g.net()) return
        const w = weight(value)
        sw(0.24, 0.05, 2400, 480, 'bandpass', 0.9)
        nz(0.1, 0.05 + w * 0.03, 420 - w * 120, 'lowpass')
        for (let i = 0; i < 3; i++) bub(650 + Math.random() * 900, 0.013, 0.03 + i * 0.045)
      },
      /** it wriggled free: a comic wobble, lower for the big ones */
      flinch: (value = 2) => {
        if (!g.flinch()) return
        const k = 1.2 - weight(value) * 0.55
        tn(560 * k, 0.17, 'triangle', 0.026, 0, 370 * k, [22, 32 * k])
      },
      /** caught: a jingle that starts higher and runs longer the more the catch is worth */
      catch: (value = 2) => {
        if (!g.catch()) return
        const w = weight(value)
        const base = Math.round(w * 6)
        const n = 3 + Math.round(w * 4)
        for (let i = 0; i < n; i++) {
          tn(note(base + i), 0.17, 'triangle', 0.034, i * 0.055)
          tn(note(base + i) * 2, 0.1, 'sine', 0.011, i * 0.055 + 0.012)
        }
        if (w > 0.5) sparkle(5, 0.008, n * 0.055)
      },
      /** a coin drops into the cannon: a small bright tick (the scene sends at most ~22 a second) */
      coin: (i = 0) => {
        if (!g.coin()) return
        const f = 2350 + Math.random() * 800 + (i % 6) * 70
        tn(f, 0.05, 'sine', 0.013)
        tn(f * 1.5, 0.035, 'sine', 0.005, 0.008)
      },
      /** the bomb crab: a deep boom muffled by the water, the shock wave, then a storm of bubbles */
      boom: (n = 0) => {
        duck(1.4, -12)
        tn(80, 0.95, 'sine', 0.24, 0, 31)
        tn(47, 1.2, 'sine', 0.15, 0.02, 27)
        nz(0.9, 0.26, 240, 'lowpass')
        nz(0.22, 0.12, 900, 'lowpass')
        sw(1.1, 0.055, 1800, 280, 'bandpass', 0.7, 0.05)
        for (let i = 0, k = 12 + Math.min(10, n * 2); i < k; i++) bub(380 + Math.random() * 1400, 0.011, 0.18 + Math.random() * 1)
      },
      /** the zap jelly's lightning reaches link i: a crackle and a buzz, each link a step higher */
      zap: (i = 0) => {
        if (!g.zap()) return
        const k = 2 ** ((Math.min(i, 8) * 2) / 12)
        crack(0.14, 0.05)
        tn(1300 * k, 0.13, 'sawtooth', 0.011, 0, 480 * k, [60, 40])
        tn(160 * k, 0.11, 'square', 0.009, 0, 110)
      },
      /** the treasure chest pops its lid: a wooden knock and a rising sparkle */
      chest: () => {
        tn(190, 0.09, 'triangle', 0.06, 0, 120)
        nz(0.04, 0.08, 1500, 'bandpass')
        ;[0, 1, 2, 3, 4, 5].forEach((n, i) => tn(note(n + 4), 0.22, 'sine', 0.026, 0.08 + i * 0.05))
        sparkle(8, 0.009, 0.3)
      },
      /** the treasure wheel's pointer clicking past a peg */
      tick: () => {
        if (!g.tick()) return
        tn(1550, 0.028, 'square', 0.011)
        nz(0.014, 0.03, 3200, 'highpass')
      },
      /** the wheel lands on its segment (20× to 150×): a fanfare that grows with it */
      wheelWin: (mult = 20) => {
        duck(2.2, -12)
        const big = mult >= 80
        const CH = [
          [392, 494, 587],
          [440, 554, 659],
          [523, 659, 784],
        ]
        CH.forEach((ch, i) => ch.forEach((f) => brass(f, 0.16, 0.016, i * 0.13)))
        CH[2].forEach((f) => brass(f, big ? 1.3 : 0.9, 0.018, 0.42, 2600))
        tn(98, 0.9, 'sine', 0.12, 0.42, 65)
        sparkle(big ? 18 : 10, 0.01, 0.45)
        if (big) {
          ;[1047, 1319, 1568, 2093].forEach((f, i) => tn(f, 0.3, 'triangle', 0.024, 0.9 + i * 0.08))
          tn(2093, 1.1, 'sine', 0.014, 1.25, 2093, [6, 8])
        }
      },
      /** a big catch bursts into coins (tier 1: 10×+, 2: 30×+, 3: 100×+): a fanfare to match */
      win: (tier = 1) => {
        if (tier < 1 || !g.win()) return
        duck(1 + tier * 0.8, -10)
        if (tier === 1) {
          ;[784, 988, 1175, 1568].forEach((f, i) => tn(f, 0.22, 'triangle', 0.03, i * 0.06))
          sparkle(6, 0.008, 0.22)
          return
        }
        const lead = tier >= 3 ? 0.55 : 0
        if (tier >= 3) sw(0.6, 0.05, 1500, 9000, 'highpass', 0.7)
        ;[523, 659, 784].forEach((f) => brass(f, 0.18, 0.016, lead))
        ;[587, 740, 880].forEach((f) => brass(f, 0.18, 0.016, lead + 0.17))
        ;[659, 831, 988].forEach((f) => brass(f, tier >= 3 ? 1.5 : 1, 0.019, lead + 0.34, 2800))
        tn(82, 1, 'sine', 0.14, lead + 0.34, 55)
        sparkle(10 + tier * 6, 0.01, lead + 0.36)
        if (tier >= 3) {
          // the Golden Whale's own encore: the same call an octave up, bells over it
          ;[1319, 1661, 1976, 2637].forEach((f, i) => tn(f, 0.4, 'triangle', 0.022, lead + 1.2 + i * 0.1))
          tn(41, 1.6, 'sine', 0.16, lead + 1.2, 30)
        }
      },
      /** "Golden Whale incoming!": a long whale call, then a brass sting */
      whale: () => {
        const a = ac()
        if (!a) return
        duck(4, -12)
        const t = a.currentTime
        // the call: a sawtooth through a vowel-ish bandpass, gliding up and sighing down
        for (const [k, gain] of [
          [1, 0.05],
          [1.5, 0.02],
        ] as const) {
          const o = a.createOscillator()
          o.type = 'sawtooth'
          o.frequency.setValueAtTime(150 * k, t)
          o.frequency.linearRampToValueAtTime(260 * k, t + 0.7)
          o.frequency.exponentialRampToValueAtTime(120 * k, t + 1.9)
          const lfo = a.createOscillator()
          const depth = a.createGain()
          lfo.frequency.value = 5.5
          depth.gain.value = 6 * k
          lfo.connect(depth).connect(o.frequency)
          const bp = a.createBiquadFilter()
          bp.type = 'bandpass'
          bp.frequency.value = 520
          bp.Q.value = 1.6
          const v = a.createGain()
          v.gain.setValueAtTime(0, t)
          v.gain.linearRampToValueAtTime(gain, t + 0.35)
          v.gain.setValueAtTime(gain, t + 1.3)
          v.gain.linearRampToValueAtTime(0, t + 2)
          o.connect(bp).connect(v).connect(reefOut(a))
          o.start(t)
          lfo.start(t)
          o.stop(t + 2.05)
          lfo.stop(t + 2.05)
        }
        // the sting: two short stabs and a long gold chord, a timpani under it
        ;[0, 0.16].forEach((d) => [294, 370, 440].forEach((f) => brass(f, 0.12, 0.016, 1.2 + d)))
        ;[392, 494, 587, 784].forEach((f) => brass(f, 1.2, 0.017, 1.52, 2600))
        tn(73, 1.3, 'sine', 0.16, 1.52, 49)
        sparkle(12, 0.009, 1.6)
      },
      /** the tide sweeps across the reef: a long rushing whoosh with bubbles tumbling in it */
      tide: () => {
        duck(2, -8)
        sw(1.7, 0.09, 220, 2400, 'bandpass', 0.6)
        sw(1.4, 0.05, 3200, 520, 'bandpass', 0.8, 0.45)
        nz(1.2, 0.05, 300, 'lowpass', 0.2)
        for (let i = 0; i < 14; i++) bub(500 + Math.random() * 1300, 0.01, 0.2 + Math.random() * 1.3)
      },
      /** a torpedo bounces off the edge of the field */
      bounce: () => {
        if (!g.bounce()) return
        tn(820, 0.05, 'sine', 0.016, 0, 600)
      },
      /** a torpedo fizzles out: a couple of tiny bubbles */
      fizzle: () => {
        if (!g.fizzle()) return
        bub(1200, 0.01)
        bub(1600, 0.008, 0.05)
      },
      /** a creature locked: a sonar ping, twice */
      lock: () => {
        if (!g.lock()) return
        tn(1480, 0.18, 'sine', 0.03)
        tn(2220, 0.22, 'sine', 0.022, 0.09)
        tn(2220, 0.22, 'sine', 0.008, 0.26)
      },
      /** the cannon level steps up or down (0-6): a click that rises with it */
      level: (i = 0) => {
        if (!g.level()) return
        const f = 520 * 2 ** (Math.min(6, Math.max(0, i)) / 9)
        tn(f, 0.05, 'triangle', 0.035)
        tn(f * 1.5, 0.06, 'sine', 0.014, 0.03)
      },
      /** a shot refused for want of coins: a soft low boop */
      broke: () => {
        if (!g.broke()) return
        tn(220, 0.16, 'triangle', 0.035, 0, 165)
      },
      /**
       * The bed under the reef: the deep hush of the water swelling slowly, a far-off fizz, bubbles rising now and
       * then and a soft pad drifting through four chords. Very quiet; the big moments dip it. It follows the mute
       * switch and goes silent while the tab is hidden. stop() fades it out for good.
       */
      ambience: () => {
        const a = ac()
        if (!a) return null
        const level = a.createGain()
        level.gain.value = 1
        const out = a.createGain()
        out.gain.value = 0
        level.connect(out).connect(reefOut(a))
        bedLevel = level
        const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
        const d = buf.getChannelData(0)
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
        const hush = a.createBufferSource()
        hush.buffer = buf
        hush.loop = true
        const hushLp = a.createBiquadFilter()
        hushLp.type = 'lowpass'
        hushLp.frequency.value = 300
        const hushG = a.createGain()
        hushG.gain.value = 0.03
        const fizz = a.createBufferSource()
        fizz.buffer = buf
        fizz.loop = true
        fizz.loopStart = 0.6
        const fizzBp = a.createBiquadFilter()
        fizzBp.type = 'bandpass'
        fizzBp.frequency.value = 3200
        fizzBp.Q.value = 0.7
        const fizzG = a.createGain()
        fizzG.gain.value = 0.0018
        hush.connect(hushLp).connect(hushG).connect(level)
        fizz.connect(fizzBp).connect(fizzG).connect(level)
        // the slow swell of the water
        const swell = a.createOscillator()
        swell.frequency.value = 0.09
        const swellD = a.createGain()
        swellD.gain.value = 0.012
        swell.connect(swellD).connect(hushG.gain)
        // the pad, through a soft lowpass
        const pad = a.createGain()
        pad.gain.value = 1
        const padLp = a.createBiquadFilter()
        padLp.type = 'lowpass'
        padLp.frequency.value = 1100
        pad.connect(padLp).connect(level)
        const t0 = a.currentTime + 0.02
        for (const s of [hush, fizz, swell]) s.start(t0)
        out.gain.setTargetAtTime(1, t0, 1)

        /** one pad note: two triangles a hair apart, swelling in and out over `dur` */
        const padNote = (f: number, at: number, dur: number) => {
          const v = a.createGain()
          v.gain.setValueAtTime(0, at)
          v.gain.linearRampToValueAtTime(0.0045, at + dur * 0.35)
          v.gain.linearRampToValueAtTime(0, at + dur)
          osc(a, at, f, dur, 'triangle').connect(v)
          osc(a, at, f * 1.006, dur, 'triangle').connect(v)
          v.connect(pad)
        }
        /** a bubble rising somewhere on the reef */
        const far = (at: number) => {
          for (let i = 0, n = 2 + Math.floor(Math.random() * 4); i < n; i++) {
            const t = at + i * (0.06 + Math.random() * 0.1)
            const f = 520 + Math.random() * 900
            const o = osc(a, t, f, 0.08, 'sine', f * 1.9)
            const v = a.createGain()
            v.gain.setValueAtTime(0.0001, t)
            v.gain.exponentialRampToValueAtTime(0.004 + Math.random() * 0.004, t + 0.008)
            v.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
            o.connect(v).connect(level)
          }
        }
        // Fmaj7, Em7, Dm9, Cmaj7: drifting down the scale, six seconds each, overlapping
        const CHORDS = [
          [174.6, 220, 261.6, 329.6],
          [164.8, 196, 246.9, 293.7],
          [146.8, 174.6, 220, 329.6],
          [130.8, 164.8, 196, 246.9],
        ]
        let chord = 0
        let nextChord = a.currentTime + 0.5
        let nextBubble = a.currentTime + 1 + Math.random() * 2
        let on = true
        let stopped = false
        const timer = setInterval(() => {
          if (stopped) return
          const want = !isMuted() && document.visibilityState !== 'hidden'
          if (want !== on) {
            on = want
            out.gain.cancelScheduledValues(a.currentTime)
            out.gain.setTargetAtTime(want ? 1 : 0, a.currentTime, want ? 0.6 : 0.08)
          }
          const now = a.currentTime
          if (!on) {
            nextChord = now + 0.5
            nextBubble = now + 1
            return
          }
          if (now > nextChord - 0.4) {
            const at = Math.max(nextChord, now + 0.02)
            CHORDS[chord % CHORDS.length].forEach((f) => padNote(f, at, 7.5))
            chord++
            nextChord = at + 6
          }
          if (now > nextBubble) {
            far(now + 0.05)
            nextBubble = now + 1.4 + Math.random() * 3.2
          }
        }, 200)

        return {
          /** dips the bed under a moment for `sec` seconds */
          duck,
          stop: () => {
            if (stopped) return
            stopped = true
            clearInterval(timer)
            if (bedLevel === level) bedLevel = null
            const n = a.currentTime
            out.gain.cancelScheduledValues(n)
            out.gain.setValueAtTime(out.gain.value, n)
            out.gain.linearRampToValueAtTime(0, n + 0.6)
            for (const s of [hush, fizz, swell]) s.stop(n + 0.7)
            setTimeout(() => out.disconnect(), 1000)
          },
        }
      },
    }
  })(),
  /* coin flip: the thumb's flick, the coin singing through the air, knocks on the velvet, the spin-down's rattle,
     the fire of a streak and the music that climbs with it */
  coinflip: (() => {
    const g = { knock: gate(45), pick: gate(70), count: gate(45), tink: gate(120), clink: gate(38), pop: gate(90) }
    /** a struck coin: the inharmonic partials of a disc, the higher ones dying first */
    const ring = (f: number, dur: number, gain: number, delay = 0) => {
      ;[
        [1, 1, 1],
        [2.32, 0.62, 0.62],
        [3.68, 0.42, 0.42],
        [5.14, 0.28, 0.25],
      ].forEach(([m, d, k]) => tone(f * m, dur * d, 'sine', gain * k, delay, f * m * 0.997))
    }
    /** a looping noise source (one second, so it never repeats audibly under a filter) */
    const loopNoise = (a: AudioContext) => {
      const buf = a.createBuffer(1, a.sampleRate, a.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      const src = a.createBufferSource()
      src.buffer = buf
      src.loop = true
      return src
    }
    /** a level that glides (setTargetAtTime) and never clicks */
    const glide = (p: AudioParam, v: number, a: AudioContext, tc = 0.04) => {
      p.cancelScheduledValues(a.currentTime)
      p.setTargetAtTime(v, a.currentTime, tc)
    }
    // The beds (the streak's music and the fire's roar) play through one gain that every sting ducks by about 8 dB,
    // so a win, a cash-out or a jackpot always stands clear of them, and comes back up after.
    let bedCtx: AudioContext | null = null
    let bed: GainNode | null = null
    const bedNode = (a: AudioContext) => {
      if (!bed || bedCtx !== a) {
        bed = a.createGain()
        bed.gain.value = 1
        bed.connect(out(a))
        bedCtx = a
      }
      return bed
    }
    const duck = (dur: number, db = -8) => {
      const a = ac()
      if (!a || !bed || bedCtx !== a) return
      const n = a.currentTime
      const p = bed.gain
      const low = 10 ** (db / 20)
      p.cancelScheduledValues(n)
      p.setValueAtTime(p.value, n)
      p.linearRampToValueAtTime(low, n + 0.03)
      p.setValueAtTime(low, n + 0.03 + dur)
      p.linearRampToValueAtTime(1, n + 0.03 + dur + 0.7)
    }
    /** the scale the wins climb: two octaves of a major scale from G */
    const STEP = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26]
    const note = (n: number) => 392 * 2 ** (STEP[Math.max(0, Math.min(STEP.length - 1, n))] / 12)
    return {
      // calling a side: the gem chimes bright, the crown a touch lower and rounder
      pick: (side: 'heads' | 'tails') => {
        if (!g.pick()) return
        if (side === 'heads') {
          tone(1568, 0.12, 'sine', 0.035)
          tone(2349, 0.2, 'sine', 0.025, 0.05)
          tone(3136, 0.16, 'sine', 0.01, 0.08)
        } else {
          tone(784, 0.14, 'triangle', 0.04)
          tone(1175, 0.24, 'triangle', 0.03, 0.06)
          tone(1568, 0.18, 'sine', 0.01, 0.1)
        }
      },
      // the thumbnail under the rim, the flick, and the coin's ping as it leaves
      flick: () => {
        noise(0.025, 0.11, 2400, 'bandpass')
        tone(240, 0.05, 'triangle', 0.045, 0, 120)
        ring(2960, 1.1, 0.03, 0.012)
        sweep(0.3, 0.022, 900, 3200, 'bandpass', 1.2, 0.02)
      },
      // the coin singing through the air: a flutter at the spin's rate; set(rate Hz, level 0-1), stop()
      whirr: () => {
        const a = ac()
        if (!a) return null
        const src = loopNoise(a)
        const bp = a.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 1400
        bp.Q.value = 0.9
        const am = a.createGain()
        am.gain.value = 0.5
        const lfo = a.createOscillator()
        lfo.type = 'triangle'
        lfo.frequency.value = 18
        const depth = a.createGain()
        depth.gain.value = 0.5
        lfo.connect(depth).connect(am.gain)
        const v = a.createGain()
        v.gain.value = 0
        src.connect(bp).connect(am).connect(v).connect(out(a))
        src.start()
        lfo.start()
        let stopped = false
        return {
          set: (rate: number, level: number) => {
            if (stopped) return
            glide(lfo.frequency, Math.max(4, Math.min(70, rate)), a, 0.03)
            glide(bp.frequency, 900 + Math.min(70, rate) * 40, a, 0.05)
            glide(v.gain, 0.05 * Math.max(0, Math.min(1, level)), a, 0.05)
          },
          stop: () => {
            if (stopped) return
            stopped = true
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setValueAtTime(v.gain.value, n)
            v.gain.linearRampToValueAtTime(0, n + 0.08)
            src.stop(n + 0.1)
            lfo.stop(n + 0.1)
          },
        }
      },
      // a long streak in the air (k 0-1): a riser under the flight and a heartbeat for its fall, over `dur` seconds
      // (kept under the stings: it builds the tension, the result is what lands)
      riser: (k = 0.5, dur = 1) => {
        sweep(dur, 0.011 + 0.016 * k, 280, 1800 + k * 1400, 'bandpass', 1.6)
        const f = 110 * 2 ** ((k * 5) / 12)
        hold(f, dur, 'triangle', 0.007 + 0.007 * k, 0, f * 1.12, [5, 1.5])
        for (let i = 0; i < 2; i++) {
          tone(58, 0.12, 'sine', 0.044 * (0.5 + k * 0.5), dur * 0.55 + i * 0.2, 40)
          tone(52, 0.14, 'sine', 0.033 * (0.5 + k * 0.5), dur * 0.55 + i * 0.2 + 0.14, 38)
        }
      },
      // time slows for the landing: a deep whoom and a swell
      slowmo: (k = 1) => {
        tone(70, 0.7, 'sine', 0.06 * k, 0, 40)
        sweep(0.8, 0.03 * k, 2200, 300, 'bandpass', 1.4)
        tone(1047, 0.9, 'sine', 0.007 * k, 0.05, 1035, [5, 6])
      },
      // gold on velvet (v: how hard): a muffled thud, and the coin's ring, brighter the harder it lands
      knock: (v = 10, first = false) => {
        if (!g.knock()) return
        const k = Math.max(0.15, Math.min(1, v / 30))
        noise(0.09, 0.07 * k, 420, 'lowpass')
        tone(120, 0.14, 'sine', 0.055 * k, 0, 70)
        noise(0.02, 0.04 * k, 3800, 'bandpass')
        ring(first ? 2960 : 2960 * (0.98 + Math.random() * 0.04), (first ? 1.6 : 0.7) * (0.4 + k * 0.6), 0.022 * k)
      },
      // the spin-down on the rim, like Euler's disk: a rattle that quickens and fades; set(rate Hz, level), stop()
      spin: () => {
        const a = ac()
        if (!a) return null
        const src = loopNoise(a)
        const bp = a.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 2600
        bp.Q.value = 2.2
        const ringOsc = a.createOscillator()
        ringOsc.frequency.value = 2960
        const ringG = a.createGain()
        ringG.gain.value = 0.18
        const low = a.createBiquadFilter()
        low.type = 'lowpass'
        low.frequency.value = 260
        // pulses: a sine at the rate, sharpened into clicks
        const lfo = a.createOscillator()
        lfo.frequency.value = 6
        const shaper = a.createWaveShaper()
        const curve = new Float32Array(256)
        for (let i = 0; i < 256; i++) curve[i] = (i / 255) ** 6
        shaper.curve = curve
        const am = a.createGain()
        am.gain.value = 0
        lfo.connect(shaper).connect(am.gain)
        const v = a.createGain()
        v.gain.value = 0
        src.connect(bp).connect(am)
        ringOsc.connect(ringG).connect(am)
        src.connect(low).connect(v)
        am.connect(v)
        v.connect(out(a))
        src.start()
        lfo.start()
        ringOsc.start()
        let stopped = false
        return {
          set: (rate: number, level: number) => {
            if (stopped) return
            const r = Math.max(2, Math.min(90, rate))
            glide(lfo.frequency, r, a, 0.05)
            glide(ringOsc.frequency, 2960 + r * 4, a, 0.1)
            glide(v.gain, 0.09 * Math.max(0, Math.min(1, level)), a, 0.05)
          },
          stop: () => {
            if (stopped) return
            stopped = true
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setValueAtTime(v.gain.value, n)
            v.gain.linearRampToValueAtTime(0, n + 0.12)
            src.stop(n + 0.14)
            lfo.stop(n + 0.14)
            ringOsc.stop(n + 0.14)
          },
        }
      },
      // it lies still: one last little tink
      settle: () => {
        if (!g.tink()) return
        ring(3020, 0.5, 0.012)
        noise(0.03, 0.04, 500, 'lowpass')
      },
      // a little coin of the shower or the rain knocking the velvet or glancing off the big coin (k: how hard)
      clink: (k = 0.5) => {
        if (!g.clink()) return
        ring(3300 * (0.9 + Math.random() * 0.25), 0.28, 0.009 * Math.max(0.2, Math.min(1, k)))
      },
      // a firework over the table at a legendary streak: a pop and a crackling fall
      firework: () => {
        if (!g.pop()) return
        noise(0.06, 0.1, 700, 'lowpass')
        tone(140, 0.12, 'sine', 0.05, 0, 60)
        crackle(0.45, 0.018, 0.1)
      },
      // the coin catches fire (level 1-5): a whoomph and a scatter of sparks
      ignite: (level = 1) => {
        const k = Math.min(1, 0.4 + level * 0.15)
        sweep(0.55, 0.09 * k, 260, 1600, 'lowpass', 0.7)
        noise(0.4, 0.06 * k, 900, 'lowpass', 0.05)
        tone(90, 0.4, 'sine', 0.08 * k, 0, 55)
        crackle(0.5, 0.025 * k, 0.1)
      },
      // the streak's fire: a soft roar and crackles, ducked under the stings; level(0-1), stop()
      fire: () => {
        const a = ac()
        if (!a) return null
        const src = loopNoise(a)
        const lp = a.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 500
        const v = a.createGain()
        v.gain.value = 0
        src.connect(lp).connect(v).connect(bedNode(a))
        src.start()
        let level = 0
        let stopped = false
        const timer = setInterval(() => {
          if (stopped || level < 0.05) return
          if (Math.random() < 0.35 + level * 0.5) noise(0.006 + Math.random() * 0.012, (0.012 + Math.random() * 0.02) * level, 1800 + Math.random() * 4000, 'bandpass', Math.random() * 0.08)
          if (Math.random() < level * 0.25) tone(60 + Math.random() * 30, 0.12, 'sine', 0.02 * level, Math.random() * 0.05, 40)
        }, 70)
        return {
          level: (l: number) => {
            if (stopped) return
            level = Math.max(0, Math.min(1, l))
            glide(v.gain, 0.07 * level, a, 0.3)
            glide(lp.frequency, 420 + level * 700, a, 0.3)
          },
          stop: () => {
            if (stopped) return
            stopped = true
            clearInterval(timer)
            const n = a.currentTime
            v.gain.cancelScheduledValues(n)
            v.gain.setValueAtTime(v.gain.value, n)
            v.gain.linearRampToValueAtTime(0, n + 0.5)
            src.stop(n + 0.55)
          },
        }
      },
      // the flames go out (k 0-1: how big the fire was): a hiss and a low gutter
      douse: (k = 0.5) => {
        sweep(0.7, 0.03 + 0.03 * k, 3000, 600, 'highpass', 0.8)
        noise(0.5, 0.025 + 0.025 * k, 1200, 'bandpass', 0.05)
        tone(80, 0.5, 'sine', 0.03 + 0.04 * k, 0.05, 45)
      },
      // the call came up: a chord a step higher up the scale for every win of the streak, and a sparkle
      win: (n = 1) => {
        duck(0.7)
        const f = note(n - 1)
        const k = 0.1 + 0.005 * Math.min(8, n)
        ;[f, f * 2 ** (4 / 12), f * 2 ** (7 / 12)].forEach((x, i) => tone(x, 0.26, 'triangle', k, i * 0.06))
        tone(f * 2, 0.6, 'sine', 0.05, 0.18, undefined, [6, 6])
        tone(f / 2, 0.3, 'sine', 0.07, 0, f / 2)
        for (let i = 0; i < 4 + Math.min(8, n); i++) tone(2600 + Math.random() * 1600, 0.07, 'sine', 0.016, 0.2 + i * 0.045)
      },
      // the other face (k: the wins the streak had): a soft fall on a first flip; a streak lost dives like a tape
      // stopping, deeper and louder the more it was worth
      lose: (k = 0) => {
        duck(0.9, -12)
        const kk = Math.max(0, Math.min(1, k / 8))
        tone(392, 0.22, 'triangle', 0.034, 0, 370)
        tone(311, 0.5, 'triangle', 0.034, 0.2, 262, [5, 5])
        tone(78, 0.4, 'sine', 0.045, 0.2, 52)
        if (k >= 1) {
          tone(196, 0.7, 'triangle', 0.018 + 0.04 * kk, 0.04, 41)
          tone(98, 0.8, 'sine', 0.03 + 0.08 * kk, 0.08, 30)
          sweep(0.6, 0.012 + 0.03 * kk, 1800, 140, 'lowpass', 1, 0.04)
        }
      },
      // cashing out: a bright chord and coins pouring into the tray (more of both for more), over a ducked bed
      cashout: (mult = 2) => {
        duck(1.4)
        tone(131, 0.24, 'sine', 0.25, 0, 82)
        ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.26, 'triangle', 0.19, i * 0.06))
        tone(1568 * 2, 0.7, 'sine', 0.04, 0.26, undefined, [6, 6])
        const n = Math.min(28, 6 + Math.round(Math.log2(mult) * 2))
        for (let i = 0; i < n; i++) {
          const f = 2400 + Math.random() * 1500
          const t = 0.16 + i * (0.035 + Math.random() * 0.02)
          tone(f, 0.05, 'square', 0.016, t)
          tone(f * 1.33, 0.09, 'sine', 0.026, t + 0.01)
        }
        if (mult >= 15) {
          ;[523, 659, 784].forEach((f, i) => hold(f, 0.12, 'sawtooth', 0.022, 0.3 + i * 0.1))
          hold(1047, 0.7, 'sawtooth', 0.026, 0.6, 1047, [5, 5])
        }
      },
      // a jackpot streak (tier 1 at 10 wins, 2 at 13, 3 at all 16): a cymbal swell and a brass fanfare, the loudest
      // moment of the game
      jackpot: (tier = 1) => {
        duck(3.2, -14)
        const t = Math.max(1, Math.min(3, tier))
        reverseCymbal(0.6, 0.08 + 0.02 * t)
        const CH = [
          [392, 494, 587],
          [440, 554, 659],
          [494, 622, 740],
          [523, 659, 784],
        ]
        for (let i = 0; i <= t; i++) CH[i].forEach((f) => hold(f, 0.18, 'sawtooth', 0.026, 0.6 + i * 0.2))
        const end = 0.6 + (t + 1) * 0.2
        CH[t].forEach((f) => hold(f * 2, 1.3 + t * 0.2, 'sawtooth', 0.022, end, f * 2, [5, 4]))
        CH[t].forEach((f) => hold(f / 2, 1.3 + t * 0.2, 'triangle', 0.05, end))
        tone(55, 1.4, 'sine', 0.2, end, 41)
        noise(0.5, 0.12, 5000, 'highpass', end)
        for (let i = 0; i < 10 + t * 6; i++) tone(2200 + Math.random() * 1800, 0.08, 'sine', 0.02, end + i * 0.05)
        if (t >= 3) {
          // legendary: a second, higher fanfare
          const e2 = end + 1.6
          ;[784, 988, 1175, 1568].forEach((f, i) => hold(f, 0.16, 'sawtooth', 0.02, e2 + i * 0.12))
          hold(2093, 1.2, 'sine', 0.03, e2 + 0.5, 2093, [6, 8])
          tone(41, 1.6, 'sine', 0.18, e2 + 0.5, 30)
        }
      },
      // the win counting up
      count: (k = 0) => {
        if (!g.count()) return
        tone(1900 + k * 1400, 0.04, 'triangle', 0.02)
      },
      // the music of a streak: silent at 0, a soft pad and bass from the first win, then hats, an arpeggio, drums and
      // a lead join in and the tempo climbs as the streak grows, ducked under every sting. set(streak) steers it;
      // stop() fades it out, stop(true) stops it like a tape (a lost streak).
      music: () => {
        const a = ac()
        if (!a) return null
        let streak = 0
        let stopped = false
        let next = a.currentTime + 0.05
        let step = 0
        const bus = a.createGain()
        bus.gain.value = 0.85
        const lp = a.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 18000
        bus.connect(lp).connect(bedNode(a))
        /** a note into the music's bus */
        const play = (f: number, dur: number, type: OscillatorType, gain: number, at: number, slideTo?: number) => {
          const o = osc(a, at, f, dur, type, slideTo)
          const v = a.createGain()
          v.gain.setValueAtTime(0.0001, at)
          v.gain.exponentialRampToValueAtTime(gain, at + 0.012)
          v.gain.exponentialRampToValueAtTime(0.0001, at + dur)
          o.connect(v).connect(bus)
        }
        const hat = (gain: number, at: number) => {
          const len = Math.floor(a.sampleRate * 0.04)
          const buf = a.createBuffer(1, len, a.sampleRate)
          const d = buf.getChannelData(0)
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
          const s = a.createBufferSource()
          s.buffer = buf
          const f = a.createBiquadFilter()
          f.type = 'highpass'
          f.frequency.value = 7000
          const v = a.createGain()
          v.gain.value = gain
          s.connect(f).connect(v).connect(bus)
          s.start(at)
        }
        // Am, F, C, G: two beats each, round and round
        const CHORDS = [
          [220, 261.6, 329.6],
          [174.6, 220, 261.6],
          [196, 246.9, 293.7],
          [164.8, 207.7, 246.9],
        ]
        const timer = setInterval(() => {
          if (stopped) return
          if (streak < 1) {
            next = a.currentTime + 0.1
            step = 0
            return
          }
          const bpm = 96 + Math.min(16, streak) * 3.5
          const s16 = 60 / bpm / 4
          while (next < a.currentTime + 0.25) {
            const at = Math.max(next, a.currentTime + 0.005)
            const st = step % 32
            const ch = CHORDS[Math.floor(st / 8) % 4]
            // pad: the chord on each change
            if (st % 8 === 0) ch.forEach((f, i) => play(f, s16 * 8.5, 'triangle', 0.02 - i * 0.003, at))
            // bass: on beats one and three from the first win, every beat from the second
            if (st % (streak >= 2 ? 4 : 8) === 0) play(ch[0] / 2, s16 * 2.4, 'sine', streak >= 2 ? 0.05 : 0.03, at, (ch[0] / 2) * 0.98)
            // hats on the off-beats, sixteenths later
            if (streak >= 3 && (st % 4 === 2 || (streak >= 6 && st % 2 === 1))) hat(st % 4 === 2 ? 0.05 : 0.025, at)
            // a kick on every beat and a clap on two and four
            if (streak >= 5 && st % 4 === 0) play(130, 0.16, 'sine', 0.08, at, 45)
            if (streak >= 5 && st % 8 === 4) {
              hat(0.06, at)
              play(185, 0.08, 'triangle', 0.02, at, 120)
            }
            // the arpeggio
            if (streak >= 4) {
              const f = ch[st % 3] * (st % 6 < 3 ? 2 : 4)
              if (st % 2 === 0 || streak >= 8) play(f, s16 * 1.6, 'triangle', 0.011, at)
            }
            // a shimmering lead an octave up, for the long streaks
            if (streak >= 9 && st % 8 === 0) play(ch[2] * 4, s16 * 7, 'sine', 0.009, at, ch[2] * 4 * 1.005)
            next += s16
            step++
          }
        }, 60)
        return {
          set: (n: number) => {
            streak = Math.max(0, n)
          },
          stop: (tape = false) => {
            if (stopped) return
            stopped = true
            clearInterval(timer)
            const n = a.currentTime
            const end = tape ? 0.55 : 0.6
            if (tape) {
              lp.frequency.cancelScheduledValues(n)
              lp.frequency.setValueAtTime(lp.frequency.value, n)
              lp.frequency.exponentialRampToValueAtTime(150, n + end)
            }
            bus.gain.cancelScheduledValues(n)
            bus.gain.setValueAtTime(bus.gain.value, n)
            bus.gain.linearRampToValueAtTime(0, n + end)
            setTimeout(() => bus.disconnect(), (end + 0.3) * 1000)
          },
        }
      },
    }
  })(),
}
