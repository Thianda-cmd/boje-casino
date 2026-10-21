/* Plunder Bay's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, compressorBus, gate, hold, isMuted, nasal, noise, osc, reverseCymbal, sweep, swell, tone, viaBus } from '../../lib/sound'

/* Plunder Bay's recipes (sfx.plunder) play through a compressor of their own, like Pop Party's: one cascade can blast
   twenty symbols at once on top of a coin shower and a cannon. */
const plunderOut = compressorBus({ threshold: -15, knee: 10, ratio: 4.5, attack: 0.003, release: 0.16, trim: 0.68 })
const viaPlunderBus = <T extends Record<string, (...args: never) => unknown>>(group: T): T => viaBus(plunderOut, group)
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

/* plunder bay: timber and rope, sea spray, gold coins, the ship's bell and cannon, brass and squeezebox shanty
   flourishes, and Captain Polly's squawk */
export const plunderSfx = viaPlunderBus({
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
})
