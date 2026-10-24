import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BACK_Z, FIELD_W, FRONT_Z, GUTTER_Z0, HOPPER, LAND_Z, SLOT_X, TRAY, UPPER_FRONT_Z, UPPER_PUSH_MIN, UPPER_Y } from '../geom'
import { ITEM_KINDS, type DropResult, type Feature, type Field, type ItemKind, type Run } from '../types'
import { drawDrop, itemsOf, multOf, resultOf } from '../rules'
import { coinsOf, countsOf, newField } from '../field'
import { runDrop, trayOf } from '../sim'
import { misplaced, overlapsIn, posesAt } from '../check'
import { LIP, LOWER_TOP, shapeOf } from '../world'

/*
  Dev lab #/dev/field: Coin Cascade's field and simulation seen from above, without the 3D machine. Pick a result (or
  draw one at the real odds), aim, and drop: the run plays on a top-down plan of both tiers (the upper tier behind its
  lip at the top, the lower tier, the front edge, the gutters' open sides and the tray at the bottom) with a side view
  under it, frame by frame at any speed or scrubbed. The bodies the result sends over are ringed from the first frame;
  coins lying on coins are outlined, falling ones fade, every moving body shows its speed, and any two bodies that
  intersect are joined in red. "Next" makes the run's after-field the field, so drops chain on an evolving machine;
  "Auto" runs many drops at once and keeps the score (time per drop, misses, overlaps, the stock). window.__fieldLab
  holds the state for tools.
*/

const S = 38
const X0 = -7
const Z0 = -9.8
const W = 14 * S
const H = 16 * S
const sx = (x: number) => (x - X0) * S
const sz = (z: number) => (z - Z0) * S
// the side view: z across, y up
const SS = 30
const SH = 11 * SS
const vz = (z: number) => (z - Z0) * SS
const vy = (y: number) => SH - (y + 4) * SS

const FILL: Record<ItemKind, string> = { silver: '#c3cedb', gold: '#f2c14e', gem: '#38e1ff', bar: '#ffb12e', idol: '#ffd84a', crown: '#ff5fa8' }
const PRESETS: { name: string; r: () => DropResult }[] = [
  { name: 'Nothing', r: () => resultOf({}) },
  { name: '2 silver', r: () => resultOf({ silver: 2 }) },
  { name: 'Gold+2', r: () => resultOf({ silver: 2, gold: 1 }) },
  { name: '3 gold', r: () => resultOf({ silver: 3, gold: 3 }) },
  { name: 'Gem', r: () => resultOf({ gem: 1 }) },
  { name: 'Bar', r: () => resultOf({ silver: 2, bar: 1 }) },
  { name: 'Idol', r: () => resultOf({ silver: 1, idol: 1 }) },
  { name: 'Crown', r: () => resultOf({ silver: 3, gold: 1, crown: 1 }) },
  { name: 'Shower', r: () => resultOf({ silver: 10, gold: 3 }, 'shower') },
  { name: 'Shower+bar', r: () => resultOf({ silver: 8, gold: 2, bar: 1 }, 'shower') },
  { name: 'Quake', r: () => resultOf({ silver: 16, gold: 5 }, 'quake') },
  { name: 'Quake top', r: () => resultOf({ silver: 14, gold: 4, gem: 1, idol: 1, crown: 1 }, 'quake') },
]

interface Score {
  drops: number
  ms: number
  worst: number
  misses: number
  stray: number
  overlaps: number
  maxOverlap: number
  out: number
  coinsMin: number
  coinsMax: number
  frames: number
}

const label = (r: DropResult) => {
  const parts = ITEM_KINDS.filter((k) => r.wins[k]).map((k) => `${r.wins[k]} ${k}`)
  return `${parts.length ? parts.join(', ') : 'nothing'}${r.feature !== 'none' ? ` · ${r.feature}` : ''} · ${r.mult}×`
}

/** what the lab reports about a run: misses, strays, overlaps at rest, bodies out of place at rest */
function audit(field: Field, run: Run, result: DropResult) {
  const tray = trayOf(run)
  const misses = ITEM_KINDS.reduce((a, k) => a + Math.abs(tray[k] - result.wins[k]), 0)
  const last = posesAt(field, run, run.frames - 1).filter((p) => p.fate === 'field' || p.fate === 'still')
  const ov = overlapsIn(last, 0.04)
  const zu = run.pushers[(run.frames - 1) * 2]
  const zl = run.pushers[(run.frames - 1) * 2 + 1]
  const out = last.filter((p) => misplaced(p, zu, zl))
  return { misses, ov, out, maxOverlap: ov.reduce((a, o) => Math.max(a, o.d), 0) }
}

