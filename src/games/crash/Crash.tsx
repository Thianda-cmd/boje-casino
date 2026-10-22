import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, NumberField, Toggle, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Coin, IconCheck, IconUsers } from '../../components/icons'
import { Modal } from '../../components/Modal'
import { Rocket } from '../../art/Rocket'
import { fmt, fmtMult, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { safeStorage } from '../../lib/storage'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { verifyRound, type Verdict } from './fair'
import { BET_MS, connect, defaultName, GROWTH, multAt, saveName, timeAt, tryShared, type CrashServer, type Feed, type Phase, type RoundInfo } from './net'
import { Spinner } from '../../components/Loader'
import { PlayerName } from '../../components/profile/PlayerName'

/* Crash: everyone rides the same rocket. Bets open for a few seconds, the rocket launches, and each
   player cashes out (or doesn't) before it blows. Rounds come from the shared database when it is
   reachable and from a local stand-in otherwise. Every round is provably fair: its hash is shown
   before betting and its seed is revealed after the crash. */

type Conn = 'connecting' | 'live' | 'reconnecting' | 'solo'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  smoke?: boolean
}


export default function Crash() {
  const stake = useStake()
  const settle = useWallet((s) => s.settle)
  const refund = useWallet((s) => s.refund)
  const pushToast = useWallet((s) => s.pushToast)
  const uid = useAuth((s) => s.uid)
  const username = useAuth((s) => s.profile?.username ?? null)

  const [mode, setMode] = useState<Mode>('manual')
  const [bet, setBet] = useState(10)
  const [autoOn, setAutoOn] = useState(true)
  const [autoAt, setAutoAt] = useState(2)
  const [guestName, setGuestName] = useState(defaultName)
  const name = username ?? guestName
  const [server, setServer] = useState<CrashServer | null>(null)
  const [conn, setConn] = useState<Conn>('connecting')
  const [feed, setFeed] = useState<Feed | null>(null)
  const [queued, setQueued] = useState(false)
  const queuedRef = useRef(false)
  queuedRef.current = queued
  const [sending, setSending] = useState(false)
  const [live, setLive] = useState(1)
  const [fair, setFair] = useState<number | null>(null)
  const [result, setResult] = useState<{ round: number; mult: number; amount: number } | null>(null)
  const resultRef = useRef(result)
  resultRef.current = result

  const feedRef = useRef<Feed | null>(null)
  const offset = useRef(0) // server clock minus local clock
  const settled = useRef(new Set<number>())
  // rounds we have paid into but not settled yet; kept across reloads so a refresh can't lose a win
  const pendingKey = `lumen.crash.pending.${uid ?? 'guest'}`
  const staked = useRef(new Map<number, number>(readPending(pendingKey)))
  const savePending = () => safeStorage.setItem(pendingKey, JSON.stringify([...staked.current]))
  const [stageRef, size] = useSize<HTMLDivElement>()

  /* ---------------- connection and polling ---------------- */

  useEffect(() => {
    let alive = true
    connect().then((s) => {
      if (!alive) return
      setServer(s)
      setConn(s.online ? 'live' : 'solo')
    })
    return () => void (alive = false)
  }, [])

  const poll = useRef<() => void>(() => {})
  useEffect(() => {
    if (!server) return
    let stop = false
    let timer = 0
    let lastOk = Date.now()
    const tick = async () => {
      clearTimeout(timer)
      const t0 = Date.now()
      let ok = false
      try {
        const f = await server.state()
        const est = f.now - (t0 + Date.now()) / 2
        offset.current = feedRef.current ? offset.current * 0.8 + est * 0.2 : est
        feedRef.current = f
        setFeed(f)
        ok = true
        lastOk = Date.now()
        if (server.online) setConn('live')
      } catch {
        // keep showing the last state and try again
        if (server.online && Date.now() - lastOk > 2500) setConn('reconnecting')
      }
      if (stop) return
      const f = feedRef.current
      const busy = !!f && (staked.current.has(f.round.id) || queuedRef.current)
      const delay = !server.online ? 100 : !ok ? 1200 : document.hidden && !busy ? 4000 : f?.round.phase === 'running' ? 350 : 800
      timer = window.setTimeout(tick, delay)
    }
    poll.current = tick
    tick()
    const onVisible = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [server])

  const retryShared = async () => {
    setConn('connecting')
    const s = await tryShared()
    if (s) {
      feedRef.current = null
      setFeed(null)
      setServer(s)
      setConn('live')
    } else {
      setConn('solo')
      pushToast({ kind: 'info', title: 'Shared rounds are still unavailable.' })
    }
  }

  /* ---------------- autobet ---------------- */

  const autoWait = useRef<{ resolve: (net: number | null) => void; round: number | null } | null>(null)
  const endAutoRound = (net: number | null) => {
    const w = autoWait.current
    autoWait.current = null
    w?.resolve(net)
  }
  const auto = useAutoBet(
    () =>
      new Promise<number | null>((resolve) => {
        autoWait.current = { resolve, round: null }
        setQueued(true)
      }),
    50,
  )
  const stopAuto = () => {
    auto.stop()
    if (autoWait.current && autoWait.current.round == null) {
      setQueued(false)
      endAutoRound(null)
    }
  }
  const cashTarget = mode === 'auto' || autoOn ? autoAt : null

  /* ---------------- settling ---------------- */

  const finish = (id: number, amount: number, m: number) => {
    if (settled.current.has(id)) return
    settled.current.add(id)
    staked.current.delete(id)
    savePending()
    const payout = round2(amount * m)
    settle({ game: 'crash', bet: amount, payout, meta: { at: m } })
    if (m > 0) {
      setResult({ round: id, mult: m, amount: payout })
      ;(m >= 10 ? sfx.bigWin : sfx.win)()
    } else sfx.lose()
    if (autoWait.current?.round === id) endAutoRound(payout - amount)
  }

  useEffect(() => {
    if (!feed) return
    for (const [id, amount] of staked.current) {
      if (feed.round.id === id && feed.mine) {
        if (feed.mine.cashed != null) finish(id, amount, feed.mine.cashed)
        else if (feed.round.phase === 'crashed') finish(id, amount, 0)
      } else {
        const p = feed.past.find((x) => x.round === id)
        if (p) finish(id, amount, p.cashed ?? 0)
        else if (id < feed.round.id - 6 || (id > feed.round.id && !server?.online) || (id === feed.round.id && !feed.mine && feed.round.phase !== 'betting')) {
          // too old to look up, from a solo session that is gone, or never reached the server
          finish(id, amount, 0)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed])

  /* ---------------- actions ---------------- */

  const estNow = () => Date.now() + offset.current
  const placeBet = async () => {
    const f = feedRef.current
    if (!server || !f || sending) return
    if (staked.current.has(f.round.id)) return
    if (f.round.phase !== 'betting' || estNow() > f.round.startsAt - 250) {
      setQueued(true)
      return
    }
    if (!stake(bet)) {
      setQueued(false)
      if (autoWait.current) {
        auto.stop()
        endAutoRound(null)
      }
      return
    }
    setSending(true)
    const r = await server.bet(bet, cashTarget, name).catch(() => ({ ok: false as const, error: 'network' }))
    setSending(false)
    if (r.ok) {
      staked.current.set(r.round, bet)
      savePending()
      setQueued(false)
      setResult(null)
      if (autoWait.current) autoWait.current.round = r.round
      poll.current()
    } else {
      refund(bet)
      if (r.error === 'closed') setQueued(true)
      else {
        setQueued(false)
        if (autoWait.current) {
          auto.stop()
          endAutoRound(null)
        }
        pushToast({ kind: 'info', title: r.error === 'network' ? 'Connection problem. Your bet was not placed.' : 'Bet not placed. Try again.' })
      }
    }
  }

  const cashOut = async () => {
    const f = feedRef.current
    if (!server || !f || sending) return
    const id = f.round.id
    const amount = staked.current.get(id)
    if (amount == null || settled.current.has(id)) return
    setSending(true)
    const r = await server.cashout(id).catch(() => null)
    setSending(false)
    if (r?.ok) finish(id, amount, r.cashed)
    else poll.current()
  }

  // a queued bet goes in as soon as the next betting window opens
  useEffect(() => {
    if (queued && feed?.round.phase === 'betting' && !staked.current.has(feed.round.id)) void placeBet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, feed?.round.id, feed?.round.phase])

  /* ---------------- drawing ---------------- */

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rocketRef = useRef<HTMLDivElement>(null)
  const multRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    const cv = canvasRef.current!
    const ctx = cv.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    let raf = 0
    let last = performance.now()
    let lastLive = 0
    let prevPhase: Phase | null = null
    let prevRound = -1
    let crashAt = 0
    let parts: Particle[] = []
    const stars = Array.from({ length: 110 }, () => ({ x: rand(), y: rand(), z: 0.2 + rand() * 0.8, p: rand() * Math.PI * 2 }))

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const f = feedRef.current
      const W = size.w
      const H = size.h
      const est = Date.now() + offset.current
      const small = W < 520

      let ph: Phase = f?.round.phase ?? 'betting'
      if (f && ph === 'betting' && est >= f.round.startsAt) ph = 'running' // launch on time, don't wait for the poll
      let t = 0
      let m = 1
      if (f && ph === 'running') {
        t = (est - f.round.startsAt) / 1000
        m = multAt(t * 1000)
      } else if (f && ph === 'crashed') {
        m = f.round.crash ?? 1
        t = Math.log(m) / GROWTH
      }

      // geometry
      const padL = small ? 40 : 64
      const padR = small ? 26 : 56
      const padT = small ? 56 : 70
      const padB = small ? 34 : 40
      const gw = W - padL - padR
      const gh = H - padT - padB
      const maxT = Math.max(10, t * 1.15)
      const maxM = Math.max(2, 1 + (m - 1) * 1.25)
      const X = (s: number) => padL + (s / maxT) * gw
      const Y = (mm: number) => padT + gh - ((mm - 1) / (maxM - 1)) * gh
      const baseY = Y(1)

      // round transitions
      if (f && f.round.id !== prevRound) {
        prevRound = f.round.id
        parts = []
      }
      if (ph === 'crashed' && prevPhase && prevPhase !== 'crashed') {
        crashAt = now
        const hx = X(t)
        const hy = Y(m)
        for (let i = 0; i < 60; i++) {
          const a = rand() * Math.PI * 2
          const sp = 80 + rand() * 320
          parts.push({ x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0, max: 0.5 + rand() * 0.7, size: 1.5 + rand() * 3, color: ['#fff4b0', '#ffb02e', '#ff6a3c', '#ff3d5a'][Math.floor(rand() * 4)] })
        }
        for (let i = 0; i < 14; i++) {
          const a = rand() * Math.PI * 2
          parts.push({ x: hx, y: hy, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50 - 30, life: 0, max: 1.2 + rand() * 0.8, size: 8 + rand() * 10, color: '#6b6f80', smoke: true })
        }
        setShake(true)
        setTimeout(() => setShake(false), 420)
      }
      prevPhase = ph

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // stars drift faster as the rocket picks up speed
      const speed = ph === 'running' ? 0.02 + Math.min(m, 40) * 0.006 : 0.004
      for (const st of stars) {
        st.x -= speed * st.z * dt
        st.y += speed * st.z * dt * 0.35
        if (st.x < 0) st.x += 1
        if (st.y > 1) st.y -= 1
        const tw = 0.55 + 0.45 * Math.sin(now / 600 + st.p)
        ctx.globalAlpha = (0.15 + st.z * 0.55) * tw
        ctx.fillStyle = st.z > 0.85 ? '#d9ccff' : '#ffffff'
        ctx.beginPath()
        ctx.arc(st.x * W, st.y * H, 0.5 + st.z * 1.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // grid and labels
      ctx.font = `600 ${small ? 11 : 12}px Manrope, system-ui, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'
      const mStep = niceStep((maxM - 1) / 4)
      const ticks = [1]
      for (let v = Math.floor(1 / mStep + 1) * mStep; v <= maxM + 1e-6; v += mStep) if (v - 1 > mStep * 0.4) ticks.push(v)
      ctx.lineWidth = 1
      for (const v of ticks) {
        const y = Math.round(Y(v)) + 0.5
        ctx.strokeStyle = 'rgba(255,255,255,.06)'
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(W - padR, y)
        ctx.stroke()
        ctx.fillStyle = 'rgba(200,210,235,.45)'
        ctx.fillText(`${v.toFixed(v < 10 ? 1 : 0)}×`, padL - 8, y)
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const tStep = niceStep(maxT / (small ? 4 : 5))
      for (let s = 0; s <= maxT + 1e-6; s += tStep) ctx.fillText(`${Math.round(s)}s`, X(s), H - padB + 12)

      // the curve
      const cashedHere = resultRef.current && f && resultRef.current.round === f.round.id
      const [c1, c2] = ph === 'crashed' ? ['#ff4d61', '#ff8a5c'] : cashedHere ? ['#22d36f', '#7dffb4'] : ['#7b5cff', '#ff5fa2']
      const hx = X(t)
      const hy = Y(m)
      if (ph !== 'betting') {
        const pts: [number, number][] = []
        const steps = Math.max(2, Math.ceil((hx - padL) / 3))
        for (let i = 0; i <= steps; i++) {
          const s = (t * i) / steps
          pts.push([X(s), Y(Math.min(m, multAt(s * 1000)))])
        }
        const fill = ctx.createLinearGradient(0, hy, 0, baseY)
        fill.addColorStop(0, c1 + '55')
        fill.addColorStop(1, c1 + '05')
        ctx.beginPath()
        ctx.moveTo(pts[0][0], baseY)
        for (const [x, y] of pts) ctx.lineTo(x, y)
        ctx.lineTo(hx, baseY)
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
        const stroke = ctx.createLinearGradient(padL, 0, Math.max(padL + 1, hx), 0)
        stroke.addColorStop(0, c1)
        stroke.addColorStop(1, c2)
        const curve = new Path2D()
        pts.forEach(([x, y], i) => (i ? curve.lineTo(x, y) : curve.moveTo(x, y)))
        const lw = small ? 4 : 5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        // the glow is two wide see-through strokes under the line; a canvas shadow blur on a long path is far slower
        ctx.strokeStyle = c2
        ctx.globalAlpha = 0.1
        ctx.lineWidth = lw + 16
        ctx.stroke(curve)
        ctx.globalAlpha = 0.2
        ctx.lineWidth = lw + 7
        ctx.stroke(curve)
        ctx.globalAlpha = 1
        ctx.strokeStyle = stroke
        ctx.lineWidth = lw
        ctx.stroke(curve)

        // where players got out: a dot on the curve and, where there is room, their name
        if (f) {
          const outs = f.bets
            .filter((b) => b.cashed != null && b.cashed <= m + 1e-9)
            .sort((a, b) => a.cashed! - b.cashed! || Number(b.me) - Number(a.me))
            .slice(-40)
          let lastLabel = -Infinity
          ctx.font = `700 ${small ? 10 : 11}px Manrope, system-ui, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'left'
          for (const b of outs) {
            const x = X(timeAt(b.cashed!) / 1000)
            const y = Y(b.cashed!)
            ctx.fillStyle = b.me ? '#22d36f' : '#ffffff'
            ctx.globalAlpha = b.me ? 1 : 0.85
            ctx.beginPath()
            ctx.arc(x, y, b.me ? 5 : 3.5, 0, Math.PI * 2)
            ctx.fill()
            if (x - lastLabel > (small ? 64 : 84) || b.me) {
              lastLabel = x
              const label = `${b.me ? 'You' : b.name} ${b.cashed!.toFixed(2)}×`
              const w = ctx.measureText(label).width + 12
              const lx = Math.min(W - padR - w + 20, x - w / 2)
              const ly = y - (small ? 20 : 24)
              ctx.globalAlpha = 0.92
              ctx.fillStyle = b.me ? '#22d36f' : 'rgba(15,22,40,.86)'
              pill(ctx, lx, ly - 9, w, 18)
              ctx.fill()
              ctx.globalAlpha = 1
              ctx.fillStyle = b.me ? '#032412' : '#e8ecf8'
              ctx.fillText(label, lx + 6, ly + 0.5)
            }
          }
          ctx.globalAlpha = 1
        }
      }

      // explosion
      const sinceCrash = (now - crashAt) / 1000
      if (ph === 'crashed' && sinceCrash < 0.5) {
        const k = sinceCrash / 0.5
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 30 + k * 110)
        g.addColorStop(0, `rgba(255,246,200,${1 - k})`)
        g.addColorStop(0.35, `rgba(255,150,50,${0.8 * (1 - k)})`)
        g.addColorStop(1, 'rgba(255,60,60,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(hx, hy, 30 + k * 110, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = `rgba(255,200,120,${0.7 * (1 - k)})`
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(hx, hy, 20 + k * 160, 0, Math.PI * 2)
        ctx.stroke()
      }
      parts = parts.filter((p) => (p.life += dt) < p.max)
      for (const p of parts) {
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.smoke) {
          p.vx *= 0.97
          p.vy -= 10 * dt
        } else p.vy += 300 * dt
        const k = p.life / p.max
        const a = p.smoke ? 0.35 * (1 - k) : 1 - k * k
        ctx.fillStyle = p.color
        if (!p.smoke) {
          // a faint halo instead of a shadow blur
          ctx.globalAlpha = a * 0.25
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = a
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.smoke ? p.size * (1 + k * 1.5) : p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // the rocket rides the head of the curve, nose along the slope
      const rk = rocketRef.current
      if (rk) {
        if (ph === 'crashed') rk.style.opacity = '0'
        else {
          let x = padL + 8
          let y = baseY - 6
          let ang = -18
          if (ph === 'running') {
            x = hx
            y = hy
            const dx = X(t) - X(Math.max(0, t - 0.25))
            const dy = Y(m) - Y(multAt(Math.max(0, t - 0.25) * 1000))
            ang = Math.max(-70, Math.min(-8, (Math.atan2(dy, Math.max(1, dx)) * 180) / Math.PI))
            ang += Math.sin(now / 90) * 0.8
          }
          rk.style.opacity = '1'
          rk.style.transform = `translate(${x}px, ${y}px) rotate(${ang}deg)`
        }
      }

      // DOM readouts
      if (multRef.current) multRef.current.textContent = fmtMult(Math.floor(m * 100) / 100)
      if (f && ph === 'betting') {
        const left = Math.max(0, f.round.startsAt - est)
        if (countRef.current) countRef.current.textContent = `${(left / 1000).toFixed(1)}s`
        if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, left / BET_MS)})`
      }
      if (ph === 'running' && now - lastLive > 100) {
        lastLive = now
        setLive(m)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code !== 'Space') return
      e.preventDefault()
      const f = feedRef.current
      if (!f) return
      const inRound = staked.current.has(f.round.id) && !settled.current.has(f.round.id)
      if (inRound && f.round.phase === 'running') void cashOut()
      else if (mode === 'auto') return
      else if (queued) setQueued(false)
      else if (!inRound) void placeBet()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- view ---------------- */

  const round = feed?.round
  const phase = round?.phase
  const myStake = round ? staked.current.get(round.id) : undefined
  const inRound = myStake != null && !settled.current.has(round!.id)
  const myResult = result && round && result.round === round.id ? result : null
  const lost = !!round && phase === 'crashed' && feed?.mine && feed.mine.cashed == null && !myResult
  const online = !!server?.online
  const cashButton = (
    <ActionButton tone="gold" onClick={cashOut} disabled={sending} sub={`${fmt((myStake ?? 0) * Math.floor(live * 100) / 100)} coins`}>
      Cash out
    </ActionButton>
  )

  let action: React.ReactNode
  if (!feed) action = <ActionButton disabled>Connecting…</ActionButton>
  else if (mode === 'auto') {
    if (!auto.running)
      action = (
        <ActionButton onClick={() => void auto.start()} disabled={sending || inRound}>
          Start autobet
        </ActionButton>
      )
    else if (inRound && phase === 'running')
      action = (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          {cashButton}
          <ActionButton tone="neutral" onClick={stopAuto} className="!w-auto px-5">
            Stop
          </ActionButton>
        </div>
      )
    else
      action = (
        <ActionButton tone="neutral" onClick={stopAuto} sub={auto.left != null ? `${auto.left} ${auto.left === 1 ? 'round' : 'rounds'} left` : inRound ? 'In this round' : 'Joins the next round'}>
          Stop autobet
        </ActionButton>
      )
  } else if (inRound && phase === 'running') action = cashButton
  else if (inRound)
    action = (
      <ActionButton tone="neutral" disabled sub={cashTarget ? `Auto cash out at ${cashTarget.toFixed(2)}×` : 'Waiting for launch'}>
        Bet placed
      </ActionButton>
    )
  else if (queued)
    action = (
      <ActionButton tone="neutral" onClick={() => setQueued(false)} sub="Joins the next round">
        Cancel bet
      </ActionButton>
    )
  else
    action = (
      <ActionButton onClick={placeBet} disabled={sending}>
        {phase === 'betting' ? 'Bet' : 'Bet next round'}
      </ActionButton>
    )

  const locked = inRound || queued || auto.running

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <BetInput value={bet} onChange={setBet} disabled={locked} />
      <div>
        {mode === 'manual' ? (
          <Label right={<Toggle on={autoOn} onChange={setAutoOn} disabled={locked} label="Auto cash out" />}>Auto cash out</Label>
        ) : (
          <Label>Cash out at</Label>
        )}
        <NumberField value={autoAt} min={1.01} max={1000} disabled={(mode === 'manual' && !autoOn) || locked} onCommit={(v) => setAutoAt(round2(v))} suffix="×" />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[1.5, 2, 5, 10].map((v) => (
            <button
              key={v}
              disabled={(mode === 'manual' && !autoOn) || locked}
              onClick={() => setAutoAt(v)}
              className={`h-10 rounded-lg text-[13px] font-bold transition disabled:opacity-50 ${autoAt === v ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}
            >
              {v}×
            </button>
          ))}
        </div>
      </div>

      {mode === 'auto' && <AutoSettings auto={auto} />}

      <div className="max-lg:order-first">{action}</div>

      {conn === 'solo' || conn === 'connecting' ? (
        <SoloNote conn={conn} onRetry={retryShared} busy={locked} />
      ) : (
        feed && (
          <Players
            feed={feed}
            conn={conn}
            name={name}
            editable={!username}
            onName={(n) => (setGuestName(n), saveName(n))}
            onFair={() => setFair(feed.round.id)}
          />
        )
      )}
      {online || !feed ? null : (
        <button onClick={() => setFair(feed.round.id)} className="-my-2 self-start py-2 pr-3 text-[12px] font-bold text-muted underline-offset-2 hover:text-ink hover:underline">
          Fairness
        </button>
      )}
    </>
  )

  const rocketW = size.w < 520 ? 64 : 96

  const stage = (
    <div ref={stageRef} className={`absolute inset-0 select-none overflow-hidden bg-[radial-gradient(ellipse_at_15%_100%,#2a1f63_0%,#15153a_45%,#0b1020_100%)] ${shake ? 'shake' : ''}`}>
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(255,95,162,.16),transparent_65%)]" />
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} className="relative block" />

      {/* the rocket: its nozzle sits on the head of the curve */}
      <div ref={rocketRef} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ opacity: 0, transformOrigin: '0 0' }}>
        <div style={{ transform: `translate(${-rocketW * 0.3}px, ${-rocketW * 0.2}px)` }}>
          <div className="drop-shadow-[0_8px_18px_rgba(0,0,0,.5)]">
            <Rocket width={rocketW} thrust={phase !== 'betting'} />
          </div>
        </div>
      </div>

      {/* recent crash points; tap one to check it */}
      <HistoryPills
        className="absolute inset-x-3 top-3"
        items={(feed?.history ?? []).map((h) => ({
          key: h.id,
          label: fmtMult(h.crash),
          tone: h.crash >= 10 ? 'gold' : h.crash >= 2 ? 'win' : 'loss',
          onClick: () => setFair(h.id),
        }))}
      />

      {/* centre readout */}
      <div className="pointer-events-none absolute inset-x-0 top-[20%] flex flex-col items-center text-center">
        {phase === 'betting' ? (
          <div className="flex flex-col items-center">
            <div className="text-[13px] font-bold uppercase tracking-[.18em] text-white/55">
              Launch in <span ref={countRef} className="tnum normal-case text-white">7.0s</span>
            </div>
            <div className="mt-3 h-2 w-56 max-w-[60vw] overflow-hidden rounded-full bg-white/10">
              <div ref={barRef} className="h-full origin-left rounded-full bg-[linear-gradient(90deg,#7b5cff,#ff5fa2)]" />
            </div>
          </div>
        ) : (
          <>
            <div
              ref={multRef}
              className={`tnum text-[clamp(44px,8vw,88px)] font-black leading-none tracking-tight ${phase === 'crashed' ? 'text-danger' : myResult ? 'text-accent' : 'text-white'}`}
              style={{ textShadow: '0 6px 30px rgba(0,0,0,.45)' }}
            >
              1.00×
            </div>
            <div className="mt-2 h-6 text-[14px] font-extrabold uppercase tracking-[.2em]">{phase === 'crashed' && <span className="text-danger">Crashed</span>}</div>
          </>
        )}
        <AnimatePresence>
          {myResult && (
            <motion.div
              key={myResult.round}
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              className="tnum mt-3 flex items-center gap-2 rounded-full border-2 border-accent bg-panel/90 px-4 py-2 text-[14px] font-extrabold text-accent shadow-[0_0_30px_-6px_rgba(34,211,111,.6)]"
            >
              {fmtMult(myResult.mult)} · {fmt(myResult.amount)} <Coin size={16} />
            </motion.div>
          )}
          {lost && (
            <motion.div key="lost" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="tnum mt-3 text-[14px] font-bold text-white/60">
              -{fmt(feed!.mine!.bet)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {conn === 'reconnecting' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-panel/95 px-4 py-2 text-[13px] font-bold text-gold shadow-lg"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" /> Reconnecting…
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} />
      <AnimatePresence>{fair != null && server && feed && <FairnessModal server={server} feed={feed} id={fair} onPick={setFair} onClose={() => setFair(null)} />}</AnimatePresence>
    </>
  )
}

/** Everyone in the current round: who bet what and who got out in time. */
function Players({
  feed,
  conn,
  name,
  editable,
  onName,
  onFair,
}: {
  feed: Feed
  conn: Conn
  name: string
  editable: boolean
  onName: (n: string) => void
  onFair: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const crashed = feed.round.phase === 'crashed'
  const out = feed.bets.filter((b) => b.cashed != null).length
  return (
    <div className="flex min-h-[200px] flex-col overflow-hidden rounded-xl bg-stage lg:min-h-0 lg:flex-1">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-[12px] font-bold text-muted">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${conn === 'live' ? 'bg-accent shadow-[0_0_8px_rgba(34,211,111,.8)]' : 'animate-pulse bg-gold'}`} />
          <IconUsers size={15} /> {feed.players} {feed.players === 1 ? 'player' : 'players'}
          {out > 0 && <span className="text-accent">· {out} out</span>}
        </span>
        <span className="tnum flex items-center gap-1">
          {fmt(feed.total)} <Coin size={12} />
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {feed.bets.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-dim">No bets yet this round</div>}
        {feed.bets.map((b, i) => (
          <div key={`${b.name}-${i}`} className={`flex items-center gap-2 px-3 py-1.5 text-[12px] ${b.me ? 'bg-accent/8' : i % 2 ? 'bg-panel/40' : ''}`}>
            <PlayerName name={b.name} acct={b.acct} className={`min-w-0 flex-1 truncate font-semibold ${b.me ? 'text-accent' : 'text-ink/85'}`} />
            <span className="tnum w-20 text-right text-muted">{fmt(b.bet)}</span>
            <span className={`tnum w-16 text-right font-bold ${b.cashed != null ? 'text-accent' : crashed ? 'text-danger' : 'text-dim'}`}>
              {b.cashed != null ? `${b.cashed.toFixed(2)}×` : crashed ? 'bust' : '-'}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px]">
        <span className="shrink-0 text-dim">Playing as</span>
        {editing ? (
          <input
            autoFocus
            maxLength={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const n = draft.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16)
              if (n) onName(n)
              else setDraft(name)
              setEditing(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="min-w-0 flex-1 rounded bg-panel2 px-2 py-0.5 text-[16px] font-semibold text-ink outline-none ring-1 ring-accent/50 sm:text-[12px]"
          />
        ) : editable ? (
          <button onClick={() => (setDraft(name), setEditing(true))} className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-accent">
            {name} <span className="text-dim">✎</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{name}</span>
        )}
        <button onClick={onFair} className="-my-1 shrink-0 rounded-md px-2.5 py-2 font-bold text-muted transition hover:bg-panel2 hover:text-ink">
          Fairness
        </button>
      </div>
    </div>
  )
}

function SoloNote({ conn, onRetry, busy }: { conn: Conn; onRetry: () => void; busy: boolean }) {
  return (
    <div className="rounded-xl bg-stage p-3 text-[12px] leading-relaxed text-muted">
      {conn === 'connecting' ? (
        <span className="flex items-center gap-2">
          <Spinner size={14} className="text-gold" /> Joining the shared rounds…
        </span>
      ) : (
        <div className="flex items-center gap-3">
          <span className="flex-1">Playing solo. The shared rounds can't be reached right now.</span>
          <button onClick={onRetry} disabled={busy} className="shrink-0 rounded-lg bg-raised px-3 py-2 font-bold text-ink transition hover:bg-hover disabled:opacity-50">
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

/** Shows a round's published hash and, once it is over, the revealed seed checked in the browser. */
function FairnessModal({ server, feed, id, onPick, onClose }: { server: CrashServer; feed: Feed; id: number; onPick: (id: number) => void; onClose: () => void }) {
  const current = feed.round.id === id ? feed.round : null
  const [info, setInfo] = useState<RoundInfo | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'pending' | 'missing'>('loading')
  const [copied, setCopied] = useState<string | null>(null)
  const done = !current || current.phase === 'crashed'

  useEffect(() => {
    let alive = true
    setVerdict(null)
    setInfo(null)
    if (!done) {
      setState('pending')
      return
    }
    setState('loading')
    const known = current?.seed && current.crash != null ? { id, hash: current.hash, seed: current.seed, crash: current.crash } : null
    ;(known ? Promise.resolve(known) : server.roundInfo(id).catch(() => null)).then(async (r) => {
      if (!alive) return
      if (!r) return setState('missing')
      setInfo(r)
      setState('ready')
      const v = await verifyRound(r.seed, r.hash, r.crash)
      if (alive) setVerdict(v)
    })
    return () => void (alive = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, done])

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1200)
    })
  }
  const hash = current?.hash ?? info?.hash ?? ''
  const field = (label: string, value: string | null, placeholder: string) => (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-muted">
        {label}
        {value && (
          <button onClick={() => copy(label, value)} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-dim transition hover:bg-panel2 hover:text-ink">
            {copied === label ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className="break-all rounded-lg bg-stage px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink/90">{value || <span className="font-sans text-dim">{placeholder}</span>}</div>
    </div>
  )
  const check = (ok: boolean | undefined, text: string) => (
    <div className="flex items-center gap-2 text-[13px] font-semibold">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok == null ? 'bg-raised' : ok ? 'bg-accent text-[#032412]' : 'bg-danger text-white'}`}>
        {ok == null ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" /> : ok ? <IconCheck size={12} /> : '!'}
      </span>
      {text}
    </div>
  )

  return (
    <Modal onClose={onClose} title={`Round #${id}`} width={520}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className={`tnum text-[32px] font-black leading-none ${done ? ((info?.crash ?? current?.crash ?? 0) >= 2 ? 'text-accent' : 'text-danger') : 'text-ink'}`}>
            {done ? fmtMult(info?.crash ?? current?.crash ?? 1) : current?.phase === 'running' ? 'In flight' : 'Taking bets'}
          </div>
          {!server.online && <span className="rounded-full bg-raised px-2.5 py-1 text-[11px] font-bold text-muted">Solo round</span>}
        </div>
        {field('Hash, published before betting', hash || null, 'Not available')}
        {field('Seed', state === 'ready' ? info!.seed : null, state === 'pending' ? 'Revealed when this round crashes' : state === 'missing' ? 'This round is too old to look up' : 'Loading…')}
        {state === 'ready' && (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            {check(verdict?.hashOk, 'The seed matches the published hash')}
            {check(verdict?.crashOk, verdict ? `The seed gives a crash at ${fmtMult(verdict.computed)}` : 'Working out the crash point from the seed')}
          </div>
        )}
        <div>
          <div className="mb-2 text-[12px] font-bold text-muted">Recent rounds</div>
          <div className="flex flex-wrap gap-1.5">
            {feed.history.slice(0, 12).map((h) => (
              <button
                key={h.id}
                onClick={() => onPick(h.id)}
                className={`tnum rounded-full px-3 py-1.5 text-[12px] font-extrabold transition ${h.id === id ? 'bg-ink text-panel' : h.crash >= 2 ? 'bg-accent/15 text-accent hover:bg-accent/25' : 'bg-raised text-ink/80 hover:bg-hover'}`}
              >
                {fmtMult(h.crash)}
              </button>
            ))}
            {feed.round.id !== id && (
              <button onClick={() => onPick(feed.round.id)} className="rounded-full bg-raised px-3 py-1.5 text-[12px] font-extrabold text-muted hover:bg-hover hover:text-ink">
                Current round
              </button>
            )}
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-dim">
          Each round's crash point comes from a random seed. Its SHA-256 hash is shown before anyone bets, so the result can't be changed afterwards. When the round ends the seed is revealed, and your
          browser checks it: the first 52 bits of SHA-256(seed + ":lumen") give h, and the crash point is ⌊97·2⁵² / (2⁵² − h)⌋ / 100, capped at 1000×.
        </p>
      </div>
    </Modal>
  )
}

function readPending(key: string): [number, number][] {
  try {
    const v = JSON.parse(safeStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => Array.isArray(x) && x.length === 2) : []
  } catch {
    return []
  }
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))))
  const n = raw / p
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
