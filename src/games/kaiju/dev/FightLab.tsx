import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { FIGHT_MS, ROUND_MS, fightRoundAt, roundStart } from '../clock'
import { BUILDINGS, PLAZA_R, SHORE_Z, type BuildingKind } from '../arena'
import { actionAt, callsUntil, checkFight, drawFight, fallenAt, fallenBy, healthAt, impactAt, posAt } from '../fight'
import { KAIJU_IDS, METHOD_NAME, drawResult, fighter, hitsOf, oddsOf, selName } from '../rules'
import { decisionKind, judgesLine, resultLine } from '../words'
import { sha256 } from '../fair'
import type { Action, Fight, KaijuId, Matchup, Method, Side } from '../types'

/*
  Dev lab #/dev/fight: a fight script (fight.ts) seen from above, without the 3D stage. Pick a matchup and a key (or
  ask for a knockout, a Splash or a decision), then play or scrub it: the plaza and the bay, every building (the ones
  that have fallen greyed out, a burst where one comes down), the two kaiju with their trails and what each is doing,
  the health bars, the buildings counter, the commentary, and the whole script as two rows of beats under it. The
  checks the tests run (checkFight) are shown too, so a bad script is obvious. window.__kjFight holds the current one
  for tools (tools/kaiju-fight-shots.mjs).
*/

const KIND: Record<BuildingKind, string> = {
  tower: '#4f6d8a', hotel: '#7a5ba8', casino: '#c9a227', block: '#5c6f7e', tank: '#4b8a7a', neon: '#d6407e', shop: '#3f7f9a', depot: '#7c6a55',
}
const ACT: Partial<Record<Action, string>> = {
  jab: '#ffd166', heavy: '#ff8a3d', tail: '#f4a261', charge: '#ff5d5d', beam: '#5fe0ff', grab: '#c77dff', throw: '#9b5de5', stomp: '#ff4d61',
  block: '#8ecae6', dodge: '#a8dadc', hit: '#e76f51', stagger: '#e63946', knockdown: '#d00000', down: '#6a040f', getup: '#ffb4a2', thrown: '#b5179e',
  sink: '#1d4ed8', victory: '#22d36f', roar: '#f7c548', taunt: '#e9c46a', walk: '#3a5a70', circle: '#2f4b5e', idle: '#1d3343',
}
const W = 640
const H = 680
// world → svg: x across, z down the page (the camera's side, +z, at the bottom; the bay at the top)
const X0 = -40
const Z0 = -46
const S = W / 80
const sx = (x: number) => (x - X0) * S
const sz = (z: number) => (z - Z0) * S

function useClock(playing: boolean, speed: number, set: (f: (t: number) => number) => void) {
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const f = (now: number) => {
      const dt = Math.min(100, now - last)
      last = now
      set((t) => (t + dt * speed >= FIGHT_MS ? FIGHT_MS : t + dt * speed))
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, set])
}

/** a key whose fight ends the way asked, found by trying keys (drawResult is cheap) */
function findKey(m: Matchup, method: Method | 'any', round: number | 0, from: string): string {
  for (let i = 0; i < 20000; i++) {
    const key = sha256(`${from}:${i}`)
    const r = drawResult(key, m.a, m.b)
    if ((method === 'any' || r.method === method) && (!round || r.round === round)) return key
  }
  return from
}

