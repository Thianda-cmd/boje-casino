/* Kaiju Clash's sounds: a fight night's. They live with the game so they load with it, not with every page; the synth
   they play on, and the sounds every page shares, are in src/lib/sound.ts.

   Ringside: the bell (one ring to start a round, three at the final bell), the crowd (a swell of filtered noise with
   cheers on top, louder for the Main Event), the announcer's drum roll and brass hit at the walkout, blows (a light
   slap for a jab, a deep thump with a crack for a heavy), a guard taking a hit, a building coming down (a long rumble
   with glass and debris), a Splash (a boom and a wall of water), and the KO sting. Every kaiju roars in its own voice:
   Rexor's shriek over a growl, Gorrath's chest-beating bellow, Titan-X's servos and horn, Kraka's gurgle, Lumina's
   fluttering screech, Pincer's chittering clicks, Bedrock's grinding rumble and Voltra's crackling hiss. The page
   plays them from the stage's events (Stage onEvent) and its own phase changes; a hidden tab plays nothing. */
import { crackle, gate, hold, nasal, noise, reverseCymbal, sweep, swell, tone } from '../../lib/sound'
import type { KaijuId } from './types'

const r = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

/** a few cheers over the crowd: short nasal shouts at random pitches */
function cheers(n: number, gain: number, delay = 0, spread = 0.9) {
  for (let i = 0; i < n; i++) {
    const f = r(220, 520)
    nasal(f, r(0.18, 0.4), gain * r(0.5, 1), delay + Math.random() * spread, f * r(1.1, 1.5), r(700, 1300))
  }
}

const ROARS: Record<KaijuId, () => void> = {
  // a deep growl under the famous shriek, sliding down
  rexor: () => {
    tone(70, 1.5, 'sawtooth', 0.05, 0, 48, [7, 6])
    noise(1.2, 0.07, 380, 'lowpass')
    tone(720, 1.1, 'sawtooth', 0.02, 0.12, 380, [11, 40])
    tone(1080, 0.9, 'square', 0.008, 0.16, 560, [13, 50])
    swell(1.3, 0.03, 'bandpass', 900, 1.4, 0.15, 0.1)
  },
  // a huge ape's bellow, then the chest-beats
  gorrath: () => {
    nasal(118, 1.1, 0.06, 0, 92, 420)
    nasal(176, 0.9, 0.03, 0.05, 140, 640)
    noise(0.9, 0.05, 520, 'lowpass')
    for (let i = 0; i < 4; i++) {
      tone(92, 0.12, 'sine', 0.11, 1.0 + i * 0.16, 54)
      noise(0.06, 0.08, 300, 'lowpass', 1.0 + i * 0.16)
    }
  },
  // servos winding up, a two-tone horn, a hiss of steam
  titan: () => {
    tone(110, 1.2, 'square', 0.022, 0, 82)
    sweep(0.5, 0.03, 400, 2200, 'bandpass', 6)
    hold(233, 0.42, 'sawtooth', 0.026, 0.35)
    hold(311, 0.42, 'sawtooth', 0.02, 0.35)
    hold(196, 0.6, 'sawtooth', 0.026, 0.8)
    hold(262, 0.6, 'sawtooth', 0.02, 0.8)
    sweep(0.8, 0.03, 6000, 2500, 'highpass', 0.8, 0.9)
  },
  // a wet, bubbling gurgle from the deep
  kraka: () => {
    tone(64, 1.4, 'sine', 0.09, 0, 44, [16, 14])
    nasal(140, 1.0, 0.035, 0.08, 96, 380)
    for (let i = 0; i < 9; i++) tone(r(220, 520), 0.06, 'sine', 0.025, 0.1 + i * 0.11 + Math.random() * 0.05, r(500, 900))
    sweep(1.0, 0.025, 300, 1200, 'bandpass', 3, 0.2)
  },
  // a high fluttering screech with wing beats
  lumina: () => {
    tone(1250, 1.0, 'triangle', 0.03, 0, 1750, [28, 120])
    tone(1880, 0.8, 'sine', 0.014, 0.1, 2400, [31, 160])
    for (let i = 0; i < 14; i++) noise(0.03, 0.04, 1800, 'bandpass', i * 0.06)
  },
  // a low growl under a storm of chittering clicks
  pincer: () => {
    nasal(96, 0.9, 0.04, 0, 80, 340)
    for (let i = 0; i < 18; i++) tone(r(1800, 3200), 0.018, 'square', 0.014, 0.04 + i * 0.045 + Math.random() * 0.02)
    noise(0.12, 0.08, 2400, 'bandpass', 0.95)
    tone(1500, 0.05, 'square', 0.02, 0.95)
  },
  // the mountain grinds: a very low rumble and stones cracking
  bedrock: () => {
    tone(44, 1.6, 'sine', 0.12, 0, 34)
    tone(66, 1.3, 'sawtooth', 0.025, 0.05, 52, [5, 4])
    swell(1.5, 0.06, 'lowpass', 220, 0.8, 0.3)
    for (let i = 0; i < 8; i++) noise(0.05, 0.06, r(600, 1400), 'bandpass', 0.2 + i * 0.15 + Math.random() * 0.06)
  },
  // a hiss that crackles with lightning, and a rising electric whine
  voltra: () => {
    sweep(1.1, 0.045, 7000, 2600, 'highpass', 0.7)
    crackle(0.9, 0.05, 0.1)
    tone(220, 1.0, 'sawtooth', 0.018, 0.05, 440, [22, 30])
    tone(880, 0.6, 'square', 0.008, 0.3, 1760)
  },
}

