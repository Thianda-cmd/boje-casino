/* Scratch & Win's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, gate, hold, noise, osc, out, reverseCymbal, sweep, tone } from '../../lib/sound'

/* scratch & win: the coin on the foil, cells coming out, the suspense, the stamp and each card's own fanfares */
export const scratchSfx = (() => {
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
})()
