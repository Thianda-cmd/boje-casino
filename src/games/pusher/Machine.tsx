import { useEffect, useRef, useState } from 'react'
import type { MachineProps } from './types'
import type { PusherScene } from './scene/scene'

/*
  Coin Cascade's 3D machine as a React component (the contract is types.ts MachineProps): it shows `field` while it
  waits, with the drop slot's carriage at `aim`, and plays `play.run` when one is handed to it (a new `play.key` for
  each drop) at `play.speed` times machine time, calling onEvent as each event's frame is passed and onDone(key) once
  the run's last frame is on show. A new key replaces the drop in play at once; play = null ends it where it ends.
  The field a drop started from may be swapped for its `after` at any point (the machine poses what moves from the
  run and what stays from either). onDisplay says where the cabinet's display panel is on the element, for the page's
  win counter. The tray's pile stays until the next drop.

  The 3D code loads on its own, after the page. Until it is up the stage shows a poster; if the browser can't do WebGL
  (or loses it), drops still finish: their remaining events and onDone are told at once, so the page always settles.
  It stops drawing when it is scrolled off screen or its tab is hidden. Scrolled off screen, a drop in play still runs on
  (without drawing) so the page hears its events and onDone on time; in a hidden tab it waits until the tab is back.
  Under reduced motion it plays drops without shake or push-in, with fewer particles and still lights.
*/

declare global {
  interface Window {
    __pusherMachine?: PusherScene
  }
}

export default function Machine({ field, play, aim, onEvent, onDone, onDisplay, className = '' }: MachineProps) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<PusherScene | null>(null)
  const latest = useRef({ onEvent, onDone, onDisplay })
  latest.current = { onEvent, onDone, onDisplay }
  const props = useRef({ field, play, aim })
  props.current = { field, play, aim }
  /** what the page has heard of the drop in play: its key, how many of its events, and whether it is done */
  const heard = useRef({ key: '', n: 0, done: false })
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    let on = true
    let sc: PusherScene | null = null
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null
    let seen = true
    const calmQ = matchMedia('(prefers-reduced-motion: reduce)')
    const low = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 560
    const sync = () => sc?.setVisibility(seen, !document.hidden)
    const onCalm = () => sc?.setCalm(calmQ.matches)
    const fail = () => {
      if (!on) return
      sc?.dispose()
      if (import.meta.env.DEV && window.__pusherMachine === sc) delete window.__pusherMachine
      sc = null
      scene.current = null
      setState('failed')
    }
    import('./scene/scene')
      .then(({ PusherScene }) => {
        if (!on || !host.current) return
        try {
          sc = new PusherScene(host.current, { low, calm: calmQ.matches })
        } catch {
          fail()
          return
        }
        scene.current = sc
        sc.onEvent = (e) => {
          heard.current.n++
          latest.current.onEvent?.(e)
        }
        sc.onDone = (k) => {
          if (heard.current.key === k) heard.current.done = true
          latest.current.onDone?.(k)
        }
        sc.onDisplay = (r) => latest.current.onDisplay?.(r)
        sc.onFail = fail
        const now = props.current
        sc.setField(now.field)
        sc.setAim(now.aim)
        if (now.play) {
          heard.current = { key: now.play.key, n: 0, done: false }
          sc.setPlay(now.play.run, now.play.speed, now.play.key)
        }
        const fit = () => {
          const r = host.current?.getBoundingClientRect()
          if (r) sc?.resize(r.width, r.height)
        }
        ro = new ResizeObserver(fit)
        ro.observe(host.current)
        fit()
        io = new IntersectionObserver(
          ([en]) => {
            seen = en.isIntersecting
            sync()
          },
          { threshold: 0 },
        )
        io.observe(host.current)
        document.addEventListener('visibilitychange', sync)
        calmQ.addEventListener('change', onCalm)
        sync()
        if (import.meta.env.DEV) window.__pusherMachine = sc
        return sc.ready.then(() => on && sc && setState('ready'))
      })
      .catch(fail)
    return () => {
      on = false
      ro?.disconnect()
      io?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      calmQ.removeEventListener('change', onCalm)
      if (import.meta.env.DEV && window.__pusherMachine === sc) delete window.__pusherMachine
      sc?.dispose()
      scene.current = null
    }
  }, [])

  useEffect(() => {
    scene.current?.setField(field)
  }, [field])

  useEffect(() => {
    scene.current?.setAim(aim)
  }, [aim])

  const key = play?.key ?? ''
  const speed = play?.speed ?? 1
  useEffect(() => {
    const p = props.current.play
    if (p && heard.current.key !== p.key) heard.current = { key: p.key, n: 0, done: false }
    scene.current?.setPlay(p?.run ?? null, p?.speed ?? 1, p?.key ?? '')
  }, [key, speed])

  // without the 3D machine a drop finishes at once: whatever the page has not heard of it yet, then onDone
  useEffect(() => {
    const p = props.current.play
    if (state !== 'failed' || !p) return
    if (heard.current.key !== p.key) heard.current = { key: p.key, n: 0, done: false }
    const h = heard.current
    if (h.done) return
    h.done = true
    const t = setTimeout(() => {
      for (const e of p.run.events.slice(h.n)) latest.current.onEvent?.(e)
      h.n = p.run.events.length
      latest.current.onDone?.(p.key)
    }, 0)
    void t
  }, [state, key])

  return (
    <div className={`relative overflow-hidden bg-[#070b22] ${className}`}>
      <div ref={host} className="absolute inset-0" />
      {state !== 'ready' && <Poster failed={state === 'failed'} />}
    </div>
  )
}

/** what the stage shows until the machine is up (or instead of it) */
function Poster({ failed }: { failed: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,#1a2a86_0%,#0b1240_55%,#070b22_100%)]">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-3 w-3 rounded-full ${i % 2 ? 'bg-[#ff3fb4]' : 'bg-[#ffd23a]'} ${failed ? '' : 'animate-pulse motion-reduce:animate-none'}`} style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <div className="text-[clamp(22px,5vw,40px)] font-black tracking-tight text-[#ffd23a] [text-shadow:0_3px_0_#0b1033,0_0_24px_rgba(255,63,180,0.55)]">COIN CASCADE</div>
      <div className="px-6 text-center text-[12px] font-bold text-white/60">{failed ? 'The 3D machine needs WebGL: drops still play and pay.' : 'Powering up the machine…'}</div>
    </div>
  )
}
