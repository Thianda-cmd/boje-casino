import type * as THREE from 'three'
import type { Action, KaijuId, KaijuRig } from '../types'
import type { Quality } from './rig'
import { buildRexor } from './rexor'
import { buildGorrath } from './gorrath'
import { buildTitan } from './titan'
import { buildKraka } from './kraka'
import { buildLumina } from './lumina'
import { buildPincer } from './pincer'
import { buildBedrock } from './bedrock'
import { buildVoltra } from './voltra'

/*
  The eight kaiju as 3D rigs (types.ts KaijuRig), each modelled in code in its own file on the shared kit (rig.ts:
  one skinned toon mesh per kaiju, ink outlines, glowing parts that bloom), posed through the shared motion channels
  (motion.ts) mapped onto its own joints. buildKaiju(id, quality) makes one: feet on y = 0, facing +z, standing
  height = rig.height. 'low' quality is for phones: fewer segments everywhere, the same joints and poses.
*/

const BUILD: Record<KaijuId, (q?: Quality) => KaijuRig> = {
  rexor: buildRexor,
  gorrath: buildGorrath,
  titan: buildTitan,
  kraka: buildKraka,
  lumina: buildLumina,
  pincer: buildPincer,
  bedrock: buildBedrock,
  voltra: buildVoltra,
}

export function buildKaiju(id: KaijuId, quality: Quality = 'high'): KaijuRig {
  return BUILD[id](quality)
}

/** the striking point an attack lands with (a fist, a claw, a club, the jaws, the tail tip, a foot); the first
 *  striker for anything a kaiju has no special point for. A beam, breath or gust comes from rig.mouth instead. */
export function strikerFor(rig: KaijuRig, action: Action): THREE.Object3D {
  const hits = rig.group.userData.hits as Partial<Record<Action, number>> | undefined
  return rig.strikers[hits?.[action] ?? 0] ?? rig.strikers[0]
}

export type { Quality }
export { IMPACT, POSE_IMPACT, LOOP_S, NATURAL_S, LOOPS, strikeT } from './motion'
