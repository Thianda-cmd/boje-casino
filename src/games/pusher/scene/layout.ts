import { FRONT_Z, HOPPER } from '../geom'
import { LOWER_TOP, UPPER_PUSH_H } from '../world'

/*
  The cabinet's own measures, on top of the simulation's (geom.ts, re-exported here so the scene reads one module).
  The simulation only knows the field; these place what the player sees round it: the side panels, the glass, the
  marquee and the gantry, and the heights of the shelf and the pushers (the pushers' from the physics, world.ts).
*/

export * from '../geom'

export const CAB = {
  /** the front of the side panels, where the glass stands */
  z: 3.75,
  /** the front edge of the lower tier (geom FRONT_Z) */
  edge: FRONT_Z,
  /** the side panels' height at the front and at the back (the back wall's top: the marquee stands on it) */
  top: 4.7,
  backTop: 7.0,
  /** the foot of the cabinet */
  base: -5.2,
  /** the side panels' outer faces, and their inner faces over the gutters (the gutter's outer edge) */
  outer: 7.0,
  gutter: 6.4,
  /** the underside of the upper shelf: its front comes down to the lower plate, to scrape off what rides it */
  shelfBottom: LOWER_TOP + 0.03,
  /** the pushers' heights: the upper block over its tier, the lower plate over the floor */
  upperPushH: UPPER_PUSH_H,
  lowerPushH: LOWER_TOP,
  /** the glass front's lower edge (things go over the front edge under it) */
  glassBottom: 0.9,
  /** the gantry's crossbar, which the hopper hangs from: a little in front of it, so that from the camera it passes
   *  below the slot's carriage rather than over it */
  gantryY: 8.8,
  gantryZ: HOPPER.z + 1.3,
  /** the hopper's size (its bowl's proportions are drawn at 1), and its pins (it tips about them) sit this far above
   *  its spout (geom HOPPER.y, where the simulation's coins come out) */
  hopperSize: 1.45,
  bucketPivot: 1.0,
  /** how deep the gutters go (the physics loses a coin from sight at world.ts GUTTER_GONE_Y) */
  gutterDepth: 2.9,
}
