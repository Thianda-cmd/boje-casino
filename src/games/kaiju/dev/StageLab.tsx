import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { BET_MS, CLOSE_MS, CYCLE_MS, FIGHT_MS, ROUND_MS, WALKOUT_MS, roundStart, timesOf } from '../clock'
import { drawFight, impactAt } from '../fight'
import { KAIJU_IDS, METHOD_NAME, drawResult, fighter } from '../rules'
import { resultLine } from '../words'
import { sha256 } from '../fair'
import Stage from '../Stage'
import { FIGHT0, planShots, replayOf, show, stageEvents } from '../stage/director'
import type { KaijuId, Matchup, Method, StageEvent, StageView } from '../types'

/*
  The stage lab (#/dev/stage, dev server only): the real Stage with a round of your choosing on a clock you control.
  Pick the two kaiju and a key (or ask for a knockout, a Splash or a decision, and the round it ends in), make it a
  Main Event, then play, pause, slow it down or scrub anywhere in the round (the betting show, the walkout, the fight,
  the replay, the celebration), at 16:9 or phone size. Under it: the shot on air, the events the page would hear,
  and what each frame costs. tools/kaiju-stage.mjs drives it through window.__stageLab for its screenshots.
*/

interface LabState {
  a: KaijuId
  b: KaijuId
  key: string
  main: boolean
  phone: boolean
  playing: boolean
  speed: number
}

declare global {
  interface Window {
    __stageLab?: {
      set: (o: Partial<LabState> & { t?: number; method?: Method | 'any'; round?: number; beam?: boolean }) => void
      get: () => { t: number; state: LabState; result: ReturnType<typeof drawResult>; endsAt: number; replay: [number, number] | null; collapses: number[]; shot: string; stretch: string; beats: { t: number; action: string; outcome?: string; cue?: string; who: string }[] }
      events: () => { c: number; e: StageEvent }[]
      /** every event heard since the fight was last changed, and what the director says the round holds */
      heard: () => { c: number; e: StageEvent }[]
      expected: () => { c: number; e: StageEvent }[]
      clear: () => void
    }
  }
}

/** a key whose fight ends the way asked (drawResult is cheap, so try keys until one does); `beam`: and A's special
 *  lands in it (the fight has to be written to know, so only the keys that end right are checked) */
