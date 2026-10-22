import type { ReactNode } from 'react'
import { useUid } from './ids'

/*
  Player avatars: a glossy gradient disc with a white emblem, picked by index. The first sixteen are free for everyone;
  the sixteen after them are earned or bought (src/store/cosmetics.ts names them: Clover, Horseshoe, Lucky Seven,
  Golden Dice, Platinum Chip, Diamond, Rocket, Pirate, Robot, Dragon, Wizard, Ninja, Phoenix, Bullseye, Golden Whale
  and The Banker). A few of the precious ones tint their emblem (the third colour) instead of drawing it white.
*/

export const AVATAR_COUNT = 32

const COLORS: ([string, string] | [string, string, string])[] = [
  ['#ffd36e', '#ff8a3d'],
  ['#7b5cff', '#3fb8ff'],
  ['#34e08a', '#0f8f6a'],
  ['#ff6fa8', '#ff4d61'],
  ['#ffe066', '#f0a020'],
  ['#6f7dff', '#2a2f8f'],
  ['#3ee08f', '#16704a'],
  ['#a9b5d4', '#4b5675'],
  ['#ff7b9a', '#c2185b'],
  ['#6ee7ff', '#2f7bff'],
  ['#d3b8ff', '#7b5cff'],
  ['#ffab6b', '#e2523a'],
  ['#ffc2dc', '#ff6fa8'],
  ['#eef1fa', '#8a94b3'],
  ['#64f0c8', '#2a9df4'],
  ['#ff8a5c', '#ffcd4d'],
  // 16-31: earned and bought
  ['#86f5a4', '#0f7d45'],
  ['#9fd8ff', '#2a58b8'],
  ['#fff07a', '#ff4430'],
  ['#ffe98f', '#c27408', '#fffbea'],
  ['#f4fbff', '#6c829f'],
  ['#e2d6ff', '#6236db', '#fdfcff'],
  ['#ffb46b', '#ff3d6e'],
  ['#ff9468', '#7a1630'],
  ['#8af3ff', '#2f6fd6'],
  ['#ff8240', '#8b1ea8'],
  ['#a690ff', '#271c86'],
  ['#7d8aa8', '#141a2c'],
  ['#ffb347', '#c0144f'],
  ['#ff7088', '#7a0f2a'],
  ['#5fe0ff', '#0b4a96', '#ffe28a'],
  ['#3c4862', '#0b101c', '#ffd56b'],
]