export const kaijuSfx = {
  /** a chip on a selection: a clack, its note climbing through the markets (i 0 to 5) */
  chip: (i = 0) => {
    const f = [523, 587, 659, 740, 784, 880][i] ?? 659
    noise(0.025, 0.09, 3200, 'bandpass')
    tone(f, 0.07, 'triangle', 0.05, 0, f * 1.25)
  },
  /** a chip refused */
  nope: () => {
    tone(260, 0.09, 'square', 0.02)
    tone(196, 0.14, 'square', 0.02, 0.08)
  },
  /** the betting countdown's last seconds */
  count: (n = 3) => tone(n > 1 ? 880 : 1175, 0.07, 'triangle', 0.034),
  /** no more bets: a gavel and a falling two-note */
  closed: () => {
    noise(0.05, 0.14, 900, 'lowpass')
    tone(160, 0.12, 'sine', 0.08, 0, 90)
    tone(784, 0.12, 'triangle', 0.035, 0.08)
    tone(587, 0.2, 'triangle', 0.035, 0.18)
  },
  /** the crowd swells: k from 0 (a murmur) to 1 (the roof comes off) */
  crowd: (k = 0.5, dur = 2.4) => {
    swell(dur, 0.02 + k * 0.05, 'bandpass', 1050, 0.6, dur * 0.3)
    swell(dur * 0.9, 0.012 + k * 0.03, 'bandpass', 2300, 1.1, dur * 0.35, 0.1)
    cheers(Math.round(3 + k * 9), 0.012 + k * 0.012, 0.15, dur * 0.6)
  },
  /** the walkout: a drum roll into a brass hit (a fanfare for the Main Event) */
  walkout: (main = false) => {
    for (let i = 0; i < 16; i++) noise(0.05, 0.03 + i * 0.004, 260, 'lowpass', i * 0.05)
    const at = 0.82
    ;[262, 330, 392].forEach((f) => hold(f, 0.5, 'sawtooth', 0.017, at))
    tone(65, 0.5, 'sine', 0.12, at, 50)
    noise(0.2, 0.1, 500, 'lowpass', at)
    if (main) {
      reverseCymbal(0.8, 0.04)
      ;[[392, 494, 587], [440, 554, 659], [523, 659, 784, 1047]].forEach((ch, i) => ch.forEach((f) => hold(f, i === 2 ? 1.1 : 0.22, 'sawtooth', 0.014, 1.4 + i * 0.25)))
      tone(1568, 1.2, 'sine', 0.02, 1.9, undefined, [6, 8])
    }
  },
  /** the ringside bell, rung n times (three at the final bell) */
  bell: (n = 1) => {
    for (let i = 0; i < n; i++) {
      const d = i * 0.34
      tone(1046, 1.4, 'sine', 0.07, d)
      tone(2890, 0.9, 'sine', 0.025, d)
      tone(5650, 0.4, 'sine', 0.01, d)
      tone(1568, 1.1, 'triangle', 0.018, d)
      noise(0.02, 0.06, 6000, 'highpass', d)
    }
  },
  /** a kaiju's roar, in its own voice */
  roar: (id: KaijuId) => ROARS[id](),
  /** a blow landing: a slap for a jab, a thump and a crack for a heavy (gated so a flurry never stacks) */
  hit: (() => {
    const pass = gate(70)
    return (heavy = false) => {
      if (!pass()) return
      if (heavy) {
        tone(120, 0.26, 'sine', 0.16, 0, 46)
        noise(0.18, 0.18, 900, 'lowpass')
        noise(0.05, 0.1, 3200, 'bandpass', 0.01)
        tone(70, 0.4, 'sine', 0.08, 0.03, 40)
      } else {
        tone(190, 0.1, 'sine', 0.1, 0, 90)
        noise(0.07, 0.14, 1600, 'bandpass')
      }
    }
  })(),
  /** a blow taken on the guard: a dull thud and a clank */
  block: (() => {
    const pass = gate(90)
    return () => {
      if (!pass()) return
      tone(150, 0.12, 'sine', 0.08, 0, 110)
      noise(0.06, 0.08, 500, 'lowpass')
      tone(900, 0.06, 'square', 0.012, 0.01, 700)
    }
  })(),
  /** a building comes down: a crack, a long rumble, glass and debris */
  collapse: () => {
    noise(0.08, 0.2, 2200, 'bandpass')
    tone(58, 1.6, 'sine', 0.12, 0.02, 34)
    swell(1.8, 0.09, 'lowpass', 240, 0.8, 0.2)
    for (let i = 0; i < 10; i++) noise(0.04, 0.05 * (1 - i / 14), r(700, 2000), 'bandpass', 0.15 + i * 0.12 + Math.random() * 0.05)
    for (let i = 0; i < 6; i++) tone(r(3000, 5200), 0.08, 'sine', 0.012, 0.3 + i * 0.13 + Math.random() * 0.06)
  },
  /** a Splash: a boom as the kaiju hits the water, a wall of spray, drips */
  splash: () => {
    tone(64, 0.7, 'sine', 0.15, 0, 36)
    noise(0.3, 0.2, 700, 'lowpass')
    sweep(1.4, 0.09, 2600, 300, 'bandpass', 0.7, 0.03)
    swell(1.6, 0.05, 'highpass', 3500, 0.7, 0.1, 0.1)
    for (let i = 0; i < 7; i++) tone(r(900, 1700), 0.07, 'sine', 0.02, 0.9 + i * 0.16 + Math.random() * 0.08, r(1800, 2600))
    kaijuSfx.crowd(0.95, 3)
  },
  /** the knockout: a brass stab over a cymbal, the crowd erupting */
  ko: () => {
    reverseCymbal(0.35, 0.05)
    tone(55, 0.8, 'sine', 0.16, 0.34, 38)
    noise(0.3, 0.16, 600, 'lowpass', 0.34)
    ;[196, 247, 294, 392].forEach((f) => hold(f, 0.9, 'sawtooth', 0.018, 0.36))
    ;[392, 494, 587, 784].forEach((f, i) => tone(f * 2, 0.7, 'sine', 0.012, 0.5 + i * 0.05, undefined, [6, 9]))
    kaijuSfx.crowd(1, 3.4)
  },
  /** the final bell: three rings and the crowd */
  final: () => {
    kaijuSfx.bell(3)
    kaijuSfx.crowd(0.75, 2.8)
  },
  /** the judges' cards: a drum roll; then each card turned */
  drumroll: (dur = 1.2) => {
    const n = Math.round(dur / 0.045)
    for (let i = 0; i < n; i++) noise(0.04, 0.025 + (i / n) * 0.03, 260, 'lowpass', i * 0.045)
  },
  card: () => {
    noise(0.03, 0.06, 4200, 'highpass')
    tone(660, 0.1, 'triangle', 0.035)
  },
  /** the decision: a brass chord resolving up */
  decision: () => {
    ;[262, 330, 392].forEach((f) => hold(f, 0.3, 'sawtooth', 0.016))
    ;[349, 440, 523, 698].forEach((f) => hold(f, 0.9, 'sawtooth', 0.015, 0.3))
    kaijuSfx.crowd(0.8, 2.6)
  },
  /** your bets paid: coins and a fanfare, bigger for a big win */
  win: (big = false) => {
    for (let i = 0; i < (big ? 12 : 6); i++) tone(r(1500, 2300), 0.07, 'square', 0.014, i * 0.045)
    ;[784, 988, 1175].forEach((f, i) => tone(f, 0.18, 'triangle', 0.05, 0.1 + i * 0.07))
    tone(1568, 0.5, 'sine', 0.03, 0.32)
    if (big) {
      reverseCymbal(0.4, 0.03)
      ;[1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.7, 'sine', 0.018, 0.42 + i * 0.07, undefined, [6, 9]))
    }
  },
  /** nothing won */
  lose: () => {
    tone(392, 0.16, 'triangle', 0.03)
    tone(311, 0.28, 'triangle', 0.03, 0.12)
  },
  /** the next round opens */
  open: () => {
    tone(659, 0.09, 'triangle', 0.035)
    tone(988, 0.16, 'triangle', 0.03, 0.08)
  },
}
