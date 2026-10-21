/* Reef Raid's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, gate, isMuted, osc } from '../../lib/sound'

/**
 * Reef Raid's sounds. Holding the trigger fires five torpedoes a second and a bomb blast can pop a dozen catches
 * into coin showers at once, so, like Plunder Bay's and Pop Party's, these play through a compressor of their own
 * (the voices below route to it themselves) and the dense ones are rate-limited. Everything sits a little muffled,
 * as if heard underwater. ambience() is the quiet bed under the reef.
 */
export const reefSfx = (() => {
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
})()