// each emblem is drawn in a 24x24 box; `d` is the dark detail colour, `f` the emblem's own colour (for strokes)
const EMBLEMS: ((d: string, f: string) => ReactNode)[] = [
  () => (
    <>
      <path d="M4 16.5h16l1.2-9-5.2 3.6L12 4.5 8 11.1 2.8 7.5z" />
      <rect x="4" y="18" width="16" height="2.4" rx="1" />
    </>
  ),
  () => <path d="M13.8 2 5 13.6h6.1L9.6 22 19 9.6h-6.3z" />,
  (d) => (
    <>
      <path d="M7 4h10l4 5-9 11.5L3 9z" />
      <path d="M3 9h18M9.5 4 8 9l4 11.5L16 9l-1.5-5" fill="none" stroke={d} strokeOpacity=".45" strokeWidth="1.1" strokeLinejoin="round" />
    </>
  ),
  (d) => (
    <>
      <path d="M12 2.2c.8 3.6 5.8 5.6 5.8 11a5.8 5.8 0 0 1-11.6 0c0-2.8 1.7-4.4 2.1-6.6 1.8 1.2 2.6 2.8 2.7 4.6 1.6-1.4 2-4.8 1-9z" />
      <path d="M12 21c-1.8 0-3-1.3-3-3 0-1.8 1.6-2.8 2.2-4.3 1.6 1.2 3.8 2.4 3.8 4.3 0 1.7-1.2 3-3 3z" fill={d} fillOpacity=".4" />
    </>
  ),
  () => <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.2 1.2-6.5-4.8-4.6 6.6-.9z" />,
  (d) => (
    <>
      <path d="M15.6 3A9 9 0 1 0 21 15.6 7.2 7.2 0 0 1 15.6 3z" />
      <circle cx="9" cy="14" r="1.3" fill={d} fillOpacity=".35" />
      <circle cx="12.5" cy="17.5" r=".9" fill={d} fillOpacity=".35" />
    </>
  ),
  (d) => (
    <>
      <circle cx="12" cy="7.6" r="3.6" />
      <circle cx="7.6" cy="12" r="3.6" />
      <circle cx="16.4" cy="12" r="3.6" />
      <circle cx="12" cy="16.2" r="3.6" />
      <path d="M12 12c0 4 1 7 3 9.4" fill="none" stroke={d} strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  () => <path d="M12 2C8.3 6.8 4 9.6 4 13.6A4 4 0 0 0 10.8 16.4L9.4 21.5h5.2l-1.4-5.1A4 4 0 0 0 20 13.6C20 9.6 15.7 6.8 12 2z" />,
  () => <path d="M12 21.2s-8.4-5.3-8.4-11.3a4.6 4.6 0 0 1 8.4-2.6 4.6 4.6 0 0 1 8.4 2.6c0 6-8.4 11.3-8.4 11.3z" />,
  (d) => (
    <>
      <path d="M12 2c3.2 2.2 5.2 6.2 5.2 10.4l-1.8 4.2H8.6l-1.8-4.2C6.8 8.2 8.8 4.2 12 2z" />
      <path d="M6.8 12.4 3.6 15.6l.4 3.2 3.6-2.2zM17.2 12.4l3.2 3.2-.4 3.2-3.6-2.2z" />
      <circle cx="12" cy="9.4" r="2.1" fill={d} fillOpacity=".55" />
      <path d="M10 17.8h4l-.8 3.6h-2.4z" fill={d} fillOpacity=".45" />
    </>
  ),
  (d) => (
    <>
      <path d="M5 21.4V11a7 7 0 0 1 14 0v10.4l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2z" />
      <ellipse cx="9.4" cy="11" rx="1.5" ry="2" fill={d} fillOpacity=".7" />
      <ellipse cx="14.6" cy="11" rx="1.5" ry="2" fill={d} fillOpacity=".7" />
    </>
  ),
  (d) => (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      {[
        [8, 8],
        [16, 8],
        [12, 12],
        [8, 16],
        [16, 16],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill={d} fillOpacity=".7" />
      ))}
    </>
  ),
  (d) => (
    <>
      <path d="M4.5 3.5 9 8h6l4.5-4.5V13a7.5 7.5 0 0 1-15 0z" />
      <ellipse cx="9" cy="12.6" rx="1.3" ry="1.8" fill={d} fillOpacity=".7" />
      <ellipse cx="15" cy="12.6" rx="1.3" ry="1.8" fill={d} fillOpacity=".7" />
      <path d="M11 16h2l-1 1.2z" fill={d} fillOpacity=".7" />
    </>
  ),
  (d) => (
    <>
      <path d="M12 2.6a8.2 8.2 0 0 0-8.2 8.2c0 3 1.4 4.6 3.2 5.7v3.9h10v-3.9c1.8-1.1 3.2-2.7 3.2-5.7A8.2 8.2 0 0 0 12 2.6z" />
      <circle cx="8.7" cy="11.4" r="2.2" fill={d} fillOpacity=".7" />
      <circle cx="15.3" cy="11.4" r="2.2" fill={d} fillOpacity=".7" />
      <path d="M10 20.4v-2.6M14 20.4v-2.6M12 20.4v-2.6" stroke={d} strokeOpacity=".5" strokeWidth="1" />
    </>
  ),
  (d) => (
    <>
      <circle cx="12" cy="12" r="6.2" />
      <ellipse cx="12" cy="12" rx="10.6" ry="3.4" transform="rotate(-24 12 12)" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M8.2 9.6a4.6 4.6 0 0 1 4.8-2.8" fill="none" stroke={d} strokeOpacity=".35" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  (d) => (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="7" fill="none" stroke={d} strokeOpacity=".5" strokeWidth="2.6" strokeDasharray="3.66 3.66" />
      <circle cx="12" cy="12" r="4.2" fill={d} fillOpacity=".3" />
    </>
  ),
  // 16 Clover: four heart leaves on a curling stem
  (d, f) => (
    <g transform="translate(12 12) scale(1.12) translate(-12 -11.6)">
      <path d="M12.2 11.8c.2 3.4 1.2 6.4 3.4 9" fill="none" stroke={f} strokeWidth="2" strokeLinecap="round" />
      {[45, 135, 225, 315].map((a) => (
        <path key={a} transform={`rotate(${a} 12 11)`} d="M12 11C9.3 9.3 7.6 7.4 8.5 5.3c.8-1.9 2.9-1.9 3.5-.4.6-1.5 2.7-1.5 3.5.4.9 2.1-.8 4-3.5 5.7z" />
      ))}
      {[45, 135, 225, 315].map((a) => (
        <path key={a} transform={`rotate(${a} 12 11)`} d="M12 8.6c-.9-.9-1.4-1.8-1.3-2.6" fill="none" stroke={d} strokeOpacity=".28" strokeWidth=".8" strokeLinecap="round" />
      ))}
      <circle cx="12" cy="11" r="1.1" fill={d} fillOpacity=".3" />
    </g>
  ),
  // 17 Horseshoe: open end up, six nail holes
  (d, f) => (
    <g transform="translate(0 1.8)">
      <path d="M6.8 4.6v5.6a5.2 5.2 0 0 0 10.4 0V4.6" fill="none" stroke={f} strokeWidth="4.4" />
      <rect x="3.9" y="2.4" width="5.8" height="2.8" rx=".9" />
      <rect x="14.3" y="2.4" width="5.8" height="2.8" rx=".9" />
      {[
        [6.8, 7.2],
        [7.5, 12.8],
        [9.8, 14.9],
        [14.2, 14.9],
        [16.5, 12.8],
        [17.2, 7.2],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r=".85" fill={d} fillOpacity=".55" />
      ))}
    </g>
  ),
  // 18 Lucky Seven: a slot-machine seven with two glints
  (d) => (
    <>
      <path d="M5.2 3.6h13.6v3.3L12.6 20.6H8.2l5.9-13.1H8.6v1.6H5.2z" />
      <path d="M17.4 6.6 11.6 19.4" fill="none" stroke={d} strokeOpacity=".22" strokeWidth="1" strokeLinecap="round" />
      <path d="M19.8 12.2l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z" />
      <path d="M4.4 13.4l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5z" />
    </>
  ),
  // 19 Golden Dice: a pair, one tumbling behind the other
  (d) => (
    <>
      <g transform="rotate(16 15.4 8.6)">
        <rect x="10.6" y="3.8" width="9.6" height="9.6" rx="2.2" fillOpacity=".72" />
        {[
          [13, 6.2],
          [15.4, 8.6],
          [17.8, 11],
        ].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="1.05" fill={d} fillOpacity=".7" />
        ))}
      </g>
      <g transform="rotate(-12 9 14.6)">
        <rect x="3.2" y="8.8" width="11.6" height="11.6" rx="2.6" stroke={d} strokeOpacity=".4" strokeWidth="1.1" />
        {[
          [6.1, 11.7],
          [11.9, 11.7],
          [9, 14.6],
          [6.1, 17.5],
          [11.9, 17.5],
        ].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill={d} fillOpacity=".75" />
        ))}
      </g>
    </>
  ),
  // 20 Platinum Chip: a short stack seen from above, edge spots on the sides
  (d) => (
    <g transform="translate(0 -.4)">
      <path d="M4 8.4v8.2c0 2.1 3.6 3.8 8 3.8s8-1.7 8-3.8V8.4z" />
      <ellipse cx="12" cy="8.4" rx="8" ry="3.8" />
      <path d="M4 8.4c0 2.1 3.6 3.8 8 3.8s8-1.7 8-3.8M4 11.2c0 2.1 3.6 3.8 8 3.8s8-1.7 8-3.8M4 13.9c0 2.1 3.6 3.8 8 3.8s8-1.7 8-3.8" fill="none" stroke={d} strokeOpacity=".42" strokeWidth=".9" />
      <path d="M6.4 12.2v1.8M12 13v1.8M17.6 12.2v1.8M6.4 14.9v1.8M12 15.7v1.8M17.6 14.9v1.8M9.2 18.5v1.6M14.8 18.5v1.6" stroke={d} strokeOpacity=".5" strokeWidth="1.4" />
      <ellipse cx="12" cy="8.4" rx="5.1" ry="2.3" fill="none" stroke={d} strokeOpacity=".45" strokeWidth="1" strokeDasharray="1.6 1.4" />
      <path d="M12 6.8l.55 1.1 1.2.18-.87.84.2 1.2L12 9.55l-1.08.57.2-1.2-.87-.84 1.2-.18z" fill={d} fillOpacity=".5" />
    </g>
  ),
  // 21 Diamond: a brilliant cut with its facets, and two sparkles
  (d) => (
    <>
      <path d="M7.4 5.2h9.2l4.2 4.6L12 20.8 3.2 9.8z" />
      <path d="M3.2 9.8 12 20.8 9.6 9.8z" fill={d} fillOpacity=".14" />
      <path d="M14.4 9.8 12 20.8l8.8-11z" fill={d} fillOpacity=".26" />
      <path d="M3.2 9.8h17.6M7.4 5.2l2.2 4.6L12 5.2l2.4 4.6 2.2-4.6M9.6 9.8 12 20.8l2.4-11" fill="none" stroke={d} strokeOpacity=".42" strokeWidth=".95" strokeLinejoin="round" />
      <path d="M20.2 1.4l.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55z" />
      <path d="M3.4 2.4l.4.9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4z" />
    </>
  ),
  // 22 Rocket: climbing at an angle on its flame, with speed lines
  (d, f) => (
    <>
      <path d="M2.8 15.6l2-2.2M4.6 19.6l2.4-2.6M8.4 22l1.4-1.6" stroke={f} strokeOpacity=".75" strokeWidth="1.4" strokeLinecap="round" />
      <g transform="rotate(42 12 12)">
        <path d="M9.8 16.2h4.4c0 2.5-1.1 4.6-2.2 5.8-1.1-1.2-2.2-3.3-2.2-5.8z" fillOpacity=".7" />
        <path d="M12 1.8c2.7 2 4.1 5.1 4.1 8.8v4.6H7.9v-4.6c0-3.7 1.4-6.8 4.1-8.8z" />
        <path d="M7.9 10.8 4.8 14.4v3.4l3.1-1.7zM16.1 10.8l3.1 3.6v3.4l-3.1-1.7z" />
        <circle cx="12" cy="8.6" r="1.9" fill={d} fillOpacity=".6" />
        <path d="M8 13.3h8" stroke={d} strokeOpacity=".3" strokeWidth="1" />
      </g>
    </>
  ),
  // 23 Pirate: a tricorn hat with the skull and crossbones
  (d, f) => (
    <g transform="translate(12 12.4) scale(1.16) translate(-12 -10.2)">
      <path d="M1.8 10.4c2.2-1.5 4.6-1.6 6.2-.7C9 6.2 10.4 4.4 12 4.4s3 1.8 4 5.3c1.6-.9 4-.8 6.2.7-1.2 3.4-5.2 5.6-10.2 5.6S3 13.8 1.8 10.4z" />
      <path d="M3.8 12.8c2.4 1.5 5.2 2.2 8.2 2.2s5.8-.7 8.2-2.2" fill="none" stroke={d} strokeOpacity=".35" strokeWidth="1" />
      <path d="M9 7.6l6 4.8M15 7.6l-6 4.8" stroke={d} strokeOpacity=".72" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12" cy="9" r="2.3" fill={d} fillOpacity=".85" />
      <rect x="10.8" y="10.4" width="2.4" height="1.7" rx=".45" fill={d} fillOpacity=".85" />
      <circle cx="11.15" cy="9" r=".55" fill={f} />
      <circle cx="12.85" cy="9" r=".55" fill={f} />
    </g>
  ),
  // 24 Robot: antenna, square eyes and a grille
  (d, f) => (
    <>
      <path d="M12 6.4V3.8" stroke={f} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="3" r="1.6" />
      <rect x="2.6" y="10.6" width="2.6" height="5" rx="1" />
      <rect x="18.8" y="10.6" width="2.6" height="5" rx="1" />
      <rect x="4.6" y="6.4" width="14.8" height="13" rx="3.4" />
      <rect x="7.3" y="9.6" width="3.5" height="3.5" rx=".9" fill={d} fillOpacity=".75" />
      <rect x="13.2" y="9.6" width="3.5" height="3.5" rx=".9" fill={d} fillOpacity=".75" />
      <circle cx="8.5" cy="10.8" r=".65" fill={f} />
      <circle cx="14.4" cy="10.8" r=".65" fill={f} />
      <rect x="8" y="15.2" width="8" height="2.1" rx="1.05" fill={d} fillOpacity=".55" />
      <path d="M10 15.2v2.1M12 15.2v2.1M14 15.2v2.1" stroke={f} strokeWidth=".8" />
    </>
  ),
  // 25 Dragon: a horned head in profile, jaws open, a frill of spikes down its neck
  (d, f) => (
    <>
      <path d="M8.6 7.4 1.8 4.4l5.4 4.6zM11.2 6.4 5.6 1.8l3.8 5.2z" />
      <path d="M5.6 11.6 2.4 12.2l3 1.6zM5 15.2 1.8 16.2l3.1 1.2zM5.1 18.8 2.2 20.2l3 .8z" />
      <path d="M5.6 22C4.6 17.6 4.6 12.6 6.4 9.2 8.4 6.6 11.2 5.6 14.2 6.2l6.2 2.4c1.2.4 1.6 1.4 1.2 2.4l-6.2.6-2.6 1 6.6 1.8c.4 1 0 1.8-1 1.9l-5.6.6c-.6 1.8-.2 3.6.8 5.1z" />
      <path d="M15.6 11.6l.6 1.1.6-1.2zM17.8 11.4l.6 1.1.6-1.2z" fill={f} />
      <path d="M13 8.4l3.2.3-2.7 1.2z" fill={d} fillOpacity=".85" />
      <circle cx="19.9" cy="9.5" r=".55" fill={d} fillOpacity=".7" />
      <path d="M8.2 17c1.4-.6 2.4-1.6 3-2.8" fill="none" stroke={d} strokeOpacity=".35" strokeWidth=".9" strokeLinecap="round" />
    </>
  ),
  // 26 Wizard: a pointed hat with a star and a moon
  (d) => (
    <>
      <path d="M12.6 2.4c1.6-.6 3.6-.2 5 1.2-1.4-.3-2.6 0-3.4.8z" />
      <path d="M12.6 2.4C14.8 5.6 16.6 10.6 17.8 16.2H6.2C7.8 10.4 9.8 5.6 12.6 2.4z" />
      <ellipse cx="12" cy="17.4" rx="9.6" ry="2.7" />
      <path d="M2.8 17c2.4-.9 5.6-1.4 9.2-1.4s6.8.5 9.2 1.4" fill="none" stroke={d} strokeOpacity=".3" strokeWidth=".9" />
      <path d="M7 13.9c3.4 1 6.6 1 10 0l.4 1.9c-3.6 1-7.2 1-10.8 0z" fill={d} fillOpacity=".4" />
      <path d="M11.4 7.4l.55 1.1 1.2.2-.88.85.2 1.2-1.07-.56-1.07.56.2-1.2-.88-.85 1.2-.2z" fill={d} fillOpacity=".5" />
      <path d="M14.8 11.6a1.7 1.7 0 1 1-1.4-2.6 1.4 1.4 0 0 0 1.4 2.6z" fill={d} fillOpacity=".5" />
      <circle cx="9.6" cy="12.2" r=".7" fill={d} fillOpacity=".45" />
    </>
  ),
  // 27 Ninja: a hood with the eye slit and the headband's tails
  (d) => (
    <>
      <path d="M18.6 7.6l3.8-2.4-1 3 2 1.6-4.4.4z" />
      <circle cx="11.6" cy="12.2" r="8.6" />
      <path d="M4.4 7c4-1.6 9.6-1.6 13.6 0" fill="none" stroke={d} strokeOpacity=".5" strokeWidth="1.4" />
      <rect x="3.2" y="9.6" width="16.8" height="4.6" rx="2.3" fill={d} fillOpacity=".85" />
      <path d="M6.4 11.3c1.3-.6 2.8-.5 4 .3-1.3.9-2.8 1-4-.3zM16.8 11.3c-1.3-.6-2.8-.5-4 .3 1.3.9 2.8 1 4-.3z" />
      <path d="M7 17.6c2.8 1 6.4 1 9.2 0" fill="none" stroke={d} strokeOpacity=".25" strokeWidth="1" />
    </>
  ),
  // 28 Phoenix: wings of flame raised high, a flame for a tail
  (d) => (
    <>
      {['', 'matrix(-1 0 0 1 24 0)'].map((t) => (
        <g key={t} transform={t || undefined}>
          <path d="M11 11.6C9.2 8.4 6.6 5.8 2.2 4.4c1.7 1.4 2.6 2.8 2.9 4.1-1.3-.4-2.6-.4-3.6.1 1.9.9 3.2 2.1 4 3.5-1.1 0-2.1.3-2.8.9 2.7.4 5.3 1.1 8 2.1z" />
          <path d="M10.4 12.4C8.8 10 7 8.6 4.6 7.6c.9 1.1 1.4 2.2 1.5 3.2 1.4.4 2.8 1 4.3 1.6z" fill={d} fillOpacity=".2" />
        </g>
      ))}
      <path d="M10.3 15.6c-1.5 2.2-1.6 4.4-.4 6.8.3-1.6.9-2.7 2.1-3.6 1.2.9 1.8 2 2.1 3.6 1.2-2.4 1.1-4.6-.4-6.8-.5.6-1.1 1-1.7 1.2-.6-.2-1.2-.6-1.7-1.2z" />
      <path d="M12 6.8c1.5 0 2.4 1.1 2.4 2.7 0 3-.8 5.7-2.4 7.8-1.6-2.1-2.4-4.8-2.4-7.8 0-1.6.9-2.7 2.4-2.7z" />
      <circle cx="12" cy="5.6" r="1.9" />
      <path d="M11 3.9c-.5-1.1-.3-2.2.5-3 .1.9.4 1.4 1 1.8.2-.8.7-1.2 1.4-1.5-.2 1-.1 1.9.4 2.7z" />
      <path d="M11.3 9.2c.4.4 1 .4 1.4 0M11.5 11.4c.3.3.7.3 1 0" fill="none" stroke={d} strokeOpacity=".3" strokeWidth=".8" strokeLinecap="round" />
      <circle cx="11.3" cy="5.5" r=".42" fill={d} fillOpacity=".85" />
      <circle cx="12.7" cy="5.5" r=".42" fill={d} fillOpacity=".85" />
    </>
  ),
  // 29 Bullseye: the board with a dart in the bull
  (d, f) => (
    <>
      <circle cx="10.6" cy="13.4" r="8.4" />
      <circle cx="10.6" cy="13.4" r="6.2" fill={d} fillOpacity=".55" />
      <circle cx="10.6" cy="13.4" r="4" fill={f} />
      <circle cx="10.6" cy="13.4" r="1.9" fill={d} fillOpacity=".75" />
      <path d="M10.6 13.4 16.4 7.6" stroke={d} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15.8 8.2l2.8-2.8" stroke={f} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M18 6 18.8 1.4l1.4 2.2 2.2 1.4z" />
    </>
  ),
  // 30 Golden Whale: spouting, its tail up
  (d, f) => (
    <>
      <path d="M8.4 7.6c-.1-1.8-1-3-2.4-3.8M8.8 7.4c.3-2 1.2-3.2 2.6-3.8M8.6 7.2V3.2" fill="none" stroke={f} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2.2 13.8c0-3.6 3.8-6 8.6-6 4.2 0 7.2 1.8 8.6 4.4l1.8-3.2c.4-.6 1.4-.4 1.4.4l-.2 3.2 1.6 1.4c.5.5.1 1.3-.6 1.2l-2.6-.4c-1.6 2.8-5.2 4.6-9.6 4.6-5 0-8.4-2.2-8.4-5.6z" />
      <path d="M3.6 15.8c3.2 2 9 2.2 12.6.2" fill="none" stroke={d} strokeOpacity=".4" strokeWidth=".9" />
      <path d="M11.2 12.2c-.4 1.4-.2 2.6.6 3.6" fill="none" stroke={d} strokeOpacity=".35" strokeWidth=".9" strokeLinecap="round" />
      <circle cx="6.4" cy="12.6" r=".95" fill={d} fillOpacity=".8" />
    </>
  ),
  // 31 The Banker: top hat, monocle and moustache, and the bow tie
  (d) => (
    <>
      <rect x="7.2" y="1.6" width="9.6" height="7.6" rx="1.1" />
      <rect x="7.2" y="6.6" width="9.6" height="1.7" fill={d} fillOpacity=".55" />
      <ellipse cx="12" cy="9.4" rx="7.6" ry="1.6" />
      <path d="M6.6 10.6c-.2 4.8 2 8.6 5.4 8.6s5.6-3.8 5.4-8.6c-1.6.5-3.4.7-5.4.7s-3.8-.2-5.4-.7z" />
      <path d="M12 15.6c-1.2-1.2-3.2-1.4-4.6-.4.4 1.2 2.8 1.6 4.6.4zm0 0c1.2-1.2 3.2-1.4 4.6-.4-.4 1.2-2.8 1.6-4.6.4z" fill={d} fillOpacity=".8" />
      <circle cx="9.6" cy="13" r=".75" fill={d} fillOpacity=".8" />
      <circle cx="14.4" cy="13" r="1.7" fill="none" stroke={d} strokeOpacity=".75" strokeWidth=".9" />
      <circle cx="14.4" cy="13" r=".6" fill={d} fillOpacity=".75" />
      <path d="M16 13.6c1 1.6 1.2 3.4.6 5.4" fill="none" stroke={d} strokeOpacity=".5" strokeWidth=".7" />
      <path d="M8.8 20.2l3.2 1.3 3.2-1.3v2.6l-3.2-1.3-3.2 1.3z" />
    </>
  ),
]

export function Avatar({ index, size = 40, className = '', ring }: { index: number; size?: number; className?: string; ring?: string }) {
  const id = useUid()
  const i = ((Math.round(index) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT
  const [a, b, ink = '#fff'] = COLORS[i]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
        <radialGradient id={`${id}g`} cx=".3" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".45" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {ring && <circle cx="24" cy="24" r="23.5" fill={ring} />}
      <circle cx="24" cy="24" r={ring ? 21.5 : 24} fill={`url(#${id}b)`} />
      <circle cx="24" cy="24" r={ring ? 21.5 : 24} fill={`url(#${id}g)`} />
      <g transform="translate(11.5 11.5) scale(1.04)" fill={ink} fillOpacity=".96" style={{ filter: 'drop-shadow(0 1.5px 1.5px rgba(0,0,0,.25))' }}>
        {EMBLEMS[i](b, ink)}
      </g>
    </svg>
  )
}
