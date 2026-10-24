/* Coin Cascade's sounds: the machine's. They live with the game so they load with it, not with every page; the synth
   they play on, and the sounds every page shares, are in src/lib/sound.ts (the site's mute silences them all).

   The machine's voice: the coin clinking into the slot and rattling down inside the cabinet, then dropping out onto
   the upper tier; the low hum of the pushers' motor while they run; coins clinking as they land on coins (a heavier
   thud for a prize); a rattle as things tip over the front edge; the tray's jingle as they land in it, climbing in
   pitch as the drop's win grows; a dull clunk down the gutters; the hopper's dribble, and its rush and clatter for a
   Coin Shower; the deep rumble and rattle of a Quake; a whoosh and a thump as a new prize drops in; and a fanfare for
   each prize, from the gem's sparkle to the Crown's full brass. */
import { ac, gate, hold, noise, out, reverseCymbal, sweep, swell, tone } from '../../lib/sound'
import type { ItemKind } from './types'

/** a held machine noise from now until the returned function is called: a tone through a lowpass with a wobble */
function drone(f: number, cut: number, gain: number, wobble: [number, number]) {
  const a = ac()
  if (!a) return () => {}
  const t = a.currentTime
  const o = a.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(f * 0.7, t)
  o.frequency.exponentialRampToValueAtTime(f, t + 0.35)
  const sub = a.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = f / 2
  const lfo = a.createOscillator()
  const depth = a.createGain()
  lfo.frequency.value = wobble[0]
  depth.gain.value = wobble[1]
  lfo.connect(depth).connect(o.frequency)
  const lp = a.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = cut
  lp.Q.value = 2
  const v = a.createGain()
  v.gain.setValueAtTime(0, t)
  v.gain.linearRampToValueAtTime(gain, t + 0.3)
  const sv = a.createGain()
  sv.gain.value = 1.6
  o.connect(lp).connect(v).connect(out(a))
  sub.connect(sv).connect(lp)
  o.start(t)
  sub.start(t)
  lfo.start(t)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const n = a.currentTime
    v.gain.cancelScheduledValues(n)
    v.gain.setValueAtTime(v.gain.value, n)
    v.gain.linearRampToValueAtTime(0, n + 0.35)
    o.frequency.cancelScheduledValues(n)
    o.frequency.setValueAtTime(o.frequency.value, n)
    o.frequency.exponentialRampToValueAtTime(f * 0.6, n + 0.35)
    for (const x of [o, sub, lfo]) x.stop(n + 0.4)
  }
}

/** a coin's clink: two bright partials, a little different each time */
function clink(level: number, delay = 0, pitch = 1) {
  const f = (2600 + Math.random() * 900) * pitch
  tone(f, 0.05, 'square', 0.012 * level, delay)
  tone(f * 1.48, 0.09, 'sine', 0.02 * level, delay + 0.004)
  noise(0.025, 0.03 * level, 4200, 'bandpass', delay)
}

const PRIZE_TIER: Partial<Record<ItemKind, number>> = { gem: 1, bar: 2, idol: 3, crown: 4 }

