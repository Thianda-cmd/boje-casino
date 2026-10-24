import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Machine from '../Machine'
import { PusherCover, PusherIcon } from '../cover'
import { newField } from '../field'
import { drawDrop, resultOf } from '../rules'
import { runDrop } from '../sim'
import type { Field, Feature, ItemKind, Run, RunEvent } from '../types'

/*
  The machine lab (#/dev/machine, dev server only): the real Machine with a field and drops of your choosing, played
  by the real simulation (sim.ts runDrop). Force a result (a preset, or counts and a feature) or draw one at the real
  odds, aim, drop; play it at any speed, pause and scrub to any frame; chain drops on the evolving field or start a
  fresh one; switch between a desktop 16:10 stage and a phone one. Under the stage: the frame, the events the page
  hears, what the drop cost to simulate and what each frame costs to draw, and where the display panel is (the
  dashed box, with a sample counter in it). tools/pusher-shots.mjs drives it through window.__machineLab.
*/

type Size = 'desktop' | 'phone'

interface LabApi {
  /** drops with the given result (or a drawn one), aim and seed; resolves with the run's frames once it is handed over */
  drop: (r?: { wins?: Partial<Record<ItemKind, number>>; feature?: Feature }, o?: { aim?: number; seed?: number; speed?: number }) => { key: string; frames: number; step: number; events: RunEvent[]; ms: number }
  set: (o: { size?: Size; speed?: number; aim?: number; chain?: boolean }) => void
  /** a fresh machine (the same seed gives the same field) */
  fresh: (seed?: number) => void
  seek: (f: number) => void
  hold: (on: boolean) => void
  state: () => { frame: { f: number; frames: number; key: string; done: boolean } | null; heard: number; heardList: string[]; done: string[]; coins: number; display: { x: number; y: number; w: number; h: number } | null }
}

declare global {
  interface Window {
    __machineLab?: LabApi
  }
}

const PRESETS: { name: string; wins: Partial<Record<ItemKind, number>>; feature?: Feature }[] = [
  { name: 'Nothing', wins: {} },
  { name: '3 silver', wins: { silver: 3 } },
  { name: 'Gold + 2', wins: { silver: 2, gold: 1 } },
  { name: 'Gem', wins: { gem: 1, silver: 1 } },
  { name: 'Gold bar', wins: { bar: 1, gold: 1 } },
  { name: 'Idol', wins: { idol: 1, silver: 2 } },
  { name: 'Crown', wins: { crown: 1, gold: 1 } },
  { name: 'Shower', wins: { silver: 8, gold: 3 }, feature: 'shower' },
  { name: 'Quake', wins: { silver: 7, gold: 4, gem: 1 }, feature: 'quake' },
  { name: 'Crown + Idol', wins: { crown: 1, idol: 1, gold: 2, silver: 4 }, feature: 'quake' },
]
const KINDS: ItemKind[] = ['silver', 'gold', 'gem', 'bar', 'idol', 'crown']
const btn = 'rounded-lg bg-raised px-2.5 py-1 font-bold text-ink hover:bg-hover'

