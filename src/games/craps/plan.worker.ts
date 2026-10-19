import { planThrow, type Pose, type Roll } from './physics'
import type { Die } from './rules'

/*
  Works a throw out off the main thread. Finding a throw that lands well takes a few milliseconds a try and now and
  then a few tries, and it runs as the stickman sends the dice back and the shooter shakes them, so on the page's own
  thread it could stall a frame of the 3D table. Here it costs the page nothing.

  In: { id, start, faces, quick } (physics.ts planThrow's arguments). Out: { id, roll }, with the record's sample
  arrays handed over rather than copied, or { id, error } if no throw could be found.
*/

export interface PlanRequest {
  id: number
  start: Pose[]
  faces: Die[]
  quick: boolean
}

export type PlanReply = { id: number; roll: Roll } | { id: number; error: string }

self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, start, faces, quick } = e.data
  let reply: PlanReply
  try {
    reply = { id, roll: planThrow(start, faces, { quick }) }
  } catch (err) {
    reply = { id, error: String(err) }
  }
  const s = 'roll' in reply ? reply.roll.sim : null
  self.postMessage(reply, { transfer: s ? [s.pos.buffer as ArrayBuffer, s.quat.buffer as ArrayBuffer] : [] })
}
