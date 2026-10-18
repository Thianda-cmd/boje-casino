import { planRoll, type Pose, type Roll } from './physics'
import type { Die } from './rules'

/*
  Works a roll out off the main thread. Finding a shake that lands well takes a few milliseconds a try and now and then
  a dozen tries (a few hundred milliseconds on a slow phone), and it runs while the lightning strikes play, so on the
  page's own thread it would freeze the bolts, the dome's flash and the 3D frame. Here it costs the page nothing.

  In: { id, start, faces, quick } (physics.ts planRoll's arguments). Out: { id, roll }, with the record's sample
  arrays handed over rather than copied, or { id, error } if no roll could be found.
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
    reply = { id, roll: planRoll(start, faces, { quick }) }
  } catch (err) {
    reply = { id, error: String(err) }
  }
  const s = 'roll' in reply ? reply.roll.sim : null
  self.postMessage(reply, { transfer: s ? [s.pos.buffer as ArrayBuffer, s.quat.buffer as ArrayBuffer, s.dome.buffer as ArrayBuffer, s.touch.buffer as ArrayBuffer] : [] })
}