export default function FieldLab() {
  const [seed, setSeed] = useState(1)
  const [field, setField] = useState<Field>(() => newField(1))
  const [result, setResult] = useState<DropResult>(() => resultOf({ silver: 2 }))
  const [aim, setAim] = useState(0)
  const [run, setRun] = useState<{ run: Run; from: Field; result: DropResult; ms: number } | null>(null)
  const [f, setF] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [score, setScore] = useState<Score | null>(null)
  const [showOv, setShowOv] = useState(true)
  const top = useRef<HTMLCanvasElement>(null)
  const side = useRef<HTMLCanvasElement>(null)

  const drop = useCallback(
    (r: DropResult = result, from: Field = field) => {
      const t = performance.now()
      const out = runDrop(from, r, aim, Math.floor(Math.random() * 2 ** 31))
      setRun({ run: out, from, result: r, ms: performance.now() - t })
      setF(0)
      setPlaying(true)
      return out
    },
    [result, field, aim],
  )
  const next = () => {
    if (!run) return
    setField(run.run.after)
    setRun(null)
    setF(0)
  }
  const auto = (n: number, fresh = false) => {
    let fl = fresh ? newField(seed + 1000) : run ? run.run.after : field
    const sc: Score = { drops: 0, ms: 0, worst: 0, misses: 0, stray: 0, overlaps: 0, maxOverlap: 0, out: 0, coinsMin: 1e9, coinsMax: 0, frames: 0 }
    let lastRun: { run: Run; from: Field; result: DropResult; ms: number } | null = null
    for (let i = 0; i < n; i++) {
      const r = drawDrop(Math.random())
      const t = performance.now()
      let out: Run
      try {
        out = runDrop(fl, r, Math.random() * 2 - 1, Math.floor(Math.random() * 2 ** 31))
      } catch (e) {
        sc.stray++
        console.error(e)
        continue
      }
      const ms = performance.now() - t
      const a = audit(fl, out, r)
      sc.drops++
      sc.ms += ms
      sc.worst = Math.max(sc.worst, ms)
      sc.misses += a.misses ? 1 : 0
      sc.overlaps += a.ov.length
      sc.maxOverlap = Math.max(sc.maxOverlap, a.maxOverlap)
      sc.out += a.out.length
      sc.frames += out.frames
      const c = coinsOf(out.after)
      sc.coinsMin = Math.min(sc.coinsMin, c)
      sc.coinsMax = Math.max(sc.coinsMax, c)
      lastRun = { run: out, from: fl, result: r, ms }
      fl = out.after
    }
    setScore(sc)
    if (lastRun) {
      setField(lastRun.from)
      setRun(lastRun)
      setResult(lastRun.result)
      setF(lastRun.run.frames - 1)
      setPlaying(false)
    }
  }

  // the clock
  useEffect(() => {
    if (!playing || !run) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setF((x) => {
        const n = x + (dt * speed) / run.run.step
        if (n >= run.run.frames - 1) {
          setPlaying(false)
          return run.run.frames - 1
        }
        return n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, run, speed])

  const poses = useMemo(() => {
    if (!run) return field.items.map((it) => ({ ...it, fate: 'still' as const }))
    return posesAt(run.from, run.run, f)
  }, [run, field, f])
  const prev = useMemo(() => (run && f >= 1 ? new Map(posesAt(run.from, run.run, f - 1).map((p) => [p.id, p])) : null), [run, f])
  const planned = useMemo(() => new Set(run ? run.run.tracks.filter((t) => t.fate === 'tray').map((t) => t.id) : []), [run])
  const overlaps = useMemo(() => (showOv ? overlapsIn(poses.filter((p) => p.y > -1.5), 0.04) : []), [poses, showOv])
  const auditNow = useMemo(() => (run ? audit(run.from, run.run, run.result) : null), [run])
  const zu = run ? run.run.pushers[Math.floor(f) * 2] : UPPER_PUSH_MIN
  const zl = run ? run.run.pushers[Math.floor(f) * 2 + 1] : -3

  useEffect(() => {
    ;(window as unknown as { __fieldLab?: unknown }).__fieldLab = { field, run, f, setF, drop, auto, setResult, audit: auditNow, overlaps: overlaps.length, poses }
  })

  // the plan from above
  useEffect(() => {
    const c = top.current
    if (!c) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#0b1424'
    g.fillRect(0, 0, W, H)
    const half = FIELD_W / 2
    // the upper tier, the lower tier, the tray
    g.fillStyle = '#172a45'
    g.fillRect(sx(-half), sz(BACK_Z), FIELD_W * S, (UPPER_FRONT_Z - BACK_Z) * S)
    g.fillStyle = '#13324a'
    g.fillRect(sx(-half), sz(UPPER_FRONT_Z), FIELD_W * S, (FRONT_Z - UPPER_FRONT_Z) * S)
    g.fillStyle = '#2a1d3a'
    g.fillRect(sx(-TRAY.w / 2), sz(TRAY.z - TRAY.d / 2), TRAY.w * S, TRAY.d * S)
    // the lower pusher's plate (under the shelf up to its face) and the upper pusher
    g.fillStyle = 'rgba(70,200,190,0.28)'
    g.fillRect(sx(-half), sz(UPPER_FRONT_Z), FIELD_W * S, (zl - UPPER_FRONT_Z) * S)
    g.fillStyle = 'rgba(90,220,210,0.55)'
    g.fillRect(sx(-half), sz(BACK_Z - 0.6), FIELD_W * S, (zu - BACK_Z + 0.6) * S)
    for (let k = 0; k < 11; k++) {
      g.fillStyle = k % 2 ? '#e8f7ff22' : '#ff5fa833'
      g.fillRect(sx(-half + k), sz(zu) - 4, S, 4)
      g.fillRect(sx(-half + k), sz(zl) - 4, S, 4)
    }
    // walls, the open sides, the edge and its lip
    g.strokeStyle = '#6f86a6'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(sx(-half), sz(BACK_Z))
    g.lineTo(sx(-half), sz(GUTTER_Z0))
    g.moveTo(sx(half), sz(BACK_Z))
    g.lineTo(sx(half), sz(GUTTER_Z0))
    g.stroke()
    g.strokeStyle = '#ff5d5d'
    g.setLineDash([5, 5])
    g.beginPath()
    g.moveTo(sx(-half), sz(GUTTER_Z0))
    g.lineTo(sx(-half), sz(FRONT_Z))
    g.moveTo(sx(half), sz(GUTTER_Z0))
    g.lineTo(sx(half), sz(FRONT_Z))
    g.stroke()
    g.strokeStyle = '#22d36f88'
    g.beginPath()
    g.moveTo(sx(-half), sz(FRONT_Z - LIP))
    g.lineTo(sx(half), sz(FRONT_Z - LIP))
    g.stroke()
    g.setLineDash([])
    g.strokeStyle = '#22d36f'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(sx(-half), sz(FRONT_Z))
    g.lineTo(sx(half), sz(FRONT_Z))
    g.moveTo(sx(-half), sz(UPPER_FRONT_Z))
    g.lineTo(sx(half), sz(UPPER_FRONT_Z))
    g.stroke()
    // the slot's reach, where the coin lands, the hopper
    g.strokeStyle = '#ffd84a66'
    g.beginPath()
    g.moveTo(sx(-SLOT_X), sz(LAND_Z))
    g.lineTo(sx(SLOT_X), sz(LAND_Z))
    g.stroke()
    g.fillStyle = '#ffd84a'
    g.beginPath()
    g.arc(sx(aim * SLOT_X), sz(LAND_Z), 4, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#c77dff88'
    g.strokeRect(sx(HOPPER.x - 0.8), sz(HOPPER.z - 0.5), 1.6 * S, 1 * S)
    // the bodies, lowest first
    const list = [...poses].sort((a, b) => a.y - b.y)
    for (const p of list) {
      const s = shapeOf(p.kind)
      const floor = p.z < UPPER_FRONT_Z ? UPPER_Y : 0
      const falling = p.fate === 'gutter' || p.y < floor - 0.05 || (p.fate === 'tray' && p.z > FRONT_Z - 0.05)
      const stacked = p.y - s.h / 2 > floor + (p.z > zl || p.z < UPPER_FRONT_Z ? 0.06 : LOWER_TOP + 0.06)
      g.save()
      g.globalAlpha = falling ? 0.45 : 1
      g.translate(sx(p.x), sz(p.z))
      if (s.coin) {
        const kx = Math.max(0.15, Math.abs(Math.cos(p.tiltZ)))
        const kz = Math.max(0.15, Math.abs(Math.cos(p.tiltX)))
        g.beginPath()
        g.ellipse(0, 0, s.r * S * kx, s.r * S * kz, 0, 0, Math.PI * 2)
        g.fillStyle = FILL[p.kind]
        g.fill()
        g.lineWidth = stacked ? 2.5 : 1
        g.strokeStyle = stacked ? '#ffffff' : '#0008'
        g.stroke()
        // the yaw, as a notch
        g.strokeStyle = '#0006'
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(0, 0)
        g.lineTo(Math.cos(-p.yaw) * s.r * S * 0.8, Math.sin(-p.yaw) * s.r * S * 0.8)
        g.stroke()
      } else {
        g.rotate(-p.yaw)
        g.fillStyle = FILL[p.kind]
        g.fillRect(-s.hw * S, -s.hd * S, s.hw * 2 * S, s.hd * 2 * S)
        g.lineWidth = stacked ? 3 : 1.5
        g.strokeStyle = stacked ? '#fff' : '#000a'
        g.strokeRect(-s.hw * S, -s.hd * S, s.hw * 2 * S, s.hd * 2 * S)
        g.rotate(p.yaw)
        g.fillStyle = '#000'
        g.font = 'bold 11px system-ui'
        g.textAlign = 'center'
        g.fillText(p.kind.toUpperCase(), 0, 4)
      }
      if (planned.has(p.id)) {
        g.strokeStyle = '#ff2fd0'
        g.lineWidth = 3
        g.beginPath()
        g.arc(0, 0, s.r * S + 4, 0, Math.PI * 2)
        g.stroke()
      }
      g.restore()
      // its speed
      const q = prev?.get(p.id)
      if (q && run) {
        const vx = (p.x - q.x) / run.run.step
        const vzz = (p.z - q.z) / run.run.step
        if (Math.abs(vx) + Math.abs(vzz) > 0.05) {
          g.strokeStyle = '#7df9ff'
          g.lineWidth = 1.5
          g.beginPath()
          g.moveTo(sx(p.x), sz(p.z))
          g.lineTo(sx(p.x + vx * 0.25), sz(p.z + vzz * 0.25))
          g.stroke()
        }
      }
    }
    // what intersects
    for (const o of overlaps) {
      g.strokeStyle = '#ff3030'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(sx(o.a.x), sz(o.a.z))
      g.lineTo(sx(o.b.x), sz(o.b.z))
      g.stroke()
      g.fillStyle = '#ff3030'
      g.font = 'bold 10px system-ui'
      g.fillText(o.d.toFixed(2), sx((o.a.x + o.b.x) / 2) + 4, sz((o.a.z + o.b.z) / 2))
    }
  }, [poses, prev, planned, overlaps, zu, zl, aim, run])

  // the side view
  useEffect(() => {
    const c = side.current
    if (!c) return
    const g = c.getContext('2d')!
    g.fillStyle = '#0b1424'
    g.fillRect(0, 0, W * (SS / S) + 40, SH)
    g.strokeStyle = '#6f86a6'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(vz(BACK_Z), vy(UPPER_Y))
    g.lineTo(vz(UPPER_FRONT_Z), vy(UPPER_Y))
    g.lineTo(vz(UPPER_FRONT_Z), vy(LOWER_TOP))
    g.moveTo(vz(UPPER_FRONT_Z), vy(0))
    g.lineTo(vz(FRONT_Z), vy(0))
    g.moveTo(vz(TRAY.z - TRAY.d / 2), vy(TRAY.y))
    g.lineTo(vz(TRAY.z + TRAY.d / 2), vy(TRAY.y))
    g.stroke()
    g.fillStyle = 'rgba(90,220,210,0.5)'
    g.fillRect(vz(BACK_Z - 0.5), vy(UPPER_Y + 1.1), (zu - BACK_Z + 0.5) * SS, 1.1 * SS)
    g.fillRect(vz(UPPER_FRONT_Z - 1), vy(LOWER_TOP), (zl - UPPER_FRONT_Z + 1) * SS, LOWER_TOP * SS)
    const list = [...poses].sort((a, b) => a.x - b.x)
    for (const p of list) {
      const s = shapeOf(p.kind)
      g.save()
      g.translate(vz(p.z), vy(p.y))
      g.rotate(p.tiltX)
      g.globalAlpha = 0.85
      g.fillStyle = FILL[p.kind]
      const half = s.coin ? s.r : s.hd
      g.fillRect(-half * SS, (-s.h / 2) * SS, half * 2 * SS, s.h * SS)
      if (planned.has(p.id)) {
        g.strokeStyle = '#ff2fd0'
        g.lineWidth = 2
        g.strokeRect(-half * SS, (-s.h / 2) * SS, half * 2 * SS, s.h * SS)
      }
      g.restore()
    }
  }, [poses, planned, zu, zl])

  const r = run?.run
  const tray = r ? trayOf(r) : null
  const c0 = countsOf(run ? run.from : field)
  const c1 = r ? countsOf(r.after) : null
  const evs = r ? r.events.filter((e) => e.kind !== 'land') : []
  const fi = Math.floor(f)
  return (
    <div className="mx-auto max-w-[1400px] p-4 text-[13px] text-ink">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-[20px] font-black">Field lab</h1>
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => setResult(p.r())} className="rounded-lg bg-raised px-2.5 py-1 font-bold hover:bg-hover">
            {p.name}
          </button>
        ))}
        <button onClick={() => setResult(drawDrop(Math.random()))} className="rounded-lg bg-violet/80 px-2.5 py-1 font-bold text-bg">
          Draw
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {ITEM_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1 rounded-lg bg-panel px-2 py-1">
            <span style={{ color: FILL[k] }} className="font-bold">
              {k}
            </span>
            <input
              type="number"
              min={0}
              max={k === 'gem' ? 2 : k === 'silver' || k === 'gold' ? 20 : 1}
              value={result.wins[k]}
              onChange={(e) => setResult(resultOf({ ...result.wins, [k]: Math.max(0, Number(e.target.value) | 0) }, result.feature))}
              className="w-12 rounded bg-raised px-1 text-right"
            />
          </label>
        ))}
        <select value={result.feature} onChange={(e) => setResult(resultOf(result.wins, e.target.value as Feature))} className="rounded-lg border border-line bg-panel px-2 py-1 font-bold">
          {(['none', 'shower', 'quake'] as const).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <span className="font-mono text-muted">
          {itemsOf(result.wins)} items · {multOf(result.wins)}×
        </span>
        <label className="flex items-center gap-2">
          aim
          <input type="range" min={-1} max={1} step={0.01} value={aim} onChange={(e) => setAim(Number(e.target.value))} />
          <span className="w-10 font-mono">{aim.toFixed(2)}</span>
        </label>
        <button onClick={() => drop()} className="rounded-lg bg-accent px-4 py-1 font-black text-bg">
          Drop
        </button>
        <button onClick={next} disabled={!run} className="rounded-lg bg-sky px-3 py-1 font-black text-bg disabled:opacity-40">
          Next (keep after)
        </button>
        <button onClick={() => auto(20)} className="rounded-lg bg-raised px-3 py-1 font-bold hover:bg-hover">
          Auto 20
        </button>
        <button onClick={() => auto(200)} className="rounded-lg bg-raised px-3 py-1 font-bold hover:bg-hover">
          Auto 200
        </button>
        <label className="flex items-center gap-1">
          seed
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) | 0)} className="w-16 rounded bg-raised px-1" />
        </label>
        <button onClick={() => (setField(newField(seed)), setRun(null), setF(0))} className="rounded-lg bg-raised px-3 py-1 font-bold hover:bg-hover">
          New field
        </button>
      </div>
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="flex flex-col gap-2">
          <canvas ref={top} width={W} height={H} className="rounded-2xl border border-line" style={{ width: W, height: H }} />
          <canvas ref={side} width={16 * SS} height={SH} className="rounded-2xl border border-line" style={{ width: 16 * SS, height: SH }} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="rounded-2xl border border-line bg-panel p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button onClick={() => (r && f >= r.frames - 1 && setF(0), setPlaying((p) => !p))} disabled={!r} className="rounded-lg bg-accent px-3 py-1 font-black text-bg disabled:opacity-40">
                {playing ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => (setPlaying(false), setF((x) => Math.max(0, Math.floor(x) - 1)))} className="rounded-lg bg-raised px-2 py-1 font-bold">
                ◀
              </button>
              <button onClick={() => (setPlaying(false), setF((x) => Math.min((r?.frames ?? 1) - 1, Math.floor(x) + 1)))} className="rounded-lg bg-raised px-2 py-1 font-bold">
                ▶
              </button>
              {[0.1, 0.25, 1, 2, 4].map((x) => (
                <button key={x} onClick={() => setSpeed(x)} className={`rounded-lg px-2 py-1 font-bold ${speed === x ? 'bg-sky text-bg' : 'bg-raised'}`}>
                  {x}×
                </button>
              ))}
              <label className="ml-2 flex items-center gap-1">
                <input type="checkbox" checked={showOv} onChange={(e) => setShowOv(e.target.checked)} /> overlaps
              </label>
              <span className="ml-auto font-mono text-muted">
                frame {fi} / {r ? r.frames - 1 : 0} · {(fi * (r?.step ?? 0)).toFixed(2)} s
              </span>
            </div>
            <input type="range" min={0} max={r ? r.frames - 1 : 0} step={1} value={fi} onChange={(e) => (setPlaying(false), setF(Number(e.target.value)))} className="w-full" />
          </div>
          <div className="rounded-2xl border border-line bg-panel p-3 font-mono text-[12px] leading-5">
            <div className="text-[14px] font-black text-ink">{run ? label(run.result) : label(result)}</div>
            {r && run && tray && c1 && (
              <>
                <div>
                  computed in <b className="text-gold">{run.ms.toFixed(1)} ms</b> · {r.frames} frames ({(r.frames * r.step).toFixed(1)} s) · {r.tracks.length} tracks · {r.events.length} events
                </div>
                <div>
                  tray: {ITEM_KINDS.map((k) => `${k} ${tray[k]}/${run.result.wins[k]}`).join(' · ')}{' '}
                  <b className={auditNow?.misses ? 'text-danger' : 'text-accent'}>{auditNow?.misses ? 'MISS' : 'exact'}</b>
                </div>
                <div>
                  field: {coinsOf(run.from)} coins → {coinsOf(r.after)} · gold {c0.gold} → {c1.gold} · prizes {c1.gem}/{c1.bar}/{c1.idol}/{c1.crown} · gutters {r.tracks.filter((t) => t.fate === 'gutter').length}
                </div>
                <div>
                  at rest: <b className={auditNow?.ov.length ? 'text-danger' : 'text-accent'}>{auditNow?.ov.length} overlaps</b> (worst {auditNow?.maxOverlap.toFixed(3)}) · {auditNow?.out.length} out of place · now {overlaps.length} overlapping
                </div>
              </>
            )}
            {!r && (
              <div>
                field: {coinsOf(field)} coins · {c0.silver} silver · {c0.gold} gold · {c0.gem} gems · bar {c0.bar} · idol {c0.idol} · crown {c0.crown}
              </div>
            )}
          </div>
          {score && (
            <div className="rounded-2xl border border-line bg-panel p-3 font-mono text-[12px] leading-5">
              <div className="text-[14px] font-black">Auto: {score.drops} drops</div>
              <div>
                ms per drop: mean {(score.ms / Math.max(1, score.drops)).toFixed(1)} · worst {score.worst.toFixed(1)} · frames mean {(score.frames / Math.max(1, score.drops)).toFixed(0)}
              </div>
              <div className={score.misses || score.stray ? 'text-danger' : 'text-accent'}>
                misses {score.misses} · errors {score.stray}
              </div>
              <div>
                overlaps at rest {score.overlaps} (worst {score.maxOverlap.toFixed(3)}) · out of place {score.out} · coins {score.coinsMin}–{score.coinsMax}
              </div>
            </div>
          )}
          <div className="max-h-[420px] overflow-auto rounded-2xl border border-line bg-panel p-3 font-mono text-[12px] leading-5">
            {evs.map((e, i) => (
              <div key={i} onClick={() => (setPlaying(false), setF(e.f))} className={`cursor-pointer ${e.f <= fi ? 'text-ink' : 'text-dim'} hover:text-sky`}>
                {String(e.f).padStart(4)} {e.kind}
                {'item' in e ? ` ${e.item} #${e.id}` : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
