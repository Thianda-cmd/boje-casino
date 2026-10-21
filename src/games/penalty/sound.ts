/* Penalty Shootout's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, crackle, gate, hold, nasal, noise, out, reverseCymbal, sweep, swell, tone } from '../../lib/sound'

/* penalty shootout: the stadium crowd, the referee, boot on ball, the net, the posts and the keeper */
export const penaltySfx = (() => {
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
})()
