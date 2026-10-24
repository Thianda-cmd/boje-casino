/*
  Coin Cascade's machine in world units, shared by the simulation (sim.ts) and the 3D machine (scene/). x runs left to
  right across the field, y up, z toward the player; the camera looks from +z, a little from above.

  The field is FIELD_W wide between the side walls. The upper tier is a fixed shelf (floor at UPPER_Y) from the back
  wall to its front lip at UPPER_FRONT_Z; on it the upper pusher, a block whose front face slides between
  UPPER_PUSH_MIN and UPPER_PUSH_MAX, shoves coins forward and off the lip onto the lower tier. The lower tier (floor at
  y = 0) reaches from under the upper shelf to the front edge at FRONT_Z; the lower pusher is a plate that slides out
  from under the upper shelf, its front face moving between LOWER_PUSH_MIN and LOWER_PUSH_MAX. The machine runs
  when a coin is dropped: both pushers go out and back together, a whole number of PUSH_PERIOD cycles (pusherZ), and
  park at their MIN between drops, so nothing on the field moves while the machine waits (a Quake surges them further:
  the simulation's run carries where the pushers actually are, frame by frame). Over the front edge is the win chute down to the
  tray; along the sides of the lower tier, from GUTTER_Z0 to the front, the walls are open: off there is the gutter.

  The player's coin comes in through the drop slot at the top of the back wall, anywhere across SLOT_X of the middle,
  and lands on the upper tier just in front of the pusher. The hopper hangs over the middle of the lower tier and pours
  a Coin Shower onto it.
*/

/** a coin's radius and thickness */
export const COIN_R = 0.5
export const COIN_H = 0.12

/** the field between the side walls: x from -FIELD_W / 2 to FIELD_W / 2 */
export const FIELD_W = 11

/** the upper tier: a fixed shelf */
export const UPPER_Y = 1.6
export const BACK_Z = -9
export const UPPER_FRONT_Z = -3
/** the upper pusher's front face travels between these */
export const UPPER_PUSH_MIN = -9
export const UPPER_PUSH_MAX = -6.5

/** the lower tier: its floor is y = 0, and the plate slides out from under the upper shelf */
export const LOWER_PUSH_MIN = -3
export const LOWER_PUSH_MAX = -0.5
/** the front edge: past it, things fall into the win chute and the tray */
export const FRONT_Z = 3
/** from here to the front the side walls of the lower tier are open: off the side is the gutter */
export const GUTTER_Z0 = 1

/** where the tray is (things fall from the front edge down the chute into it) */
export const TRAY = { y: -3.2, z: 4.6, w: 9, d: 2.2 }

/** the drop slot: a coin comes in at x within ±SLOT_X, at the top of the back wall */
export const SLOT_X = 4.5
export const SLOT_Y = 6
/** where a dropped coin lands: on the upper tier, just in front of the pusher at its furthest back */
export const LAND_Z = -8.2

/** the hopper over the lower tier, which pours a Coin Shower */
export const HOPPER = { x: 0, y: 6.5, z: -1 }

/** how long one push cycle takes, s */
export const PUSH_PERIOD = 3

/** where a pusher's front face is t seconds into a drop: parked at min, out to max and back once a cycle */
export function pusherZ(min: number, max: number, t: number): number {
  const u = (t / PUSH_PERIOD) % 1
  // a smooth out-and-back: forward for the first half of the cycle, back for the second
  const k = u < 0.5 ? u * 2 : 2 - u * 2
  const s = k * k * (3 - 2 * k)
  return min + (max - min) * s
}
export const upperPusherZ = (t: number) => pusherZ(UPPER_PUSH_MIN, UPPER_PUSH_MAX, t)
export const lowerPusherZ = (t: number) => pusherZ(LOWER_PUSH_MIN, LOWER_PUSH_MAX, t)

/** prize sizes (their footprint on the field, w along x, d along z, and height) */
export const PRIZE_SIZE: Record<'gem' | 'bar' | 'idol' | 'crown', { w: number; d: number; h: number }> = {
  gem: { w: 0.8, d: 0.8, h: 0.7 },
  bar: { w: 1.5, d: 0.75, h: 0.5 },
  idol: { w: 1.1, d: 1.1, h: 1.7 },
  crown: { w: 1.4, d: 1.4, h: 1.0 },
}
