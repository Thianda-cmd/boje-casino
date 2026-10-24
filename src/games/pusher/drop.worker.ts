import { runDrop } from './sim'
import type { DropResult, Field, Run } from './types'

/*
  Works a drop out off the main thread. A drop's simulation (sim.ts runDrop) takes a few tens of milliseconds, and a
  few hundred for one that brings a prize, so on the page's own thread it would freeze the cabinet's lights, the
  button under the player's finger and any celebration still on screen. Here it costs the page nothing.

  In: { id, field, result, aim, seed } (runDrop's arguments). Out: { id, run }, with the run's frame arrays handed
  over rather than copied, or { id, error } if the drop could not be worked out.
*/

export interface DropRequest {
  id: number
  field: Field
  result: DropResult
  aim: number
  seed: number
}

export type DropReply = { id: number; run: Run } | { id: number; error: string }

self.onmessage = (e: MessageEvent<DropRequest>) => {
  const { id, field, result, aim, seed } = e.data
  let reply: DropReply
  try {
    reply = { id, run: runDrop(field, result, aim, seed) }
  } catch (err) {
    reply = { id, error: String(err) }
  }
  const run = 'run' in reply ? reply.run : null
  const buffers = run ? [run.pushers.buffer as ArrayBuffer, ...run.tracks.map((t) => t.data.buffer as ArrayBuffer)] : []
  self.postMessage(reply, { transfer: buffers })
}