export default function MachineLab() {
  const [field, setField] = useState<Field>(() => newField(7))
  const [play, setPlay] = useState<{ run: Run; speed: number; key: string } | null>(null)
  const [aim, setAim] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [size, setSize] = useState<Size>('desktop')
  const [chain, setChain] = useState(true)
  const [counts, setCounts] = useState<Record<ItemKind, number>>({ silver: 2, gold: 1, gem: 0, bar: 0, idol: 0, crown: 0 })
  const [feature, setFeature] = useState<Feature>('none')
  const [log, setLog] = useState<{ f: number; e: RunEvent }[]>([])
  const [display, setDisplay] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [simMs, setSimMs] = useState(0)
  const [frameInfo, setFrameInfo] = useState<{ f: number; frames: number; done: boolean } | null>(null)
  const [held, setHeld] = useState(false)
  const [stats, setStats] = useState('')
  const [win, setWin] = useState(0)
  const seq = useRef(1)
  const live = useRef({ field, play, aim, speed, chain })
  live.current = { field, play, aim, speed, chain }
  const heard = useRef(0)
  const heardList = useRef<string[]>([])
  const doneKeys = useRef<string[]>([])
  const lastRun = useRef<Run | null>(null)

  const doDrop = useCallback((r?: { wins?: Partial<Record<ItemKind, number>>; feature?: Feature }, o: { aim?: number; seed?: number; speed?: number } = {}) => {
    const res = r?.wins ? resultOf(r.wins, r.feature ?? 'none') : drawDrop(Math.random())
    const a = o.aim ?? live.current.aim
    const t0 = performance.now()
    const run = runDrop(live.current.field, res, a, o.seed ?? Math.floor(Math.random() * 2 ** 31))
    const ms = performance.now() - t0
    setSimMs(ms)
    lastRun.current = run
    heard.current = 0
    heardList.current = []
    setLog([])
    setWin(0)
    if (o.aim !== undefined) setAim(o.aim)
    if (o.speed !== undefined) setSpeed(o.speed)
    const key = `lab-${seq.current++}`
    setPlay({ run, speed: o.speed ?? live.current.speed, key })
    return { key, frames: run.frames, step: run.step, events: run.events, ms }
  }, [])

  const onEvent = useCallback((e: RunEvent) => {
    heard.current++
    heardList.current.push(`${e.kind}@${e.f}`)
    setLog((l) => [...l.slice(-60), { f: e.f, e }])
    if (e.kind === 'tray') setWin((w) => w + ({ silver: 0.25, gold: 1, gem: 5, bar: 25, idol: 100, crown: 500 } as const)[e.item])
  }, [])
  const onDone = useCallback((key: string) => {
    doneKeys.current.push(key)
    const p = live.current.play
    if (p && p.key === key && live.current.chain) setField(p.run.after)
  }, [])

  // the speed applies to the drop in play too
  useEffect(() => {
    setPlay((p) => (p && p.speed !== speed ? { ...p, speed } : p))
  }, [speed])

  // the frame readout
  useEffect(() => {
    const id = setInterval(() => {
      const m = window.__pusherMachine
      if (!m) return
      const fr = m.frame()
      setFrameInfo(fr ? { f: fr.f, frames: fr.frames, done: fr.done } : null)
      const s = m.stats
      setStats(`${s.fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms · ${s.calls} calls · ${(s.tris / 1000).toFixed(0)}k tris · dpr ${s.dpr.toFixed(2)}`)
    }, 120)
    return () => clearInterval(id)
  }, [])

  const seek = (f: number) => window.__pusherMachine?.seek(f)
  const hold = (on: boolean) => {
    setHeld(on)
    window.__pusherMachine?.hold(on)
  }

  useEffect(() => {
    window.__machineLab = {
      drop: doDrop,
      set: (o) => {
        if (o.size) setSize(o.size)
        if (o.speed !== undefined) setSpeed(o.speed)
        if (o.aim !== undefined) setAim(o.aim)
        if (o.chain !== undefined) setChain(o.chain)
      },
      fresh: (seed) => {
        setPlay(null)
        setField(newField(seed ?? Math.floor(Math.random() * 1e6)))
      },
      seek: (f) => window.__pusherMachine?.seek(f),
      hold: (on) => {
        setHeld(on)
        window.__pusherMachine?.hold(on)
      },
      state: () => ({
        frame: window.__pusherMachine?.frame() ?? null,
        heard: heard.current,
        heardList: [...heardList.current],
        done: [...doneKeys.current],
        coins: live.current.field.items.filter((i) => i.kind === 'silver' || i.kind === 'gold').length,
        display: window.__pusherMachine?.displayRect() ?? null,
      }),
    }
    return () => {
      delete window.__machineLab
    }
  }, [doDrop])

  const onField = useMemo(() => {
    const c: Record<ItemKind, number> = { silver: 0, gold: 0, gem: 0, bar: 0, idol: 0, crown: 0 }
    for (const i of field.items) c[i.kind]++
    return c
  }, [field])
  const fr = frameInfo
  const run = play?.run

  return (
    <div className="mx-auto max-w-[1320px] p-4 text-[13px] text-ink">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-[20px] font-black">Machine lab</h1>
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => doDrop({ wins: p.wins, feature: p.feature })} className={btn}>
            {p.name}
          </button>
        ))}
        <button onClick={() => doDrop()} className="rounded-lg bg-accent px-3 py-1 font-black text-bg">
          Draw
        </button>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className={size === 'phone' ? 'mx-auto w-[390px]' : 'w-full'}>
            <div className="relative" data-stage>
              <Machine field={field} play={play} aim={aim} onEvent={onEvent} onDone={onDone} onDisplay={setDisplay} className={`w-full rounded-2xl ${size === 'phone' ? 'h-[600px]' : 'aspect-[16/10]'}`} />
              {display && (
                <div className="pointer-events-none absolute flex items-center justify-center rounded border border-dashed border-accent/70 font-mono font-black text-[#5ff6ea] [text-shadow:0_0_10px_rgba(60,240,220,0.8)]" style={{ left: display.x, top: display.y, width: display.w, height: display.h, fontSize: Math.max(10, display.h * 0.62) }}>
                  {win.toFixed(2)}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => hold(!held)} className="rounded-lg bg-accent px-3 py-1 font-black text-bg">
              {held ? 'Play' : 'Pause'}
            </button>
            {[0.1, 0.25, 0.5, 1, 2, 4].map((x) => (
              <button key={x} onClick={() => setSpeed(x)} className={`rounded-lg px-2 py-1 font-bold ${speed === x ? 'bg-sky text-bg' : 'bg-raised'}`}>
                {x}×
              </button>
            ))}
            <button onClick={() => setSize(size === 'phone' ? 'desktop' : 'phone')} className={`rounded-lg px-2.5 py-1 font-bold ${size === 'phone' ? 'bg-sky text-bg' : 'bg-raised text-ink'}`}>
              Phone
            </button>
            <button onClick={() => setChain(!chain)} className={`rounded-lg px-2.5 py-1 font-bold ${chain ? 'bg-gold text-bg' : 'bg-raised text-ink'}`}>
              Chain field
            </button>
            <button onClick={() => window.__machineLab?.fresh()} className={btn}>
              New field
            </button>
            <span className="ml-auto font-mono text-[12px] text-muted">{stats}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="w-14 font-bold text-muted">Aim</span>
            <input type="range" min={-1} max={1} step={0.01} value={aim} onChange={(e) => setAim(Number(e.target.value))} className="flex-1" />
            <span className="w-12 font-mono">{aim.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="w-14 font-bold text-muted">Frame</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, (fr?.frames ?? 1) - 1)}
              step={0.25}
              value={fr?.f ?? 0}
              onChange={(e) => {
                if (!held) hold(true)
                seek(Number(e.target.value))
              }}
              className="flex-1"
            />
            <span className="w-28 font-mono">
              {fr ? `${fr.f.toFixed(1)} / ${fr.frames - 1}` : '—'} {fr?.done ? '✓' : ''}
            </span>
          </div>
          {run && (
            <div className="relative mt-2 h-6 overflow-hidden rounded-lg border border-line bg-panel">
              {run.events.map((e, i) => (
                <button
                  key={i}
                  title={`${e.kind} @${e.f}`}
                  onClick={() => {
                    hold(true)
                    seek(Math.max(0, e.f - 8))
                  }}
                  className="absolute top-0 h-full w-[3px]"
                  style={{ left: `${(e.f / run.frames) * 100}%`, background: EV_COL[e.kind] ?? '#888' }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="w-full shrink-0 space-y-3 lg:w-[320px]">
          <div className="rounded-xl border border-line bg-panel p-3">
            <div className="mb-2 font-black">Force a result</div>
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <span className="w-12 text-muted">{k}</span>
                  <input type="number" min={0} max={20} value={counts[k]} onChange={(e) => setCounts({ ...counts, [k]: Math.max(0, Number(e.target.value) || 0) })} className="w-12 rounded border border-line bg-panel2 px-1" />
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {(['none', 'shower', 'quake'] as Feature[]).map((x) => (
                <button key={x} onClick={() => setFeature(x)} className={`rounded-lg px-2 py-1 font-bold ${feature === x ? 'bg-violet text-bg' : 'bg-raised'}`}>
                  {x}
                </button>
              ))}
              <button onClick={() => doDrop({ wins: counts, feature })} className="ml-auto rounded-lg bg-accent px-3 py-1 font-black text-bg">
                Drop
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-panel p-3 font-mono text-[12px]">
            <div>
              field: {KINDS.map((k) => `${k} ${onField[k]}`).join(' · ')}
            </div>
            {run && (
              <div className="mt-1 text-muted">
                run: {run.frames} frames ({(run.frames * run.step).toFixed(1)} s) · {run.tracks.length} tracks · sim {simMs.toFixed(0)} ms
              </div>
            )}
            <div className="mt-1 text-muted">heard: {heard.current} events · win {win.toFixed(2)}×</div>
          </div>
          <div className="rounded-xl border border-line bg-panel p-3" data-cover>
            <div className="mb-2 font-black">Cover and icon</div>
            <div className="flex items-end gap-3">
              <div className="relative aspect-[4/5] w-[160px] overflow-hidden rounded-xl ring-1 ring-white/10" data-cover-card>
                <PusherCover />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 pt-14">
                  <div className="text-[16px] font-black leading-tight tracking-tight text-white drop-shadow">Coin Cascade</div>
                </div>
              </div>
              <div className="flex flex-col gap-2 text-ink" data-icons>
                {[20, 24, 40].map((s) => (
                  <PusherIcon key={s} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </div>
            </div>
          </div>
          <div className="h-[300px] overflow-auto rounded-xl border border-line bg-panel p-2 font-mono text-[11px]">
            {log.map((l, i) => (
              <div key={i} style={{ color: EV_COL[l.e.kind] }}>
                {String(l.f).padStart(4)} {l.e.kind} {'item' in l.e ? l.e.item : ''} {'id' in l.e ? `#${l.e.id}` : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const EV_COL: Record<string, string> = { drop: '#ff6fd0', land: '#7f8db0', edge: '#ffd23a', tray: '#22d36f', gutter: '#ff4d61', shower: '#4cb4ff', quake: '#ffffff', feed: '#9b7bff', restock: '#ff9a3c' }
