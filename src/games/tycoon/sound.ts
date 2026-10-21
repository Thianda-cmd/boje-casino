/* Casino Tycoon's sounds. They live with the game so they load with it, not with every page; the synth they play
   on, and the sounds every page shares, are in src/lib/sound.ts. */
import { ac, gate, hold, isMuted, noise, osc, out, sweep, tone } from '../../lib/sound'

/**
 * Casino Tycoon: a cash register for a buy (brighter for a bigger one; a ribbon-cutting chime for a grand
 * opening), a soft coin for a round paid (thinned: the floor can pay ten times a second), a click to run a round,
 * the service bell for a manager, a sparkle for an upgrade, a rising flourish for a count step, bells for a
 * milestone, the whale's tuba and his tip, the golden chip's twinkle and its catch, coins pouring from the vault,
 * a fanfare for a sale and a grander one for a new city, a warm chime to welcome the player back, and the quiet
 * bed of a busy casino floor under it all (ambience()).
 */
export const tycoonSfx = (() => {
  const g = { cycle: gate(220), buy: gate(40), run: gate(50), reached: gate(400) }
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
  /** the register's drawer: a clack and a thump */
  const drawer = (delay = 0) => {
    noise(0.03, 0.09, 2400, 'bandpass', delay)
    tone(140, 0.09, 'sine', 0.07, delay, 90)
  }
  /** a brass chord held over a low drum: the fanfares */
  const brass = (notes: number[], at: number, len: number, gain: number) => notes.forEach((f) => hold(f, len, 'sawtooth', gain, at, f, [5, 4]))
  return {
    // a buy: the drawer and the bell, brighter and with more coins for a bigger buy (k bought)
    buy: (k = 1) => {
      if (!g.buy()) return
      const lift = Math.min(1.25, 1 + Math.log10(Math.max(1, k)) * 0.08)
      drawer()
      bell(2093 * lift, 0.03, 0.05, 0.45)
      bell(2637 * lift, 0.024, 0.09, 0.5)
      coins(k >= 100 ? 5 : k >= 10 ? 3 : 1, 0.1, 0.01)
    },
    // the first of an attraction: the ribbon's snip, a chime running up and a cheer of coins
    open: () => {
      noise(0.05, 0.08, 4200, 'highpass')
      ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.24, 'triangle', 0.045, 0.06 + i * 0.07))
      bell(2093, 0.03, 0.36, 0.8)
      coins(5, 0.36)
    },
    // a round started by hand: a soft plunk
    run: () => {
      if (!g.run()) return
      tone(660, 0.07, 'triangle', 0.045, 0, 990)
      noise(0.02, 0.04, 3000, 'bandpass')
    },
    // a round paid on the floor: one soft coin, pitched by the attraction (the big venues lower), never in a rush
    cycle: (i = 0) => {
      if (!g.cycle()) return
      const f = 2600 - i * 110 + Math.random() * 160
      tone(f, 0.05, 'square', 0.006)
      tone(f * 1.34, 0.09, 'sine', 0.009, 0.015)
    },
    // a count step (25, 50, 100 …): a quick flourish climbing to a bright chord
    step: () => {
      ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, i * 0.06))
      ;[1047, 1319, 1568].forEach((f) => tone(f, 0.7, 'sine', 0.02, 0.26, undefined, [6, 8]))
      sweep(0.4, 0.035, 1200, 6000, 'bandpass', 1.4, 0.2)
    },
    // a manager hired: two taps of the service bell and a whistle
    hire: () => {
      bell(1760, 0.04, 0, 0.7)
      bell(1760, 0.035, 0.16, 0.8)
      tone(1400, 0.22, 'sine', 0.02, 0.36, 2300, [8, 30])
    },
    // an upgrade: a shimmer rising to a sparkle
    upgrade: () => {
      sweep(0.45, 0.04, 700, 5200, 'bandpass', 1.6)
      ;[1319, 1661, 1976, 2637].forEach((f, i) => tone(f, 0.3, 'sine', 0.022, 0.12 + i * 0.05, undefined, [6, 9]))
    },
    // a milestone reached (ready to claim): a bright two-note call
    reached: () => {
      if (!g.reached()) return
      bell(1319, 0.035)
      bell(1976, 0.035, 0.1)
    },
    // a milestone claimed: bells and coins, more for a bigger one
    claim: (amount = 50) => {
      bell(1047, 0.04)
      bell(1568, 0.04, 0.09)
      coins(Math.min(10, 3 + Math.round(amount / 150)), 0.16)
    },
    // the vault emptied: the door's wheel turning, then coins pouring, more for more
    collect: (amount = 20) => {
      for (let i = 0; i < 4; i++) noise(0.02, 0.05, 1500 + i * 280, 'bandpass', i * 0.05)
      tone(110, 0.25, 'sine', 0.08, 0.2, 70)
      coins(Math.min(14, 4 + Math.round(Math.sqrt(amount))), 0.24, 0.013)
      bell(1568, 0.03, 0.3, 0.6)
    },
    // the whale walks in: a big friendly tuba "ho ho"
    whale: () => {
      hold(98, 0.22, 'sawtooth', 0.03, 0, 92)
      hold(131, 0.4, 'sawtooth', 0.03, 0.26, 123, [5, 2])
      tone(65, 0.6, 'sine', 0.08, 0.26, 55)
      bell(1568, 0.02, 0.5, 0.6)
    },
    // the whale tipped: a brass hit and a shower of coins
    tip: () => {
      tone(73, 0.5, 'sine', 0.1, 0, 55)
      brass([392, 494, 587, 784], 0, 0.7, 0.012)
      coins(10, 0.12, 0.012)
      ;[1568, 2093, 2637].forEach((f, i) => tone(f, 0.8, 'sine', 0.014, 0.3 + i * 0.06, undefined, [6, 9]))
    },
    // a golden chip turns up: a twinkle
    chip: () => {
      ;[2637, 3136, 3951].forEach((f, i) => tone(f, 0.3, 'sine', 0.018, i * 0.07, undefined, [7, 10]))
    },
    // a golden chip caught: a quick bright run and coins
    catch: () => {
      ;[1319, 1661, 1976, 2637, 3322].forEach((f, i) => tone(f, 0.16, 'triangle', 0.04, i * 0.045))
      coins(6, 0.18)
    },
    // the casino sold: a drum roll into a fanfare
    sale: () => {
      for (let i = 0; i < 10; i++) noise(0.04, 0.03 + i * 0.004, 900, 'bandpass', i * 0.045)
      ;[392, 523, 659].forEach((f, i) => hold(f, 0.14, 'sawtooth', 0.015, 0.48 + i * 0.12))
      brass([523, 659, 784, 1047], 0.86, 1.1, 0.012)
      tone(65, 1.2, 'sine', 0.1, 0.86, 49)
      coins(8, 1)
    },
    // a new city: a grander fanfare over a cymbal swell
    city: () => {
      noise(0.9, 0.04, 6000, 'highpass')
      ;[523, 659, 784, 1047, 1319].forEach((f, i) => hold(f, 0.13, 'sawtooth', 0.013, i * 0.08))
      brass([523, 784, 1047, 1319], 0.46, 1.6, 0.011)
      ;[2093, 2637, 3136, 4186].forEach((f, i) => tone(f, 1.1, 'sine', 0.012, 0.52 + i * 0.07, undefined, [6, 9]))
      tone(55, 1.6, 'sine', 0.1, 0.46, 41)
    },
    // back from away: a warm three-note welcome
    welcome: () => {
      ;[659, 880, 1319].forEach((f, i) => bell(f, 0.03, i * 0.11, 0.7))
    },
    /**
     * The bed under the floor: the low murmur of a busy room swelling slowly, a far-off slot machine's jingle and
     * a chip's clack now and then. Very quiet. It follows the mute switch and goes silent while the tab is hidden;
     * stop() fades it out for good.
     */
    ambience: () => {
      const a = ac()
      if (!a) return null
      const level = a.createGain()
      level.gain.value = 0
      level.connect(out(a))
      const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      const room = a.createBufferSource()
      room.buffer = buf
      room.loop = true
      const lp = a.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 520
      const hp = a.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 120
      const roomG = a.createGain()
      roomG.gain.value = 0.035
      room.connect(hp).connect(lp).connect(roomG).connect(level)
      // the room swelling and settling, as a crowd does
      const swell = a.createOscillator()
      swell.frequency.value = 0.07
      const swellD = a.createGain()
      swellD.gain.value = 0.015
      swell.connect(swellD).connect(roomG.gain)
      const t0 = a.currentTime + 0.02
      room.start(t0)
      swell.start(t0)
      level.gain.setTargetAtTime(1, t0, 1.2)

      /** a note somewhere across the floor */
      const far = (f: number, at: number, len: number, gain: number, type: OscillatorType) => {
        const v = a.createGain()
        v.gain.setValueAtTime(0.0001, at)
        v.gain.exponentialRampToValueAtTime(gain, at + 0.01)
        v.gain.exponentialRampToValueAtTime(0.0001, at + len)
        osc(a, at, f, len, type).connect(v)
        v.connect(level)
      }
      const JINGLES = [
        [1047, 1319, 1568, 2093],
        [1568, 1319, 1568, 2093, 2637],
        [880, 1109, 1319, 1760],
      ]
      let nextJingle = a.currentTime + 2 + Math.random() * 3
      let nextClack = a.currentTime + 1 + Math.random() * 2
      let on = true
      let stopped = false
      const timer = setInterval(() => {
        if (stopped) return
        const want = !isMuted() && document.visibilityState !== 'hidden'
        if (want !== on) {
          on = want
          level.gain.cancelScheduledValues(a.currentTime)
          level.gain.setTargetAtTime(want ? 1 : 0, a.currentTime, want ? 0.6 : 0.08)
        }
        const now = a.currentTime
        if (!on) {
          nextJingle = now + 2
          nextClack = now + 1
          return
        }
        if (now > nextJingle) {
          const j = JINGLES[Math.floor(Math.random() * JINGLES.length)]
          const k = 0.5 + Math.random() * 0.5
          j.forEach((f, i) => far(f * (Math.random() < 0.5 ? 1 : 0.75), now + 0.05 + i * 0.09, 0.22, 0.0035 * k, 'triangle'))
          nextJingle = now + 5 + Math.random() * 7
        }
        if (now > nextClack) {
          far(2400 + Math.random() * 900, now + 0.02, 0.04, 0.003, 'square')
          if (Math.random() < 0.5) far(2100 + Math.random() * 600, now + 0.09, 0.04, 0.0025, 'square')
          nextClack = now + 1.6 + Math.random() * 3.5
        }
      }, 200)
      return {
        stop: () => {
          if (stopped) return
          stopped = true
          clearInterval(timer)
          const n = a.currentTime
          level.gain.cancelScheduledValues(n)
          level.gain.setValueAtTime(level.gain.value, n)
          level.gain.linearRampToValueAtTime(0, n + 0.6)
          room.stop(n + 0.7)
          swell.stop(n + 0.7)
          setTimeout(() => level.disconnect(), 1000)
        },
      }
    },
  }
})()