export const pusherSfx = (() => {
  const g = { land: gate(55), thud: gate(110), spill: gate(70), tray: gate(45), gutter: gate(180), feed: gate(400) }
  return {
    /** the coin goes into the slot: a bright clink and a rattle down inside the cabinet */
    insert: () => {
      tone(2093, 0.06, 'square', 0.02)
      tone(3136, 0.1, 'sine', 0.025, 0.03)
      for (let i = 0; i < 5; i++) clink(0.6 - i * 0.08, 0.1 + i * 0.05 + Math.random() * 0.02, 0.8)
      noise(0.05, 0.05, 600, 'lowpass', 0.34)
    },
    /** the coin drops out of the slot onto the upper tier */
    drop: () => {
      sweep(0.25, 0.025, 1800, 3600, 'bandpass', 4)
      tone(1400, 0.18, 'sine', 0.012, 0, 2200)
    },
    /** the pushers' motor while they run, faster at a higher speed; returns its off switch */
    hum: (rate = 1) => drone(62 * Math.min(1.8, 0.85 + rate * 0.15), 260 + rate * 60, 0.03, [0.6 * rate, 2.2]),
    /** something lands on a tier: a coin's clink, or a prize's thud */
    land: (kind: ItemKind) => {
      if (kind === 'silver' || kind === 'gold') {
        if (!g.land()) return
        clink(0.55, 0, kind === 'gold' ? 0.9 : 1)
        return
      }
      if (!g.thud()) return
      noise(0.1, 0.09, 380, 'lowpass')
      tone(120, 0.14, 'sine', 0.07, 0, 70)
      tone(kind === 'gem' ? 2600 : 900, 0.12, 'triangle', 0.012, 0.01)
    },
    /** something tips over the front edge */
    spill: (kind: ItemKind) => {
      if (!g.spill()) return
      if (kind === 'silver' || kind === 'gold') {
        clink(0.5, 0, 1.15)
        clink(0.35, 0.05, 1.05)
        return
      }
      sweep(0.5, 0.035, 700, 2800, 'bandpass', 1.5)
      tone(420, 0.5, 'triangle', 0.025, 0, 840)
    },
    /** it lands in the tray: the jingle, climbing with the drop's win so far (`total`, times the stake) */
    tray: (kind: ItemKind, total: number) => {
      const k = 2 ** Math.min(1.4, Math.log2(1 + total) * 0.45)
      if (kind === 'silver' || kind === 'gold') {
        if (!g.tray()) return
        clink(0.9, 0, k * (kind === 'gold' ? 0.94 : 1.05))
        tone(1046 * k, 0.16, 'triangle', 0.026, 0.02)
        if (kind === 'gold') tone(1568 * k, 0.24, 'sine', 0.024, 0.06)
        return
      }
      noise(0.14, 0.12, 420, 'lowpass')
      tone(150, 0.2, 'sine', 0.08, 0, 80)
      for (let i = 0; i < 4; i++) clink(0.5, 0.05 + i * 0.04, k)
    },
    /** something goes down a gutter: a dull clunk, falling away */
    gutter: () => {
      if (!g.gutter()) return
      tone(330, 0.16, 'triangle', 0.02, 0, 180)
      noise(0.06, 0.035, 900, 'bandpass', 0.06)
    },
    /** the hopper drops a few coins in */
    feed: () => {
      if (!g.feed()) return
      for (let i = 0; i < 4; i++) clink(0.45, 0.04 + i * 0.07 + Math.random() * 0.03, 0.9)
    },
    /** a Coin Shower: the hopper tips with a creak and a stream of coins rushes and rattles down */
    shower: () => {
      tone(180, 0.3, 'sawtooth', 0.014, 0, 120)
      swell(1.9, 0.05, 'bandpass', 2600, 0.7, 0.3, 0.15)
      sweep(1.6, 0.035, 4800, 1800, 'bandpass', 1.2, 0.2)
      for (let i = 0; i < 26; i++) clink(0.35 + Math.random() * 0.4, 0.2 + i * 0.06 + Math.random() * 0.05, 0.85 + Math.random() * 0.3)
      ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.18, 'triangle', 0.03, i * 0.07))
    },
    /** a Quake: a deep rumble, a sub-bass shudder and the whole field rattling */
    quake: () => {
      swell(1.8, 0.16, 'lowpass', 140, 0.9, 0.12)
      tone(46, 1.6, 'sine', 0.16, 0, 38, [9, 6])
      tone(92, 1.1, 'sawtooth', 0.02, 0.05, 70, [11, 9])
      for (let i = 0; i < 16; i++) clink(0.3 + Math.random() * 0.3, 0.1 + i * 0.08 + Math.random() * 0.04, 0.8 + Math.random() * 0.4)
      noise(0.5, 0.07, 1800, 'bandpass', 0.2)
    },
    /** a new prize drops in from above: a whoosh down and a thump */
    restock: () => {
      sweep(0.5, 0.03, 3200, 700, 'bandpass', 1.4)
      tone(1400, 0.4, 'sine', 0.014, 0, 600)
      noise(0.1, 0.08, 400, 'lowpass', 0.42)
      tone(110, 0.16, 'sine', 0.06, 0.42, 70)
    },
    /** a prize lands in the tray: the gem sparkles, the bar's brass, the Idol's and the Crown's full fanfare */
    fanfare: (kind: ItemKind) => {
      const tier = PRIZE_TIER[kind] ?? 0
      if (!tier) return
      if (tier === 1) {
        ;[1319, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.22, 'sine', 0.03, i * 0.06, undefined, [7, 10]))
        tone(3136, 0.5, 'sine', 0.014, 0.28, undefined, [6, 14])
        return
      }
      ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, i * 0.08))
      ;[1047, 1319, 1568].forEach((f) => tone(f, 0.6, 'triangle', 0.026, 0.34))
      if (tier >= 2) {
        ;[392, 523, 659].forEach((f, i) => hold(f, 0.12, 'sawtooth', 0.016, i * 0.1))
        hold(784, 0.7, 'sawtooth', 0.017, 0.32, 784, [5, 5])
        ;[2093, 2637, 3136, 2637, 3136, 4186].forEach((f, i) => tone(f, 0.12, 'sine', 0.015, 0.6 + i * 0.06))
      }
      if (tier >= 3) {
        reverseCymbal(0.5, 0.05)
        ;[523, 659, 784, 1047, 1319].forEach((f, i) => hold(f, i === 4 ? 1.3 : 0.15, 'sawtooth', 0.014, 0.62 + i * 0.1, f, [5, 4]))
        ;[1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 1.3, 'sine', 0.014, 1.05 + i * 0.05, undefined, [6, 9]))
        noise(0.9, 0.05, 6000, 'highpass', 1.05)
      }
      if (tier >= 4) {
        ;[659, 831, 988, 1319].forEach((f) => hold(f, 1.4, 'sawtooth', 0.012, 1.7))
        ;[2093, 2637, 3136, 4186, 5274].forEach((f, i) => tone(f, 0.9, 'sine', 0.013, 1.75 + i * 0.08, undefined, [7, 12]))
        sweep(1.5, 0.03, 900, 7000, 'bandpass', 2, 1.6)
        for (let i = 0; i < 14; i++) clink(0.5, 1.7 + i * 0.07 + Math.random() * 0.03, 1.2)
      }
    },
    /** a drop that won the stake or more, once everything is in the tray: a cheerful sting, brighter for more */
    win: (mult: number) => {
      const n = Math.min(10, 3 + Math.floor(Math.log2(Math.max(1, mult)) * 1.6))
      for (let i = 0; i < n; i++) clink(0.6, i * 0.05, 1.1)
      ;[659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.045, 0.08 + i * 0.07))
      tone(1568, 0.45, 'sine', 0.028, 0.3)
    },
    /** the aim moves along the slot rail: a soft tick */
    tick: (() => {
      const pass = gate(70)
      return () => pass() && tone(1700, 0.025, 'square', 0.008)
    })(),
  }
})()
