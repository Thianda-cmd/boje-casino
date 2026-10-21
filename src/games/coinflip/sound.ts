/* Coin Flip's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, crackle, gate, hold, noise, osc, out, reverseCymbal, sweep, tone } from '../../lib/sound'

/* coin flip: the thumb's flick, the coin singing through the air, knocks on the velvet, the spin-down's rattle,
   the fire of a streak and the music that climbs with it */
export const coinflipSfx = (() => {
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
})()
