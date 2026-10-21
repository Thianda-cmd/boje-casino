/* Sic Bo's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, crackle, gate, hold, noise, out, reverseCymbal, sweep, tone } from '../../lib/sound'

/* sic bo: clay chips on the felt, the crack and thunder of the lucky strikes, the dome's rattle and every knock of
   the dice on the glass, the felt and each other, the dealer's sweep and payout, and the wins by tier */
export const sicboSfx = (() => {
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
})()