function findKey(m: Matchup, method: Method | 'any', round: number, from: string, beam = false): string {
  for (let i = 0; i < 40000; i++) {
    const key = sha256(`${from}:${i}`)
    const r = drawResult(key, m.a, m.b)
    if ((method === 'any' || r.method === method) && (!round || r.round === round)) {
      if (!beam || drawFight(key, m).events.some((e) => e.who === 'a' && e.action === 'beam' && e.outcome === 'land')) return key
    }
  }
  return from
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export default function StageLab() {
  const [st, setSt] = useState<LabState>({ a: 'rexor', b: 'gorrath', key: sha256('stage-lab'), main: false, phone: false, playing: true, speed: 1 })
  const clock = useRef(4000)
  const [t, setT] = useState(4000)
  const [events, setEvents] = useState<{ c: number; e: StageEvent }[]>([])
  const [stats, setStats] = useState({ ms: 0, fps: 0, calls: 0, tris: 0, dpr: 1, bloom: true })
  const id = st.main ? 2020 : 2021
  const m: Matchup = useMemo(() => ({ a: st.a, b: st.b, main: st.main }), [st.a, st.b, st.main])
  const times = useMemo(() => timesOf(id), [id])
  const fight = useMemo(() => drawFight(st.key, m), [st.key, m])
  const closed = t >= BET_MS - CLOSE_MS
  const view: StageView = useMemo(() => ({ id, matchup: m, times, fight: closed ? fight : null }), [id, m, times, fight, closed])
  const now = useCallback(() => times.opensAt + clock.current, [times])
  const stRef = useRef(st)
  stRef.current = st
  const evRef = useRef(events)
  evRef.current = events

  // the lab's clock
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let shown = 0
    const tick = (n: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(100, n - last)
      last = n
      const s = stRef.current
      if (s.playing) {
        clock.current += dt * s.speed
        if (clock.current >= CYCLE_MS - 1) clock.current = 0
      }
      if (n - shown > 90) {
        shown = n
        setT(clock.current)
        const sc = window.__kjStage
        if (sc) setStats({ ms: sc.stats.ms, fps: sc.stats.fps, calls: sc.stats.calls, tris: sc.stats.tris, dpr: sc.stats.dpr, bloom: sc.stats.bloom })
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const up = (p: Partial<LabState>) => setSt((s) => ({ ...s, ...p }))
  const seek = (ms: number) => {
    clock.current = Math.max(0, Math.min(CYCLE_MS - 1, ms))
    setT(clock.current)
  }
  const pick = (method: Method | 'any', round = 0) => {
    up({ key: findKey(m, method, round, `${Date.now()}:${Math.random()}`) })
    setEvents([])
  }

  useEffect(() => {
    window.__stageLab = {
      set: (o) => {
        const s = { ...stRef.current, ...o }
        if (o.method || o.round || o.beam) s.key = findKey({ a: s.a, b: s.b, main: s.main }, o.method ?? 'any', o.round ?? 0, o.key ?? `lab:${s.a}:${s.b}`, !!o.beam)
        stRef.current = s
        setSt(s)
        if (o.t !== undefined) seek(o.t)
      },
      get: () => {
        const s = stRef.current
        const mm = { a: s.a, b: s.b, main: s.main }
        const f = drawFight(s.key, mm)
        const plan = replayOf(f)
        const v: StageView = { id: s.main ? 2020 : 2021, matchup: mm, times: timesOf(s.main ? 2020 : 2021), fight: clock.current >= BET_MS - CLOSE_MS ? f : null }
        const sh = show(v, v.times.opensAt + clock.current)
        const beats = f.events.filter((e) => e.outcome).map((e) => ({ t: FIGHT0 + impactAt(e), action: e.action, outcome: e.outcome, cue: e.cue, who: e.who }))
        return { t: clock.current, state: s, result: f.result, endsAt: f.endsAt, replay: plan ? [FIGHT0 + plan.r0, FIGHT0 + plan.r1] : null, collapses: f.collapses.map((c) => FIGHT0 + c.t), shot: sh.shot.kind, stretch: sh.stretch, beats }
      },
      events: () => evRef.current,
      heard: () => all.current,
      expected: () => {
        const s = stRef.current
        const mm = { a: s.a, b: s.b, main: s.main }
        return stageEvents({ id: s.main ? 2020 : 2021, matchup: mm, times: timesOf(s.main ? 2020 : 2021), fight: drawFight(s.key, mm) })
      },
      clear: () => {
        all.current = []
      },
    }
    return () => {
      delete window.__stageLab
    }
  }, [])

  const all = useRef<{ c: number; e: StageEvent }[]>([])
  const onEvent = useCallback((e: StageEvent) => {
    all.current.push({ c: clock.current, e })
    setEvents((l) => [{ c: clock.current, e }, ...l].slice(0, 14))
  }, [])
  const sh = show(view, times.opensAt + t)
  const shots = planShots(view)
  const plan = replayOf(fight)
  const r = fight.result
  const marks: [number, string, string][] = [
    [0, 'bets', '#4cc3ff'],
    [BET_MS - CLOSE_MS, 'close', '#ff4d61'],
    [BET_MS, 'walkout', '#a46bff'],
    ...[1, 2, 3].map((k): [number, string, string] => [FIGHT0 + roundStart(k), `R${k}`, '#22d36f']),
    [FIGHT0 + fight.endsAt, r.method === 'dec' ? 'bell' : METHOD_NAME[r.method], '#ffd36b'],
    [FIGHT0 + FIGHT_MS, 'result', '#ffd36b'],
  ]
  const bar = useRef<HTMLDivElement>(null)
  const drag = (e: PointerEvent) => {
    const b = bar.current!.getBoundingClientRect()
    seek(((e.clientX - b.left) / b.width) * CYCLE_MS)
  }
  const btn = 'rounded-lg bg-raised px-2.5 py-1 font-bold text-ink hover:bg-hover'
  return (
    <div className="mx-auto max-w-[1280px] p-4 text-[13px] text-ink">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-[20px] font-black">Stage lab</h1>
        {(['a', 'b'] as const).map((s) => (
          <select key={s} value={st[s]} onChange={(e) => up({ [s]: e.target.value as KaijuId })} className="rounded-lg border border-line bg-panel px-2 py-1 font-bold">
            {KAIJU_IDS.filter((x) => x !== (s === 'a' ? st.b : st.a)).map((x) => (
              <option key={x} value={x}>
                {s.toUpperCase()}: {fighter(x).name}
              </option>
            ))}
          </select>
        ))}
        {(['ko', 'splash', 'dec', 'any'] as const).map((x) => (
          <button key={x} onClick={() => pick(x)} className={btn}>
            {x === 'any' ? 'New key' : METHOD_NAME[x]}
          </button>
        ))}
        {[1, 2, 3].map((k) => (
          <button key={k} onClick={() => pick('any', k)} className={btn}>
            Ends r{k}
          </button>
        ))}
        <button onClick={() => up({ main: !st.main })} className={`rounded-lg px-2.5 py-1 font-bold ${st.main ? 'bg-gold text-bg' : 'bg-raised text-ink'}`}>
          Main Event
        </button>
        <button onClick={() => up({ phone: !st.phone })} className={`rounded-lg px-2.5 py-1 font-bold ${st.phone ? 'bg-sky text-bg' : 'bg-raised text-ink'}`}>
          {st.phone ? 'Phone' : '16:9'}
        </button>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className={st.phone ? 'mx-auto w-full max-w-[390px]' : 'w-full'}>
            <Stage view={view} now={now} onEvent={onEvent} className={`w-full rounded-2xl ${st.phone ? 'h-[520px]' : 'aspect-video'}`} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => up({ playing: !st.playing })} className="rounded-lg bg-accent px-3 py-1 font-black text-bg">
              {st.playing ? 'Pause' : 'Play'}
            </button>
            {[0.1, 0.25, 0.5, 1, 2].map((x) => (
              <button key={x} onClick={() => up({ speed: x })} className={`rounded-lg px-2 py-1 font-bold ${st.speed === x ? 'bg-sky text-bg' : 'bg-raised'}`}>
                {x}×
              </button>
            ))}
            <span className="mx-1 text-dim">|</span>
            <button onClick={() => seek(BET_MS)} className={btn}>Walkout</button>
            <button onClick={() => seek(FIGHT0 - 300)} className={btn}>Bell</button>
            {fight.collapses[0] && <button onClick={() => seek(FIGHT0 + fight.collapses[0].t - 1500)} className={btn}>Collapse</button>}
            <button onClick={() => seek(FIGHT0 + fight.endsAt - 2500)} className={btn}>Finish</button>
            {plan && <button onClick={() => seek(FIGHT0 + plan.r0)} className={btn}>Replay</button>}
            <button onClick={() => seek(FIGHT0 + FIGHT_MS + 2500)} className={btn}>Result</button>
            <span className="ml-auto font-mono text-[12px] text-muted">
              {fmt(t)} · {sh.stretch} · st {fmt(sh.st)} · {sh.shot.kind}
              {sh.shot.who ? ` (${sh.shot.who})` : ''}
              {sh.replay ? ' · REPLAY' : sh.rate !== 1 && sh.stretch !== 'bets' && sh.stretch !== 'walkout' ? ` · ${sh.rate}×` : ''}
            </span>
          </div>
          <div
            ref={bar}
            onPointerDown={(e) => (bar.current!.setPointerCapture(e.pointerId), drag(e))}
            onPointerMove={(e) => e.buttons && drag(e)}
            className="relative mt-3 h-14 cursor-pointer select-none overflow-hidden rounded-xl border border-line bg-panel"
          >
            {[1, 2, 3].map((k) => (
              <div key={k} className="absolute top-0 h-full bg-white/5" style={{ left: `${((FIGHT0 + roundStart(k)) / CYCLE_MS) * 100}%`, width: `${(ROUND_MS / CYCLE_MS) * 100}%` }} />
            ))}
            <div className="absolute top-0 h-full bg-violet/15" style={{ left: `${(BET_MS / CYCLE_MS) * 100}%`, width: `${(WALKOUT_MS / CYCLE_MS) * 100}%` }} />
            {plan && <div className="absolute top-0 h-full bg-danger/20" style={{ left: `${((FIGHT0 + plan.r0) / CYCLE_MS) * 100}%`, width: `${((plan.r1 - plan.r0) / CYCLE_MS) * 100}%` }} />}
            {shots.map((s, i) => (
              <div key={i} className="absolute bottom-0 h-3 border-l border-black/50" title={`${s.kind} ${fmt(s.c0)}–${fmt(s.c1)}`} style={{ left: `${(s.c0 / CYCLE_MS) * 100}%`, width: `${((s.c1 - s.c0) / CYCLE_MS) * 100}%`, background: SHOT_COL[s.kind] ?? '#555' }} />
            ))}
            {fight.collapses.map((c, i) => (
              <div key={i} className="absolute top-0 h-8 w-[2px] bg-danger" style={{ left: `${((FIGHT0 + c.t) / CYCLE_MS) * 100}%` }} />
            ))}
            {marks.map(([c, label, col]) => (
              <div key={label + c} className={`absolute h-full border-l-2 pl-1 text-[10px] font-bold ${label === 'close' ? 'top-3' : 'top-0'}`} style={{ left: `${(c / CYCLE_MS) * 100}%`, borderColor: col, color: col }}>
                {label}
              </div>
            ))}
            <div className="absolute -top-1 h-[calc(100%+8px)] w-[2px] bg-ink" style={{ left: `${(t / CYCLE_MS) * 100}%` }} />
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-72">
          <div className="rounded-2xl border border-line bg-panel p-3">
            <div className="font-black text-gold">{resultLine(m, r)}</div>
            <div className="mt-1 text-[12px] text-muted">
              ends {fmt(fight.endsAt)} · {r.damage} buildings · first strike {fighter(r.first === 'a' ? st.a : st.b).name}
            </div>
            <input value={st.key} onChange={(e) => up({ key: e.target.value.trim() })} className="mt-2 w-full rounded-lg border border-line bg-bg px-2 py-1 font-mono text-[10px] text-muted" />
          </div>
          <div className="rounded-2xl border border-line bg-panel p-3 font-mono text-[12px] text-muted">
            <div>
              frame <b className="text-ink">{stats.ms.toFixed(1)} ms</b> · <b className="text-ink">{stats.fps.toFixed(0)}</b> fps
            </div>
            <div>
              calls <b className="text-ink">{stats.calls}</b> · tris <b className="text-ink">{(stats.tris / 1000).toFixed(0)}k</b>
            </div>
            <div>
              dpr <b className="text-ink">{stats.dpr.toFixed(2)}</b> · bloom <b className="text-ink">{stats.bloom ? 'on' : 'off'}</b>
            </div>
          </div>
          <div className="min-h-[220px] rounded-2xl border border-line bg-panel p-3">
            <div className="mb-1 font-black">Events</div>
            {events.map((x, i) => (
              <div key={i} className={i ? 'text-muted' : 'font-bold text-ink'}>
                <span className="mr-2 font-mono text-[11px] text-dim">{fmt(x.c)}</span>
                {describe(x.e)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const SHOT_COL: Record<string, string> = {
  establish: '#4f6d8a', orbit: '#3f7f9a', hero: '#a46bff', pair: '#2f4b5e', ots: '#ff8a3d', side: '#5fe0ff', building: '#ff4d61', low: '#e9c46a',
  finish: '#ffd36b', splash: '#4cc3ff', replay: '#ff4fa3', victory: '#22d36f', break: '#1d3343', crane: '#5c6f7e',
}

function describe(e: StageEvent) {
  switch (e.kind) {
    case 'bell':
      return `bell, round ${e.round}`
    case 'land':
      return `${e.who} lands${e.heavy ? ' (heavy)' : ''}`
    case 'block':
      return `${e.who}'s blow blocked`
    case 'collapse':
      return `building ${e.building} by ${e.by}`
    case 'ko':
      return `KO by ${e.who}`
    case 'splash':
      return `SPLASH by ${e.who}`
    case 'final':
      return 'final bell'
    case 'roar':
      return `${e.who} roars`
  }
}