export default function FightLab() {
  const [a, setA] = useState<KaijuId>('bedrock')
  const [b, setB] = useState<KaijuId>('lumina')
  const [key, setKey] = useState(() => sha256('fight-lab'))
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  useClock(playing, speed, setT)
  const m: Matchup = useMemo(() => ({ a, b, main: false }), [a, b])
  const f: Fight = useMemo(() => drawFight(key, m), [key, m])
  const problems = useMemo(() => checkFight(f), [f])
  const odds = oddsOf(a, b)
  ;(window as unknown as { __kjFight?: unknown }).__kjFight = { fight: f, key, m, set: (ms: number) => setT(ms), problems }
  useEffect(() => {
    if (t >= FIGHT_MS) setPlaying(false)
  }, [t])
  const pick = (method: Method | 'any', round: number | 0 = 0) => {
    setKey(findKey(m, method, round, `${Date.now()}:${Math.random()}`))
    setT(0)
  }
  const [ha, hb] = healthAt(f, t)
  const fallen = new Set(fallenAt(f, t))
  const { round, break: brk } = fightRoundAt(t)
  const calls = callsUntil(f, t).slice(-7)
  const r = f.result
  const over = t >= f.endsAt
  const trail = (s: Side) => {
    const pts: string[] = []
    for (let u = Math.max(0, t - 2500); u <= t; u += 100) {
      const p = posAt(f, s, u)
      pts.push(`${sx(p.x).toFixed(1)},${sz(p.z).toFixed(1)}`)
    }
    return pts.join(' ')
  }
  const kaiju = (s: Side) => {
    const id = s === 'a' ? a : b
    const F = fighter(id)
    const p = posAt(f, s, t)
    const now = actionAt(f, s, t)
    const act = now?.e.action ?? 'idle'
    const striking = now && now.e.outcome && t >= impactAt(now.e) && t < impactAt(now.e) + 160
    const r0 = act === 'down' || act === 'knockdown' ? 2.4 : act === 'sink' ? 2 : 3
    return (
      <g key={s}>
        <polyline points={trail(s)} fill="none" stroke={F.colors.glow} strokeOpacity={0.35} strokeWidth={2} />
        <circle cx={sx(p.x)} cy={sz(p.z)} r={r0 * S} fill={F.colors.body} stroke={striking ? '#fff' : F.colors.glow} strokeWidth={striking ? 4 : 2} />
        <text x={sx(p.x)} y={sz(p.z) + 4} textAnchor="middle" fontSize={11} fontWeight={900} fill="#fff">
          {s.toUpperCase()}
        </text>
        <text x={sx(p.x)} y={sz(p.z) - r0 * S - 6} textAnchor="middle" fontSize={11} fontWeight={800} fill={ACT[act] ?? '#ccc'}>
          {act}
          {now?.e.outcome ? ` · ${now.e.outcome}` : ''}
        </text>
      </g>
    )
  }
  const bar = (h: number, color: string, right = false) => (
    <div className="h-3 flex-1 overflow-hidden rounded-full bg-raised">
      <div className={`h-full rounded-full transition-[width] duration-150 ${right ? 'ml-auto' : ''}`} style={{ width: `${h}%`, background: color }} />
    </div>
  )
  const row = (s: Side) =>
    f.events
      .filter((e) => e.who === s)
      .map((e, i) => (
        <div
          key={i}
          title={`${e.action} ${e.t}+${e.dur}${e.outcome ? ` ${e.outcome}` : ''}${e.dmg ? ` −${e.dmg}` : ''}${e.call ? `: ${e.call}` : ''}`}
          className="absolute top-0 h-full border-r border-black/40"
          style={{ left: `${(e.t / FIGHT_MS) * 100}%`, width: `${(e.dur / FIGHT_MS) * 100}%`, background: ACT[e.action] ?? '#555', opacity: e.t <= t ? 1 : 0.55 }}
        />
      ))
  return (
    <div className="mx-auto max-w-[1280px] p-4 text-[13px] text-ink">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-[20px] font-black">Fight lab</h1>
        {([['a', a, setA], ['b', b, setB]] as const).map(([s, v, set]) => (
          <select key={s} value={v} onChange={(e) => (set(e.target.value as KaijuId), setT(0))} className="rounded-lg border border-line bg-panel px-2 py-1 font-bold">
            {KAIJU_IDS.filter((x) => x !== (s === 'a' ? b : a)).map((x) => (
              <option key={x} value={x}>
                {s.toUpperCase()}: {fighter(x).name}
              </option>
            ))}
          </select>
        ))}
        {(['ko', 'splash', 'dec', 'any'] as const).map((x) => (
          <button key={x} onClick={() => pick(x)} className="rounded-lg bg-raised px-3 py-1 font-bold hover:bg-hover">
            {x === 'any' ? 'New key' : METHOD_NAME[x]}
          </button>
        ))}
        {[1, 2, 3].map((k) => (
          <button key={k} onClick={() => pick('any', k)} className="rounded-lg bg-raised px-3 py-1 font-bold hover:bg-hover">
            Ends r{k}
          </button>
        ))}
        <button onClick={() => (t >= FIGHT_MS && setT(0), setPlaying((p) => !p))} className="rounded-lg bg-accent px-3 py-1 font-black text-bg">
          {playing ? 'Pause' : 'Play'}
        </button>
        {[0.25, 1, 2, 4].map((x) => (
          <button key={x} onClick={() => setSpeed(x)} className={`rounded-lg px-2 py-1 font-bold ${speed === x ? 'bg-sky text-bg' : 'bg-raised'}`}>
            {x}×
          </button>
        ))}
        <input value={key} onChange={(e) => setKey(e.target.value.trim())} className="min-w-[200px] flex-1 rounded-lg border border-line bg-panel px-2 py-1 font-mono text-[11px] text-muted" />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[640px] rounded-2xl border border-line bg-stage">
          <rect x={0} y={0} width={W} height={sz(SHORE_Z)} fill="#0b2a4a" />
          <text x={12} y={22} fontSize={12} fontWeight={800} fill="#4cb4ff" opacity={0.7}>
            THE BAY
          </text>
          <circle cx={sx(0)} cy={sz(0)} r={PLAZA_R * S} fill="#13283a" stroke="#22d36f" strokeOpacity={0.35} strokeDasharray="6 6" />
          <rect x={0} y={sz(SHORE_Z) - 1} width={W} height={2} fill="#4cb4ff" opacity={0.6} />
          <text x={W - 12} y={H - 10} textAnchor="end" fontSize={11} fill="#90a4b8">
            camera ↓
          </text>
          {BUILDINGS.map((bd, i) => {
            const down = fallen.has(i)
            const c = f.collapses.find((x) => x.building === i)
            const burst = c && t >= c.t && t < c.t + 900
            return (
              <g key={i} transform={`translate(${sx(bd.x)} ${sz(bd.z)}) rotate(${(-bd.rot * 180) / Math.PI})`}>
                <rect x={(-bd.w / 2) * S} y={(-bd.d / 2) * S} width={bd.w * S} height={bd.d * S} rx={3} fill={down ? '#2a3440' : KIND[bd.kind]} stroke={down ? '#55606b' : '#0008'} strokeDasharray={down ? '3 3' : undefined} opacity={down ? 0.6 : 1} />
                {burst && <circle r={(bd.w / 2 + 3) * S * ((t - c!.t) / 900 + 0.4)} fill="none" stroke="#ff8a3d" strokeWidth={3} opacity={1 - (t - c!.t) / 900} />}
                <text y={4} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff" opacity={down ? 0.4 : 0.85}>
                  {i}
                </text>
              </g>
            )
          })}
          {(['a', 'b'] as const).map(kaiju)}
        </svg>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="rounded-2xl border border-line bg-panel p-3">
            <div className="mb-2 flex items-center gap-2 text-[15px] font-black">
              <span style={{ color: fighter(a).colors.glow }}>{fighter(a).name}</span>
              <span className="text-dim">vs</span>
              <span style={{ color: fighter(b).colors.glow }}>{fighter(b).name}</span>
              <span className="ml-auto font-mono text-[12px] text-muted">
                {(t / 1000).toFixed(2)} s · {t >= FIGHT_MS ? 'final bell' : brk ? `break before round ${round}` : `round ${round} ${(((t - roundStart(round)) / ROUND_MS) * 100).toFixed(0)}%`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <b className="w-8 text-right">{ha}</b>
              {bar(ha, fighter(a).colors.glow, true)}
              {bar(hb, fighter(b).colors.glow)}
              <b className="w-8">{hb}</b>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 text-muted">
              <span>
                Buildings <b className="text-ink">{fallenBy(f, t)}</b> / line {odds.line}
              </span>
              <span>
                First strike <b className="text-ink">{fighter(r.first === 'a' ? a : b).name}</b>
              </span>
              <span>
                Ends <b className="text-ink">{(f.endsAt / 1000).toFixed(2)} s</b>
              </span>
            </div>
          </div>
          <div className="min-h-[150px] rounded-2xl border border-line bg-panel p-3">
            {calls.map((c, i) => (
              <div key={c.t + ':' + i} className={i === calls.length - 1 ? 'font-extrabold text-ink' : 'text-muted'}>
                <span className="mr-2 font-mono text-[11px] text-dim">{(c.t / 1000).toFixed(1)}</span>
                {c.text}
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-line bg-panel p-3">
            <div className={`text-[15px] font-black ${over ? 'text-gold' : 'text-dim'}`}>{resultLine(m, r)}</div>
            {f.cards && <div className="mt-1 text-muted">{judgesLine(m, r, f.cards)} ({decisionKind(f.cards, r.winner)})</div>}
            <div className="mt-1 text-[12px] text-muted">
              Wins: {hitsOf(r, odds.line).map((s) => `${selName(s, m)} ${odds.mult[s]}×`).join(' · ')}
            </div>
            <div className={`mt-1 text-[12px] font-bold ${problems.length ? 'text-danger' : 'text-accent'}`}>{problems.length ? problems.join(' · ') : 'Script passes every check'}</div>
          </div>
        </div>
      </div>
      <Timeline f={f} t={t} set={setT} row={row} />
    </div>
  )
}

function Timeline({ f, t, set, row }: { f: Fight; t: number; set: (t: number) => void; row: (s: Side) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const seek = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    set(Math.max(0, Math.min(FIGHT_MS, ((e.clientX - r.left) / r.width) * FIGHT_MS)))
  }
  return (
    <div
      ref={ref}
      onPointerDown={(e) => (ref.current!.setPointerCapture(e.pointerId), seek(e))}
      onPointerMove={(e) => e.buttons && seek(e)}
      className="relative mt-3 cursor-pointer select-none rounded-2xl border border-line bg-panel px-0 py-2"
    >
      {[1, 2, 3].map((k) => (
        <div key={k} className="absolute top-0 h-full bg-white/5" style={{ left: `${(roundStart(k) / FIGHT_MS) * 100}%`, width: `${(ROUND_MS / FIGHT_MS) * 100}%` }} />
      ))}
      {(['a', 'b'] as const).map((s) => (
        <div key={s} className="relative my-1 h-5">
          {row(s)}
        </div>
      ))}
      {f.collapses.map((c, i) => (
        <div key={i} className="absolute top-0 h-full w-[2px] bg-danger/70" style={{ left: `${(c.t / FIGHT_MS) * 100}%` }} />
      ))}
      <div className="absolute top-0 h-full w-[2px] bg-gold" style={{ left: `${(f.endsAt / FIGHT_MS) * 100}%` }} />
      <div className="absolute -top-1 h-[calc(100%+8px)] w-[2px] bg-ink" style={{ left: `${(t / FIGHT_MS) * 100}%` }} />
    </div>
  )
}
