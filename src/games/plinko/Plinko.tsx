import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Label, Segmented, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useWallet } from '../../store/wallet'

type Risk = 'low' | 'medium' | 'high'
type Rows = 8 | 12 | 16

const TABLES: Record<Rows, Record<Risk, number[]>> = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
}

/** red at the edges → amber → yellow in the middle */
function bucketColor(k: number, rows: number) {
  const t = Math.abs(k - rows / 2) / (rows / 2)
  const stops = [
    [255, 214, 77],
    [255, 160, 60],
    [255, 92, 72],
    [255, 48, 92],
  ]
  const x = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

interface Ball {
  id: number
  path: number[] // 0 = left, 1 = right, per row
  t: number // progress in segments
  bet: number
  rows: Rows
  risk: Risk
  done: boolean
  trail: [number, number][]
}

let ballSeq = 1
const SEG_TIME = 0.12 // seconds per row

export default function Plinko() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [risk, setRisk] = useState<Risk>('medium')
  const [rows, setRows] = useState<Rows>(16)
  const [inFlight, setInFlight] = useState(0)
  const [mode, setMode] = useState<Mode>('manual')
  const [recent, setRecent] = useState<{ id: number; mult: number; k: number; rows: number }[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const balls = useRef<Ball[]>([])
  const pegFlash = useRef<Map<string, number>>(new Map())
  const bucketHit = useRef<Map<number, number>>(new Map())
  const cfg = useRef({ rows, risk })
  cfg.current = { rows, risk }
  const settleRef = useRef(settle)
  settleRef.current = settle

  const drop = () => {
    if (!stake(bet)) return false
    const path = Array.from({ length: rows }, () => (rand() < 0.5 ? 0 : 1))
    balls.current.push({ id: ballSeq++, path, t: -1, bet, rows, risk, done: false, trail: [] })
    setInFlight((n) => n + 1)
    return true
  }

  // autoplay: one ball every few hundred ms; results settle as they land
  const auto = useAutoBet(async () => (drop() ? 0 : null), 330)

  // canvas sizing
  const [size, setSize] = useState({ w: 800, h: 600 })
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // render loop
  useEffect(() => {
    const cv = canvasRef.current!
    const ctx = cv.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size.w * dpr
    cv.height = size.h * dpr
    let raf = 0
    let last = performance.now()
    let lastPegSound = 0
    let drawnKey = ''
    let lastEvent = 0
    const sprites = new Map<string, HTMLCanvasElement>()
    // a peg with its soft glow, drawn once per size and reused (a canvas shadow blur on every peg every frame is slow)
    const pegSprite = (r: number, hot: boolean) => {
      const key = `${r.toFixed(2)}${hot ? 'h' : ''}`
      let c = sprites.get(key)
      if (!c) {
        const pad = Math.ceil(r + (hot ? 12 : 4) * 1.5)
        c = document.createElement('canvas')
        c.width = c.height = Math.ceil(pad * 2 * dpr)
        const g = c.getContext('2d')!
        g.scale(dpr, dpr)
        g.shadowColor = hot ? 'rgba(255,95,162,.9)' : 'rgba(255,255,255,.35)'
        g.shadowBlur = hot ? 12 : 4 // device pixels, like the original per-peg blur
        g.fillStyle = hot ? '#ffd0e6' : '#ffffff'
        g.beginPath()
        g.arc(pad, pad, r, 0, Math.PI * 2)
        g.fill()
        sprites.set(key, c)
      }
      return c
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { rows: R, risk: K } = cfg.current
      const table = TABLES[R][K]
      // nothing moving and nothing changed since the last frame we drew: leave the canvas as it is
      const key = `${R}${K}${size.w}x${size.h}`
      if (balls.current.length > 0) lastEvent = now
      if (key === drawnKey && now - lastEvent > 700) {
        raf = requestAnimationFrame(frame)
        return
      }
      drawnKey = key
      const W = size.w
      const Hh = size.h
      const small = Hh < 500
      const padTop = small ? 26 : 46
      const gap = Math.min((W - 32) / (R + 2), (Hh - padTop - (small ? 40 : 70)) / (R + 0.6))
      const cx = W / 2
      const top = padTop
      const pegR = Math.max(2.5, gap * 0.1)
      const ballR = Math.max(4.5, gap * 0.25)
      const bucketY = top + (R - 1) * gap + gap * 0.75
      const bucketH = Math.max(22, gap * 0.62)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, Hh)

      // pegs: white studs that flash pink and ring out when the ball hits them
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < r + 3; c++) {
          const x = cx + (c - (r + 2) / 2) * gap
          const y = top + r * gap
          const f = pegFlash.current.get(`${r}-${c}`)
          const age = f ? (now - f) / 1000 : 9
          if (age < 0.4) {
            const a = 1 - age / 0.4
            ctx.beginPath()
            ctx.arc(x, y, pegR + (1 - a) * pegR * 3.2, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(255,95,162,${0.28 * a})`
            ctx.fill()
          }
          const sp = pegSprite(pegR, age < 0.18)
          const half = sp.width / dpr / 2
          ctx.drawImage(sp, x - half, y - half, half * 2, half * 2)
        }
      }

      // buckets: rounded blocks with a darker base that press down when hit
      const bw = gap * 0.88
      const fs = Math.max(9, Math.min(15, gap * 0.3))
      ctx.font = `800 ${fs}px Manrope, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lip = Math.max(3, Math.round(bucketH * 0.14))
      const rad = Math.min(6, bw * 0.16)
      for (let k = 0; k <= R; k++) {
        const x = cx + (k - R / 2) * gap - bw / 2
        const h = bucketHit.current.get(k)
        const age = h ? (now - h) / 1000 : 9
        const press = age < 0.1 ? lip : age < 0.32 ? lip * (1 - (age - 0.1) / 0.22) : 0
        const col = bucketColor(k, R)
        roundRect(ctx, x, bucketY + lip, bw, bucketH - lip, rad)
        ctx.fillStyle = shadeRgb(col, -0.42)
        ctx.fill()
        roundRect(ctx, x, bucketY + press, bw, bucketH - lip, rad)
        ctx.fillStyle = col
        ctx.fill()
        if (age < 0.45) {
          ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - age / 0.45)})`
          ctx.fill()
        }
        ctx.fillStyle = '#2a0b12'
        const m = table[k]
        ctx.fillText(m >= 100 ? `${m}` : `${m}×`, x + bw / 2, bucketY + press + (bucketH - lip) / 2 + 0.5)
      }

      // balls
      let landed = false
      for (const b of balls.current) {
        if (b.done || b.rows !== R) {
          if (!b.done && b.rows !== R) b.done = true
          continue
        }
        b.t += dt / SEG_TIME
        const seg = Math.floor(b.t)
        const f = b.t - seg
        // keypoint i: i = -1 is the drop point, 0..R-1 contact on row i, R = bucket
        const kp = (i: number): [number, number] => {
          if (i < 0) return [cx, top - gap * 1.1]
          let rights = 0
          for (let j = 0; j < Math.min(i, R); j++) rights += b.path[j]
          if (i >= R) return [cx + (rights - R / 2) * gap, bucketY - ballR * 0.2]
          return [cx + (rights - i / 2) * gap, top + i * gap - pegR - ballR]
        }
        if (seg >= R) {
          b.done = true
          landed = true
          const k = b.path.reduce((a, v) => a + v, 0)
          bucketHit.current.set(k, now)
          const mult = TABLES[b.rows][b.risk][k]
          const payout = round2(b.bet * mult)
          settleRef.current({ game: 'plinko', bet: b.bet, payout, meta: { rows: b.rows, risk: b.risk } })
          setRecent((r) => [{ id: b.id, mult, k, rows: b.rows }, ...r].slice(0, 6))
          if (mult >= 10) sfx.bigWin()
          else if (mult >= 1) sfx.coin()
          else sfx.tick()
          continue
        }
        // entering a new segment = hitting the peg at the start of it
        const prevSeg = Math.floor(b.t - dt / SEG_TIME)
        if (seg !== prevSeg && seg >= 0 && seg < R) {
          let rights = 0
          for (let j = 0; j < seg; j++) rights += b.path[j]
          pegFlash.current.set(`${seg}-${rights + 1}`, now)
          if (now - lastPegSound > 45) {
            sfx.peg()
            lastPegSound = now
          }
        }
        const [x0, y0] = kp(seg)
        const [x1, y1] = kp(seg + 1)
        const hop = seg < 0 ? 0 : gap * 0.42
        const x = x0 + (x1 - x0) * f
        const y = y0 + (y1 - y0) * f * f - hop * Math.sin(Math.PI * f) * (1 - f * 0.4)
        b.trail.push([x, y])
        if (b.trail.length > 6) b.trail.shift()
        b.trail.forEach(([tx, ty], i) => {
          ctx.beginPath()
          ctx.arc(tx, ty, ballR * (0.35 + (i / b.trail.length) * 0.5), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,95,162,${0.05 + (i / b.trail.length) * 0.18})`
          ctx.fill()
        })
        const g = ctx.createRadialGradient(x - ballR * 0.35, y - ballR * 0.4, ballR * 0.1, x, y, ballR)
        g.addColorStop(0, '#ffe1ef')
        g.addColorStop(0.35, '#ff6fae')
        g.addColorStop(1, '#c4185c')
        // soft pink halo, then the ball
        const halo = ctx.createRadialGradient(x, y, ballR * 0.6, x, y, ballR * 2.3)
        halo.addColorStop(0, 'rgba(255,95,162,.45)')
        halo.addColorStop(1, 'rgba(255,95,162,0)')
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(x, y, ballR * 2.3, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y, ballR, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()
      }
      if (landed || balls.current.some((b) => b.done)) {
        const before = balls.current.length
        balls.current = balls.current.filter((b) => !b.done)
        if (before !== balls.current.length) setInFlight(balls.current.length)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        drop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const locked = inFlight > 0 || auto.running

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={auto.running} />
      <BetInput value={bet} onChange={setBet} disabled={auto.running} />
      <div>
        <Label>Risk</Label>
        <Segmented
          value={risk}
          disabled={locked}
          onChange={setRisk}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
        />
      </div>
      <div>
        <Label>Rows</Label>
        <Segmented value={rows} disabled={locked} onChange={setRows} options={[8, 12, 16].map((r) => ({ value: r as Rows, label: r }))} />
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} stops={false} />}
      <div className="flex flex-col gap-2 max-lg:order-first lg:mt-auto">
        {mode === 'manual' ? (
          <ActionButton onClick={drop} disabled={balance < bet}>
            Bet
          </ActionButton>
        ) : auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop}>
            Stop autobet
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={balance < bet}>
            Start autobet
          </ActionButton>
        )}
      </div>
    </>
  )

  const stage = (
    <div ref={wrapRef} className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,#1a3346_0%,#0d1c28_55%,#0a1620_100%)]">
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} className="relative block" />
      <div className="absolute right-3 top-1/2 flex w-[58px] -translate-y-1/2 flex-col gap-1.5 overflow-hidden rounded-xl max-sm:top-3 max-sm:w-auto max-sm:translate-y-0 max-sm:flex-row">
        <AnimatePresence initial={false}>
          {recent.map((r) => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="tnum rounded-md py-2 text-center text-[12px] font-extrabold leading-none text-[#2a0b12] max-sm:min-w-[44px] max-sm:px-1.5"
              style={{ background: bucketColor(r.k, r.rows), boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.25)' }}
            >
              {r.mult}×
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )

  return <GameShell panel={panel} stage={stage} />
}

function shadeRgb(rgb: string, amt: number) {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number)
  const f = (v: number) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)
  return `rgb(${f(r)},${f(g)},${f(b)})`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
