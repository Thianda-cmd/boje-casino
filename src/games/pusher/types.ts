/*
  Coin Cascade's shared types: what the rules, the coin-field simulation, the 3D machine and the page agree on.

  Coin Cascade is a coin pusher. The player drops a coin (the stake) into a neon arcade machine with two tiers: coins
  and prizes on the upper tier are shoved off its front by a pusher onto the lower tier, where a second pusher shoves
  them toward the front edge. Whatever goes over the front edge drops into the win tray and is paid; whatever slides
  off the sides of the lower tier falls into the gutters and is lost. Each drop's result is drawn first (rules.ts:
  what falls into the tray, so its payout, at exact odds returning 97%), then the simulation (sim.ts) plays a drop in
  which exactly those things go over the edge, and the 3D machine (scene/) shows it.
*/

/** what can be on the field; the ids are stored in the field and the history: never rename one */
export type ItemKind = 'silver' | 'gold' | 'gem' | 'bar' | 'idol' | 'crown'
export const ITEM_KINDS: readonly ItemKind[] = ['silver', 'gold', 'gem', 'bar', 'idol', 'crown']
export const PRIZE_KINDS: readonly ItemKind[] = ['gem', 'bar', 'idol', 'crown']

/** what each thing pays when it falls into the tray, times the stake of the drop that tipped it over */
export const VALUE: Record<ItemKind, number> = { silver: 0.25, gold: 1, gem: 5, bar: 25, idol: 100, crown: 500 }

/** something on the field: where it is (world units, geom.ts), which way it faces and how it is tilted (radians) */
export interface Item {
  id: number
  kind: ItemKind
  x: number
  y: number
  z: number
  yaw: number
  /** tilt about x and z: a coin leaning on another, a prize tipping over the edge */
  tiltX: number
  tiltZ: number
}

/** the machine's field as it stands between drops (kept per player on the device, so the machine is "yours") */
export interface Field {
  v: 1
  items: Item[]
  nextId: number
}

/** the special moment a drop can bring, part of its drawn result */
export type Feature =
  | 'none'
  | 'shower' // the hopper above the lower tier tips and pours a stream of coins onto it
  | 'quake' // the machine shudders and both pushers surge (a big push)

/** a drop's result, drawn before anything moves (rules.ts drawDrop) */
export interface DropResult {
  /** how many of each kind fall into the tray */
  wins: Record<ItemKind, number>
  /** the payout as a multiple of the stake: the sum of VALUE over `wins` */
  mult: number
  feature: Feature
}

/*
  A drop as the simulation played it (sim.ts runDrop): every moving body's track, frame by frame, plus the pushers, so
  the 3D machine (and the tests) can play it at any speed and land exactly where the simulation did. Things that don't
  move during the drop keep their place in the field the drop started from.
*/
export interface Run {
  /** seconds of machine time per frame */
  step: number
  /** frames in the drop; the last is where everything rests (the pushers parked) */
  frames: number
  /** the pushers' front faces, two numbers a frame: upper z, lower z */
  pushers: Float32Array
  /** every body that moves (or appears) during the drop */
  tracks: Track[]
  /** moments for sounds, effects and the camera, in frame order */
  events: RunEvent[]
  /** the field once the drop has settled: what is saved and shown until the next drop */
  after: Field
}

export interface Track {
  id: number
  kind: ItemKind
  /** the first frame it is on show (the dropped coin and a shower's coins appear part-way) */
  from: number
  /** the last frame it is on show (one that falls into the tray or a gutter is gone after) */
  to: number
  /** its pose for frames from..to, six numbers a frame: x, y, z, yaw, tiltX, tiltZ */
  data: Float32Array
  /** where it ends up */
  fate: 'field' | 'tray' | 'gutter'
}

export type RunEvent =
  | { f: number; kind: 'drop'; id: number; x: number } // the player's coin leaves the slot
  | { f: number; kind: 'land'; id: number; item: ItemKind } // something lands on a tier (a coin's clink, a prize's thud)
  | { f: number; kind: 'edge'; id: number; item: ItemKind } // something tips over the front edge (paid)
  | { f: number; kind: 'tray'; id: number; item: ItemKind } // it lands in the tray (the counter adds it)
  | { f: number; kind: 'gutter'; id: number; item: ItemKind } // something slides off the side (lost)
  | { f: number; kind: 'shower' } // the hopper tips
  | { f: number; kind: 'quake' } // the machine shudders
  | { f: number; kind: 'feed' } // the hopper drops a few coins to keep the field stocked (not a Shower: a small dribble)
  | { f: number; kind: 'restock'; id: number; item: ItemKind } // a prize that fell is replaced: it drops in from above onto the upper tier

/** what a settled drop tells the wallet (BetEvent.meta): the counts by kind, the multiplier and the feature */
export type PusherMeta = Record<ItemKind, number> & { mult: number; feature: Feature }

/*
  The 3D machine (Machine.tsx), as the page drives it: it shows `field` while it waits and plays `play.run` when one is
  handed to it (a new `play.key` for each drop), at `play.speed` times machine time (turbo), calling onEvent as each
  event's frame is reached and onDone once the run's last frame is on show. While waiting, the drop slot's carriage
  sits at `aim` (-1 far left, 1 far right).
*/
export interface MachineProps {
  field: Field
  play: { run: Run; speed: number; key: string } | null
  aim: number
  onEvent?: (e: RunEvent) => void
  onDone?: (key: string) => void
  /** where the cabinet's display panel is on the machine's element (CSS px from its top left), for the page's win
   *  counter; told when the machine is up and whenever it moves (a resize, the camera's push-in), null before */
  onDisplay?: (r: { x: number; y: number; w: number; h: number } | null) => void
  className?: string
}
