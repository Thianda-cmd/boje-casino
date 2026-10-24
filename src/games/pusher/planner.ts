import DropWorker from './drop.worker?worker&inline'
import type { DropReply, DropRequest } from './drop.worker'
import { runDrop } from './sim'
import type { DropResult, Field, Run } from './types'

/*
  Where the page has its drops worked out: in a worker (drop.worker.ts), started with the page so it is warm by the
  first drop, or here on the page's own thread if the browser can't start one, the worker fails, or it doesn't answer
  in time. The same field, result, aim and seed give the same run either way (sim.ts is deterministic).
*/

/** how long the worker may take over a drop before the page works it out itself (ms) */
const PATIENCE = 5000

export class DropPlanner {
  private worker: Worker | null = null
  private jobs = 0
  private waiting = new Map<number, (run: Run | null) => void>()
  private disposed = false

  constructor() {
    try {
      this.worker = new DropWorker()
      this.worker.onmessage = (e: MessageEvent<DropReply>) => {
        const r = e.data
        this.waiting.get(r.id)?.('run' in r ? r.run : null)
      }
      this.worker.onerror = () => this.drop()
    } catch {
      this.worker = null
    }
  }

  /** the drop played out (rejects only if it can't be worked out at all, which is never expected) */
  plan(field: Field, result: DropResult, aim: number, seed: number): Promise<Run> {
    const here = () => {
      if (this.disposed) throw new Error('gone')
      return runDrop(field, result, aim, seed)
    }
    const w = this.worker
    if (!w) return Promise.resolve().then(here)
    return new Promise<Run>((resolve, reject) => {
      const id = ++this.jobs
      const timer = window.setTimeout(() => this.waiting.get(id)?.(null), PATIENCE)
      this.waiting.set(id, (run) => {
        this.waiting.delete(id)
        clearTimeout(timer)
        if (run) return resolve(run)
        try {
          resolve(here())
        } catch (err) {
          reject(err)
        }
      })
      const req: DropRequest = { id, field, result, aim, seed }
      w.postMessage(req)
    })
  }

  /** the worker failed: every drop it owes is worked out here, and so is every one after */
  private drop() {
    this.worker?.terminate()
    this.worker = null
    for (const answer of [...this.waiting.values()]) answer(null)
  }

  dispose() {
    this.disposed = true
    this.worker?.terminate()
    this.worker = null
    for (const answer of [...this.waiting.values()]) answer(null)
  }
}
